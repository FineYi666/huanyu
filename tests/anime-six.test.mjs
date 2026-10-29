import test from 'node:test'
import assert from 'node:assert/strict'
import {matchesWork,workSearchTerms,animeTitleRelevant} from '../media-match.mjs'
import {seasonNumber} from '../episode-seasons.mjs'
import {ANIME_PAGE_SOURCES,isAnimeSource} from '../anime-sources.mjs'
import {parsePageSources,pageMediaUrls,pageTitle} from '../page-sources.mjs'
import {createWebSources} from '../web-sources.mjs'
import {fetchSeasonal,createSeasonalService,seasonAt} from '../seasonal.mjs'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

test('anime subtitles, translated family names and Roman seasons match without mixing seasons or spinoffs',()=>{
  const query='无职转生 第三季 ～到了异世界就拿出真本事～'
  assert.ok(workSearchTerms(query).slice(0,2).includes('无职转生'))
  for(const title of ['无职转生 第三季','无职转生Ⅲ 到了异世界就拿出真本事','無職転生 III ～異世界行ったら本気だす～'])assert.equal(matchesWork({title,type:'动漫'},query,{category:'anime'}),true,title)
  for(const title of ['无职转生 第二季','无职转生Ⅱ 到了异世界就拿出真本事 Part 2','无职转生前传 第三季','无职转生 第三季 解说'])assert.equal(matchesWork({title,type:'动漫'},query,{category:'anime'}),false,title)
  assert.equal(seasonNumber('无职转生Ⅲ 到了异世界就拿出真本事'),3)
  assert.equal(animeTitleRelevant('无职转生（更新至第3季）','无职转生 第三季'),true)
  assert.equal(matchesWork({title:'转生成为魔剑 第二季',type:'动漫'},'转生就是剑 第二季',{category:'anime'}),true)
})
test('listing edition tags and punctuation do not hide an available work',()=>{
  // DDYS lists this show as "学生会也有洞 无修正版 (更新至04)" while the
  // seasonal catalog uses "学生会也有洞！". Both decorations must be ignored.
  assert.equal(pageTitle('学生会也有洞 无修正版 (更新至04)'),'学生会也有洞')
  assert.equal(animeTitleRelevant(pageTitle('学生会也有洞 无修正版 (更新至04)'),'学生会也有洞！'),true)
  assert.ok(workSearchTerms('学生会也有洞！').includes('学生会也有洞'))
  assert.equal(matchesWork({title:'学生会也有洞',type:'动漫'},'学生会也有洞！',{category:'anime'}),true)
})

test('DDYS exposes both public nodes as separate playback roads',()=>{
  const playlist={playlistType:'anime',nodes:[{id:'v1',label:'VIP线路1',access:'vip'},{id:'v3',label:'美国线路',access:'public'},{id:'v2',label:'亚太线路',access:'public'}],seasons:[{season:1,title:'第1季',tracks:[{episode:1,title:'1',nodeSources:{v3:'https://v3.ddys.app/ep1.mp4',v2:'https://v2.ddys.app/ep1.mp4'}},{episode:2,title:'2',nodeSources:{v3:'https://v3.ddys.app/ep2.mp4',v2:'https://v2.ddys.app/ep2.mp4'}}]}]}
  const page={url:'https://ddys.app/the-apothecary-diaries/',title:'药屋少女的呢喃 (更新至 第3季04)',playlists:[JSON.stringify(playlist)]}
  const roads=parsePageSources(page,'anime')
  assert.deepEqual(roads.map(road=>[road.road,road.episodes.length,road.episodes[0].url]),[
    ['美国线路',2,'https://v3.ddys.app/ep1.mp4'],
    ['亚太线路',2,'https://v2.ddys.app/ep1.mp4'],
  ])
})

test('a page source retries the punctuation-free term and verifies the episode',async()=>{
  const provider={id:'ddys',name:'DDYS',api:'https://ddys.app/',anime:true,page:true,site:{id:'ddys',name:'DDYS',type:'page',url:'https://ddys.app/',enabled:true}}
  const detail={
    url:'https://ddys.app/even-the-student-council-has-its-holes/',
    title:'学生会也有洞 无修正版 (更新至04)',
    image:'https://ddys.app/poster.jpg',text:'2026年10月5日 动画、本季新番',
    links:[],chapterGroups:[{name:'线路1',episodes:[{title:'第01集',url:'https://ddys.app/play/1-1-1.html'},{title:'第02集',url:'https://ddys.app/play/1-1-2.html'}]}],
  }
  const queries=[]
  const sources=createWebSources({
    providers:[provider],
    now:()=>1793000000000,
    probe:async()=>({width:1920,height:1080,format:'mp4'}),
    searchPage:async(_site,query)=>{
      queries.push(query)
      return {links:query==='学生会也有洞'?[{title:'学生会也有洞 无修正版 (更新至04)',url:detail.url}]:[]}
    },
    readPage:async(_site,url)=>url===detail.url?structuredClone(detail):{url,media:['https://cdn.ddys.app/ep1.m3u8'],mediaHeaders:{}},
  })
  const value=await sources.search('学生会也有洞！',{category:'anime',minHeight:1080})
  assert.deepEqual(queries,['学生会也有洞！','学生会也有洞'])
  assert.equal(value.results.length,1)
  assert.equal(value.results[0].sourceName,'DDYS')
  assert.equal(value.results[0].title,'学生会也有洞')
  assert.equal(value.results[0].episodes.length,2)
})

