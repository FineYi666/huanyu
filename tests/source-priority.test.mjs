import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebSources,AGE_SOURCE,sourcePriority} from '../web-sources.mjs'
import {parsePageSources} from '../page-sources.mjs'
import {createSiteRenderer} from '../site-renderer.mjs'

const ageDetail={url:'https://www.agedm.io/detail/123',documentTitle:'测试动漫 第二季 - AGE动漫',image:'https://www.agedm.io/logo.png',text:'首播时间：2026-10-01',roadLabels:['VIP 西瓜','非凡'],links:[13,14].map(n=>({title:`第${n}集`,url:`https://www.agedm.io/play/123/2/${n}`}))}
test('AGE keeps complete episode pages, separates seasons and resolves each selected episode lazily',async()=>{
  const reads=[]
  const service=createWebSources({providers:[AGE_SOURCE],searchPage:async()=>({links:[{title:'测试动漫 第二季',url:'http://www.agedm.io/detail/123',image:'https://poster.example/anime.jpg'},{title:'测试动漫 第二季',url:'https://www.agedm.io/play/123/2/13'}]}),readPage:async(_s,url)=>{reads.push(url);return {...ageDetail,url,media:url.includes('/play/')?[`https://cdn.example/${url.split('/').pop()}.m3u8`]:[]}},probe:async source=>({...source,format:'hls',width:1920,height:1080})})
  const result=await service.search('测试动漫 第二季',{category:'anime'})
  assert.equal(result.results.length,1)
  const item=result.results[0]
  assert.equal(item.cover,'https://poster.example/anime.jpg');assert.equal(item.year,'2026')
  assert.deepEqual(item.episodes.map(ep=>ep.number),[1,2]);assert.equal(item.episodes[0].season,2)
  assert.ok(!reads.some(url=>url.endsWith('/14')))
  const second=await service.resolve(item.id,item.episodes[1].id)
  assert.equal(second.url,'https://cdn.example/14.m3u8');assert.ok(reads.some(url=>url.endsWith('/14')))
  const saved=service.snapshot(item.id);saved.episodes[1].url=undefined
  assert.equal((await service.resolveStored(saved,saved.episodes[1].id)).url,second.url)
  assert.equal(parsePageSources({...ageDetail,links:[{title:'第1集',url:'https://www.agedm.io/play/123/1/1'}]},'anime').length,0)
})
test('anime source preference precedes resolution; other categories retain resolution ordering',async()=>{
  const providers=['hn','subo','bf','giri'].map(id=>({id,name:{hn:'红牛资源',subo:'速播资源',bf:'暴风资源',giri:'giriGiriLove'}[id],api:`https://${id}.example/api`}))
  const service=createWebSources({providers,fetcher:async url=>Response.json({list:[{vod_id:1,vod_name:'测试动漫',type_name:'日本动漫',vod_play_from:'高清',vod_play_url:`第1集$https://${new URL(url).hostname}/1.m3u8`}]}),probe:async source=>({...source,width:1920,height:source.url.includes('hn.example')?2160:1080})})
  const result=await service.search('测试动漫',{category:'anime'})
  assert.deepEqual(result.results.map(item=>item.sourceId),['giri','bf','subo','hn'])
  assert.deepEqual(result.sources.map(item=>item.name),['giriGiriLove','暴风资源','速播资源','红牛资源'])
  const values=[{sourceId:'hn',qualityHeight:2160},{sourceId:'giri'},{sourceId:'age'},{sourceName:'自定义 · 低端影视'}]
  values.sort((a,b)=>sourcePriority(a,'anime')-sourcePriority(b,'anime'))
  assert.deepEqual(values.map(item=>sourcePriority(item,'anime')),[0,1,2,21])
  assert.equal(sourcePriority({sourceId:'hn'},'movie'),0)
})
test('verification opens once, reports completion, retries successfully and avoids popup loops',async()=>{
  let attempts=0,opens=0,finish,clock=1000,verified=false
  const renderer=createSiteRenderer('unused','unused',{now:()=>clock,runner:async(_site,mode)=>{
    if(mode==='verify'){opens++;return new Promise(resolve=>{finish=()=>{verified=true;resolve({verified:true})}})}
    attempts++;return verified?{title:'作品结果'}:{needsVerification:true,error:'需要验证'}
  }})
  const site=AGE_SOURCE.site
  await assert.rejects(renderer.search(site,'作品'),error=>error.needsVerification&&error.siteId===site.id)
  await assert.rejects(renderer.search(site,'作品'),/验证窗口/)
  assert.equal(opens,1);assert.equal(renderer.verificationStatus()[0].status,'pending')
  finish();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(renderer.verificationStatus()[0].status,'complete')
  assert.equal((await renderer.search(site,'作品')).title,'作品结果')
  verified=false;clock+=100
  await assert.rejects(renderer.search(site,'作品'))
  assert.equal(opens,1)
  clock+=61000;await assert.rejects(renderer.search(site,'作品'));assert.equal(opens,2)
  finish();await new Promise(resolve=>setImmediate(resolve))
  assert.ok(attempts>=3)
})
