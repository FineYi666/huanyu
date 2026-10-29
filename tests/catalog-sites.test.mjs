import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import {spawn} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setCatalogFavorite,inheritCatalogFavorite} from '../catalog-favorites.mjs'
import {normalizeSearchSites,searchQuarkSite} from '../resource-sites.mjs'
import {createResourceSearch} from '../resource-search.mjs'
import {createWebSources} from '../web-sources.mjs'
import {parsePageSources} from '../page-sources.mjs'

test('catalog favorites require no media files, merge linked imports and unfavorite together',()=>{
  const media=[],subject={id:'douban-123',title:'测试电影',category:'movie',image:'https://poster.example/a.jpg',score:9.5}
  setCatalogFavorite(media,subject,true);setCatalogFavorite(media,subject,true)
  assert.equal(media.length,1);assert.equal(media[0].source,'catalog');assert.equal(media[0].rating,'9.5');assert.deepEqual(media[0].episodes,[])
  const imported={id:'local',subjectId:subject.id,source:'local'}
  inheritCatalogFavorite(imported,media);assert.equal(imported.favorite,true);media.push(imported)
  setCatalogFavorite(media,subject,false)
  assert.equal(media.length,1);assert.equal(imported.favorite,false)
})
test('custom site configuration rejects private destinations and preserves stable identities',()=>{
  const input={name:'影视站',type:'page',url:'https://cinema.example/',enabled:true}
  const first=normalizeSearchSites([input],true)[0]
  assert.equal(normalizeSearchSites([{...input,name:'改名'}],true)[0].id,first.id)
  assert.equal(normalizeSearchSites([{...input,enabled:false}],true)[0].enabled,false)
  for(const url of ['http://cinema.example/','https://localhost/','https://127.0.0.1/','https://192.168.1.2/','https://198.18.0.1/','https://user:pass@cinema.example/'])assert.throws(()=>normalizeSearchSites([{...input,url}],true))
  assert.throws(()=>normalizeSearchSites([{...input,type:'quark'}],true),/query/)
})
const snapshot=()=>({url:'https://cinema.example/test/',title:'测试剧 (更新至 第2季02)',links:[{url:'https://cinema.example/category/anime/'}],scripts:[JSON.stringify({playlistType:'anime',nodes:[{id:'vip',label:'VIP',access:'vip'},{id:'public',label:'公开线路',access:'public'}],seasons:[1,2].map(season=>({season,tracks:[1,2].map(episode=>({episode,title:`第${episode}集`,nodeSources:{public:`https://cdn.example/s${season}/${episode}.mp4`,vip:'https://cdn.example/private.mp4'}}))}))})]})
test('page playlists keep seasons separate, restart episode numbering and expose only public nodes',()=>{
  const roads=parsePageSources(snapshot(),'anime')
  assert.equal(roads.length,2);assert.equal(roads[1].title,'测试剧 第2季');assert.deepEqual(roads[1].episodes.map(ep=>ep.number),[1,2])
  assert.ok(roads.every(road=>road.pageNodeId==='public'))
})
test('enabled custom page and JSON sources participate in matching; disabled sources are never requested',async()=>{
  let sites=normalizeSearchSites([{name:'页面源',type:'page',url:'https://cinema.example/'}],true),reads=0
  const service=createWebSources({providers:[],getSites:()=>sites,searchPage:async()=>({links:[{title:'测试剧 (更新至 第2季02)',url:'https://cinema.example/test/'}]}),readPage:async()=>{reads++;return snapshot()},probe:async source=>({...source,format:'file',height:1080,width:1920})})
  const value=await service.search('测试剧 第二季',{category:'anime',cover:'https://poster.example/trusted.jpg'})
  assert.equal(value.results.length,1);assert.equal(value.results[0].episodes[0].season,2)
  assert.equal(value.results[0].cover,'https://poster.example/trusted.jpg');assert.equal(service.snapshot(value.results[0].id).cover,value.results[0].cover)
  const before=reads;sites=[{...sites[0],enabled:false}]
  assert.equal((await service.search('测试剧 第二季',{category:'anime'})).results.length,0);assert.equal(reads,before)
  let calls=0
  const vod=normalizeSearchSites([{name:'采集源',type:'vod',url:'https://vod.example/api?key=public'}],true)
  const json=createWebSources({providers:[],getSites:()=>vod,fetcher:async url=>{calls++;assert.equal(new URL(url).searchParams.get('key'),'public');return Response.json({list:[{vod_id:1,vod_name:'测试电影',type_name:'剧情片',vod_play_from:'高清',vod_play_url:'正片$https://cdn.example/movie.mp4'}]})},probe:async source=>({...source,format:'file',height:1080})})
  assert.equal((await json.search('测试电影',{category:'movie'})).results.length,1);assert.ok(calls>0)
  const anime=createWebSources({providers:[],getSites:()=>vod,fetcher:async()=>Response.json({list:[{vod_id:2,vod_name:'测试动漫 第二季',type_name:'日本动漫',vod_play_from:'高清',vod_play_url:'第1集$https://cdn.example/anime.mp4'}]}),probe:async source=>({...source,format:'file',height:1080})})
  assert.equal((await anime.search('测试动漫 第二季',{category:'anime'})).results.length,1)
  const unsupported=createWebSources({providers:[],getSites:()=>sites.map(site=>({...site,enabled:true})),searchPage:async()=>({links:[{title:'测试动漫 第二季',url:'https://cinema.example/test/'}]}),readPage:async()=>({url:'https://cinema.example/test/',title:'测试动漫 第二季',scripts:[],links:[]})})
  const missing=await unsupported.search('测试动漫 第二季',{category:'anime'})
  assert.equal(missing.results.length,0);assert.match(missing.sources[0].message,/尚未兼容该站播放器/)
})
test('added Quark sites actually contribute extracted matches to aggregate search',async()=>{
  const sites=normalizeSearchSites([{name:'分享站',type:'quark',url:'https://shares.example/search?q={query}'}],true)
  const fetcher=async value=>{const url=new URL(value);if(url.hostname==='shares.example')return new Response(url.pathname==='/search'?'<a href="/movie">测试电影 1080P</a>':'<main>名称：测试电影 1080P<br>https://pan.quark.cn/s/customshare</main>');if(url.hostname==='pansou.app')return Response.json({code:0,data:{merged_by_type:{}}});return new Response('<script id="__NEXT_DATA__">{"props":{"pageProps":{"data":{"data":[]}}}}</script>')}
  const service=createResourceSearch({fetcher,getSites:()=>sites,searchSite:searchQuarkSite})
  const result=await service.search('测试电影')
  assert.equal(result.results.length,1);assert.equal(result.results[0].source,'自定义 · 分享站');assert.ok(result.results[0].url.endsWith('customshare'))
})
test('catalog favorites and search websites persist across a real backend restart',async t=>{
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),temp=await mkdtemp(path.join(os.tmpdir(),'huanyu-catalog-sites-'))
  const data=path.join(temp,'data');await mkdir(data)
  await writeFile(path.join(data,'library.json'),JSON.stringify({media:[],games:[],settings:{deepseekAuto:false,showSamples:false}}))
  const preload=path.join(temp,'offline.mjs');await writeFile(preload,'globalThis.fetch=async()=>{throw Error("offline test")}')
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})}),origin=`http://127.0.0.1:${port}`
  let child
  const start=async()=>{child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.mjs'],{cwd:root,env:{...process.env,YINGYU_PORT:String(port),YINGYU_DATA_DIR:data},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error(output)),10000);child.stdout.on('data',s=>{output+=s;if(output.includes('已启动')){clearTimeout(timer);resolve()}});child.stderr.on('data',s=>output+=s);child.on('error',reject)})}
  const stop=async()=>{if(child?.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done}};t.after(stop)
  const post=(route,body,method='POST')=>fetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)})
  await start()
  const catalog=await(await fetch(origin+'/api/movie-seed')).json(),movie=catalog.movies[0]
  const anime=(await(await fetch(origin+'/api/seasonal')).json()).items[0]
  for(const subjectId of [movie.id,anime.id,movie.id]){const r=await post('/catalog/favorite',{subjectId,favorite:true});assert.equal(r.status,200,await r.clone().text())}
  const sites=[{name:'影视网站',type:'page',url:'https://cinema.example/',enabled:true}]
  const saved=await post('/search-sites',{sites});assert.equal(saved.status,200)
  assert.equal((await post('/search-sites',{sites:[{...sites[0],url:'https://127.0.0.1/'}]})).status,400)
  await stop();await start()
  const state=await(await fetch(origin+'/api/state')).json()
  assert.equal(state.media.length,2);assert.ok(state.media.every(m=>m.favorite&&m.source==='catalog'&&m.cover))
  assert.equal(state.settings.searchSites[0].name,'影视网站')
  const clip=path.join(temp,'movie.mp4');await writeFile(clip,'fixture')
  const imported=await(await post('/import/local',{paths:[clip],subjectId:movie.id,category:'movie'})).json()
  const file=imported.media.find(m=>m.source==='local');assert.equal(file.favorite,true)
  await post('/media/'+file.id,{favorite:false},'PATCH')
  const final=await(await fetch(origin+'/api/state')).json()
  assert.equal(final.media.filter(m=>m.favorite).length,1)
  assert.ok(final.media.some(m=>m.subjectId===anime.id&&m.favorite))
  assert.ok(!final.media.some(m=>m.source==='catalog'&&m.subjectId===movie.id))
})
