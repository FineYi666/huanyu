import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebSources} from '../web-sources.mjs'
import {ANIME_PAGE_SOURCES} from '../anime-sources.mjs'
const turn=()=>new Promise(resolve=>setImmediate(resolve))

test('verified search results are usable before slow providers finish, polling is deduplicated and completed jobs are cached',async()=>{
  let finish,calls=0
  const gate=new Promise(resolve=>finish=resolve)
  const service=createWebSources({providers:['fast','slow'].map(id=>({id,name:id,api:`https://${id}.example/api`})),fetcher:async url=>{
    calls++;if(new URL(url).hostname==='slow.example')await gate
    return Response.json({list:[{vod_id:1,vod_name:'测试剧',type_name:'国产剧',vod_play_from:'超清',vod_play_url:`第1集$https://${new URL(url).hostname}/episode.mp4`}]})
  },probe:async source=>({...source,format:'file',width:1920,height:1080})})
  const options={category:'tv',progressive:true}
  assert.equal((await service.search('测试剧',options)).pending,true)
  await turn()
  const early=await service.search('测试剧',options)
  assert.equal(early.pending,true);assert.equal(early.results.length,1);assert.equal(early.results[0].sourceId,'fast')
  assert.equal(early.sources.find(s=>s.name==='slow').status,'loading')
  assert.equal(early.results[0].episodes[0].url,undefined)
  assert.equal((await service.resolve(early.results[0].id,early.results[0].episodes[0].id)).height,1080)
  assert.equal(calls,2)
  finish();await service.search('测试剧',{category:'tv'});await turn()
  const cached=await service.search('测试剧',options)
  assert.equal(cached.pending,false);assert.equal(cached.results.length,2);assert.equal(calls,2)
  await service.search('测试剧',{...options,refresh:true});await turn();assert.ok(calls>2)
})

test('page providers publish their first verified road while checking remaining roads',async()=>{
  let finish
  const gate=new Promise(resolve=>finish=resolve)
  const source=ANIME_PAGE_SOURCES.find(s=>s.id==='ddys')
  const service=createWebSources({providers:[source],searchPage:async()=>({links:[{title:'测试动漫',url:'https://ddys.app/test/'}]}),readPage:async()=>({url:'https://ddys.app/test/',title:'测试动漫',links:[{url:'https://ddys.app/category/anime/'}],scripts:[JSON.stringify({playlistType:'anime',nodes:['fast','slow'].map(id=>({id,label:id,access:'public'})),seasons:[{season:1,tracks:[{episode:1,nodeSources:{fast:'https://cdn.example/fast.mp4',slow:'https://cdn.example/slow.mp4'}}]}]})]}),probe:async source=>{if(source.url.includes('slow'))await gate;return{...source,format:'file',width:1920,height:1080}}})
  const options={category:'anime',progressive:true}
  await service.search('测试动漫',options);await turn()
  const early=await service.search('测试动漫',options)
  assert.equal(early.pending,true);assert.equal(early.results.length,1);assert.equal(early.results[0].road,'fast')
  finish();await service.search('测试动漫',{category:'anime'});await turn()
  assert.equal((await service.search('测试动漫',options)).results.length,2)
})

test('verification completed during another provider search schedules a fresh attempt instead of reusing the gated cache',async()=>{
  let verified=false,finish
  const gate=new Promise(resolve=>finish=resolve)
  const providers=ANIME_PAGE_SOURCES.filter(s=>['ddys','mgn'].includes(s.id))
  const service=createWebSources({providers,searchPage:async site=>({links:[{title:'测试动漫',url:new URL('/test/',site.url).href}]}),readPage:async(site,url)=>{
    if(site.name.includes('DDYS')&&!verified)throw Object.assign(Error('需要验证'),{needsVerification:true,siteId:site.id})
    const host=new URL(url).hostname
    return{url,title:'测试动漫',links:[{url:new URL('/category/anime/',url).href}],scripts:[JSON.stringify({playlistType:'anime',nodes:[{id:'public',access:'public'}],seasons:[{season:1,tracks:[{episode:1,nodeSources:{public:`https://cdn.example/${host}.mp4`}}]}]})]}
  },probe:async source=>{if(source.url.includes('mgnacg'))await gate;return{...source,format:'file',width:1920,height:1080}}})
  const options={category:'anime',progressive:true}
  await service.search('测试动漫',options);await turn()
  assert.ok((await service.search('测试动漫',options)).sources.some(s=>s.needsVerification))
  verified=true;await service.search('测试动漫',{...options,refresh:true});finish()
  await service.search('测试动漫',{category:'anime'});await turn();await turn()
  const value=await service.search('测试动漫',options)
  assert.equal(value.pending,false);assert.equal(value.results.length,2);assert.ok(value.sources.every(s=>!s.needsVerification))
})
