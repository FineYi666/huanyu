import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { saveOnlineMedia, publicOnlineSources } from '../online-library.mjs'
import { episodeLayout } from '../episode-seasons.mjs'
import { canonicalWorkKey } from '../media-match.mjs'

test('online library deduplicates roads, keeps season episode gaps and preserves favorite, edits and progress',()=>{
  assert.notEqual(canonicalWorkKey('测试剧 第一部'),canonicalWorkKey('测试剧 第二部'))
  const source={id:'road-a',libraryKey:'online-work',category:'tv',title:'测试剧 第二季',sourceName:'来源',road:'超清',episodes:[{id:'raw-url-id',number:1,season:2,title:'第1集',originalTitle:'第13集',url:'https://cdn.example/old.m3u8'},{id:'other-url',number:3,season:2,title:'第3集',url:'https://cdn.example/3.m3u8'}]}
  const saved=saveOnlineMedia(source,[],undefined,true)
  assert.equal(saved.favorite,true)
  assert.deepEqual(episodeLayout(saved.episodes,saved.title).map(ep=>ep.number),[1,3])
  saved.title='手动剧名';saved.progress[saved.episodes[0].id]={time:42,duration:100};saved.manual.title=true
  const updated=saveOnlineMedia({...source,id:'road-b'},[source],saved)
  assert.equal(updated.title,'手动剧名')
  assert.equal(updated.favorite,true)
  assert.equal(updated.webSources.length,2)
  assert.equal(updated.progress[updated.episodes[0].id].time,42)
  assert.ok(!JSON.stringify(publicOnlineSources(updated)).includes('cdn.example'))
})

test('saved online series survive backend restart, resolve without a search and renew expired URLs by provider identity',async(t)=>{
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const temp=await mkdtemp(path.join(os.tmpdir(),'huanyu-online-library-'))
  const data=path.join(temp,'data');await mkdir(data)
  await writeFile(path.join(data,'library.json'),JSON.stringify({media:[],games:[],settings:{deepseekAuto:false,showSamples:false}}))
  const marker=path.join(temp,'expired'),calls=path.join(temp,'requests.log'),preload=path.join(temp,'mock-fetch.mjs')
  await writeFile(preload,`import {existsSync,appendFileSync} from 'node:fs';
const marker=${JSON.stringify(marker)},log=${JSON.stringify(calls)};
globalThis.fetch=async(input)=>{const u=new URL(String(input));
 if(u.hostname==='cdn.example'){
  if(u.pathname.includes('/old/')&&existsSync(marker))return new Response('',{status:404});
  if(u.pathname.endsWith('master.m3u8'))return new Response('#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=1920x1080\\nvideo.m3u8');
  if(u.pathname.endsWith('.m3u8'))return new Response('#EXTM3U\\n#EXTINF:1,\\nvideo.ts\\n#EXT-X-ENDLIST');
  return new Response(Buffer.concat([Buffer.from([0x47]),Buffer.alloc(187)]));
 }
 if(u.hostname==='poster.example')return new Response(Buffer.from([255,216,255,224,0,16,74,70,73,70]),{headers:{'Content-Type':'image/jpeg'}});
 if(u.pathname.includes('api.php')){
  appendFileSync(log,(u.searchParams.has('ids')?'detail':'search')+'\\n');
  const base=existsSync(marker)?'new':'old';
  return Response.json({list:[{vod_id:123,vod_name:'测试电视剧 第二季',type_name:'国产剧',vod_content:'<p>剧集简介</p>',vod_pic:'https://poster.example/cover.jpg',vod_play_from:'m3u8',vod_play_url:'第13集$https://cdn.example/'+base+'/1/master.m3u8#第15集$https://cdn.example/'+base+'/3/master.m3u8'}]});
 }
 throw Error('Unexpected fixture request');
};`)
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})
  const origin=`http://127.0.0.1:${port}`
  let child
  const start=async()=>{
    child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.mjs'],{cwd:root,env:{...process.env,YINGYU_DATA_DIR:data,YINGYU_PORT:String(port)},stdio:['ignore','pipe','pipe']})
    await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(out)),10000);child.stdout.on('data',s=>{out+=s;if(out.includes('已启动')){clearTimeout(timer);resolve()}});child.stderr.on('data',s=>out+=s);child.on('error',reject)})
  }
  const stop=async()=>{if(child?.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill();await closed}}
  t.after(stop)
  const post=(route,body,method='POST')=>fetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)})
  await start()
  const found=await(await post('/web-sources/search',{keyword:'测试电视剧 第二季',category:'tv'})).json()
  assert.ok(found.results.length>=2)
  const source=found.results[0]
  const savedResponse=await post('/web-library',{resultId:source.id,favorite:true,episodeId:source.episodes[0].id})
  assert.equal(savedResponse.status,200,await savedResponse.clone().text())
  const saved=await savedResponse.json(),id=saved.id,episodeId=saved.episodeId
  const entry=saved.media.find(m=>m.id===id)
  assert.equal(entry.source,'url');assert.equal(entry.category,'tv');assert.equal(entry.favorite,true)
  assert.ok(entry.cover.startsWith('/covers/'))
  const poster=await fetch(origin+entry.cover)
  assert.equal(poster.status,200)
  assert.equal(poster.headers.get('content-type'),'image/jpeg')
  assert.ok((await poster.arrayBuffer()).byteLength>0)
  assert.equal(entry.description,'剧集简介')
  assert.deepEqual(entry.episodes.map(ep=>ep.episodeNumber),[1,3])
  assert.equal(entry.webSources,undefined)
  assert.ok(!JSON.stringify(saved).includes('cdn.example'))
  await post('/progress',{mediaId:id,episodeId,time:42,duration:120})
  await post('/media/'+id,{title:'自己的追剧名字',favorite:false},'PATCH')
  const repeated=await(await post('/web-library',{resultId:found.results[1].id})).json()
  assert.equal(repeated.media.length,1)
  assert.equal(repeated.media[0].title,'自己的追剧名字')
  assert.equal(repeated.media[0].favorite,false)
  assert.equal(repeated.media[0].progress[episodeId].time,42)
  await stop()
  await writeFile(marker,'expired');await writeFile(calls,'')
  await start()
  const restored=await(await fetch(origin+'/api/state')).json()
  assert.equal(restored.media[0].id,id)
  assert.equal(restored.media[0].progress[episodeId].time,42)
  const roads=await(await fetch(origin+'/api/media/'+id+'/online')).json()
  assert.ok(roads.results.length>=2)
  assert.ok(!JSON.stringify(roads).includes('cdn.example'))
  const play=await post('/web-stream',{mediaId:id,resultId:roads.preferredId,episodeId})
  assert.equal(play.status,200,await play.clone().text())
  assert.equal((await play.json()).format,'hls')
  const requests=await readFile(calls,'utf8')
  assert.ok(requests.includes('detail'))
  assert.ok(!requests.includes('search'),'reopening a saved show must not issue a title search')
  const disk=JSON.parse(await readFile(path.join(data,'library.json'),'utf8'))
  assert.ok(disk.media[0].webSources.find(s=>s.id===roads.preferredId).episodes[0].url.includes('/new/'))
  assert.equal((await post('/web-stream',{mediaId:id,resultId:'forged',episodeId})).status,404)
  assert.equal((await post('/web-library',{resultId:'forged'})).status,400)
})