test('the anime online allowlist contains exactly the six requested providers',()=>{
  assert.deepEqual(ANIME_PAGE_SOURCES.map(s=>s.id),['ddys','mgn','mute','lmm','age'])
  for(const source of [...ANIME_PAGE_SOURCES,{id:'giri'}])assert.equal(isAnimeSource(source),true)
  for(const id of ['subo','hn','ff','bf','zy360'])assert.equal(isAnimeSource({id,api:`https://${id}.example/`}),false)
})
test('web chapter lists preserve episode gaps and parse direct public player JSON without executing scripts',()=>{
  const page={url:'https://www.mutedm.com/voddetail/1.html',workTitle:'无职转生 第三季',chapterGroups:[{name:'网页线路',episodes:[{title:'第01集',url:'/vodplay/1-1-1.html'},{title:'第03集',url:'/vodplay/1-1-3.html'},{title:'PV',url:'/vodplay/1-1-0.html'}]}]}
  const road=parsePageSources(page,'anime')[0]
  assert.deepEqual(road.episodes.map(ep=>ep.number),[1,3]);assert.equal(road.episodes[0].season,3)
  const url='https://cdn.example/episode.m3u8'
  assert.deepEqual(pageMediaUrls({url:page.url,scripts:[`var player_aaaa=${JSON.stringify({encrypt:2,vod_data:{name:'test'},url:Buffer.from(url).toString('base64')})};`]}),[url])
  assert.deepEqual(pageMediaUrls({url:page.url,scripts:['var player_aaaa={"url":"javascript:alert(1)"}']}),[])
  const signed='https://3abc.storage.example/PERSONCLOUD/video?signature=test'
  assert.deepEqual(pageMediaUrls({url:page.url,frameStates:[{videos:[{src:signed,duration:1420}]}]}),[signed])
  assert.deepEqual(pageMediaUrls({url:page.url,frameStates:[{videos:[{src:signed,duration:15},{src:'http://127.0.0.1/private',duration:1420}]}]}),[])
})
test('quarter refresh recovers a known subject omitted by the search index after confirming its dated detail',async()=>{
  const value=await fetchSeasonal({now:new Date('2026-10-29T02:00:00Z'),knownItems:[{id:'seasonal-622288',airDate:'2026-10-01'},{id:'seasonal-999',airDate:'2026-10-02'}],fetcher:async url=>Response.json(url.includes('/search/')?{total:0,data:[]}:url.endsWith('622288')?{id:622288,type:2,name_cn:'FX战士久留美',date:'2026-10-01',platform:'TV',nsfw:false,images:{common:'https://lain.bgm.tv/a.jpg'},rating:{score:6.9,total:100}}:{id:999,type:2,name_cn:'改期作品',date:'2027-01-01',platform:'TV',rating:{score:6,total:100}})})
  assert.deepEqual(value.items.map(item=>item.id),['seasonal-622288'])
  assert.equal(value.items[0].airDate,'2026-10-01')
})

test('a fresh legacy cache missing a seeded title is repaired and the current-quarter view remains available',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'huanyu-quarter-'))
  try{
    const data=path.join(root,'data');await mkdir(data)
    const now=new Date('2026-10-29T02:00:00Z'),season=seasonAt(now)
    const fx={id:'seasonal-622288',title:'FX战士久留美',airDate:'2026-10-01',platform:'TV',score:6.9,votes:100}
    const cache={season,updatedAt:now.toISOString(),items:[],slides:[]}
    await writeFile(path.join(root,'seasonal.json'),JSON.stringify({...cache,items:[fx]}))
    await writeFile(path.join(data,'recommendations.json'),JSON.stringify(cache))
    const service=await createSeasonalService({root,data,now:()=>now,fetcher:async url=>Response.json(url.includes('/search/')?{total:0,data:[]}:{id:622288,type:2,name_cn:fx.title,date:fx.airDate,platform:'TV',images:{},rating:{score:6.9,total:100}})})
    assert.equal((await service.view(season.id)).refreshing,true)
    const value=await service.update()
    assert.deepEqual(value.items.map(item=>item.id),[fx.id]);assert.equal(value.indexVersion,1)
  }finally{await rm(root,{recursive:true,force:true})}
})
