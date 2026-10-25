import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,readFile } from 'node:fs/promises'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createEmbeddedSubtitles,embeddedTracks,offsetVtt,subtitleContainer} from '../embedded-subtitles.mjs'
import {subtitleToVtt} from '../subtitles.mjs'
import {readMp4Index,readMp4TextTrack,readMediaRange} from '../mp4-subtitles.mjs'
const run=promisify(execFile),require=createRequire(import.meta.url)
test('embedded track metadata distinguishes text/bitmap, languages, defaults and demuxers',()=>{
 const tracks=embeddedTracks([{index:0,codec_type:'video'},{index:2,codec_type:'subtitle',codec_name:'ass',tags:{language:'chi',title:'简体中文'},disposition:{default:1}},{index:3,codec_type:'subtitle',codec_name:'hdmv_pgs_subtitle',tags:{language:'eng'}}])
 assert.equal(tracks.length,2);assert.match(tracks[0].label,/简体中文/);assert.equal(tracks[0].supported,true);assert.equal(tracks[0].default,true);assert.equal(tracks[1].supported,false)
 assert.equal(subtitleContainer('mp4'),'mov');assert.equal(subtitleContainer('matroska,webm'),'matroska');assert.equal(subtitleContainer('concat'),'')
 assert.match(offsetVtt('WEBVTT\n\n00:00:01.250 --> 00:00:03.000\n中文',150),/00:02:31.250 --> 00:02:33.000/)
})
test('actual MKV/MP4 inner subtitles probe, select, extract, seek and cache without altering video',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),data=await mkdtemp(path.join(os.tmpdir(),'yingyu-embedded-'))
 const zh=path.join(data,'zh.srt'),en=path.join(data,'en.srt'),mkv=path.join(data,'fixture.mkv'),mp4=path.join(data,'fixture.mp4')
 await writeFile(zh,'1\n00:00:00,100 --> 00:00:05,000\n内封中文字幕\n\n2\n00:02:40,000 --> 00:02:45,000\n跳转后中文字幕\n')
 await writeFile(en,'1\n00:00:00,100 --> 00:00:05,000\nEmbedded English\n')
 await run(require('ffmpeg-static'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=160x90:r=1:d=190','-i',zh,'-i',en,'-map','0:v','-map','1:s','-map','2:s','-c:v','libx264','-preset','ultrafast','-c:s','srt','-metadata:s:s:0','language=chi','-metadata:s:s:0','title=简体中文','-metadata:s:s:1','language=eng',mkv],{windowsHide:true})
 const service=await createEmbeddedSubtitles({root,data}),source={key:'fixture-mkv',container:'matroska',url:mkv}
 const info=await service.probe(source)
 assert.equal(info.tracks.length,2);assert.equal(info.tracks[0].language,'chi')
 const first=await service.extract(source,info.tracks[0].id,0)
 assert.match((await service.file(first.id)).toString(),/内封中文字幕/)
 const english=await service.extract(source,info.tracks[1].id,0)
 assert.match((await service.file(english.id)).toString(),/Embedded English/)
 assert.doesNotMatch((await service.file(english.id)).toString(),/内封中文/)
 const seek=await service.extract(source,info.tracks[0].id,160)
 const text=(await service.file(seek.id)).toString()
 assert.match(text,/00:02:40.000 --> 00:02:45.000/);assert.match(text,/跳转后中文字幕/)
 assert.deepEqual(await service.extract(source,info.tracks[0].id,160),seek)
 await assert.rejects(service.extract(source,'9999',0));await assert.rejects(service.file('../secret'))
 await run(require('ffmpeg-static'),['-hide_banner','-loglevel','error','-i',mkv,'-map','0','-c:v','copy','-c:s','mov_text',mp4],{windowsHide:true})
 const mp4source={key:'fixture-mp4',container:'mov',url:mp4},mp4info=await service.probe(mp4source)
 assert.equal(mp4info.tracks.length,2);assert.equal(mp4info.tracks[0].codec,'mov_text')
 const mp4track=await service.extract(mp4source,mp4info.tracks[0].id,0)
 assert.equal(mp4track.complete,true,'MP4 should read only indexed subtitle samples and cache the whole track')
 assert.match((await service.file(mp4track.id)).toString(),/内封中文字幕/)
 const reference=await run(require('ffmpeg-static'),['-hide_banner','-loglevel','error','-copyts','-i',mp4,'-map','0:1','-c:s','webvtt','-f','webvtt','pipe:1'],{windowsHide:true})
 assert.equal((await service.file(mp4track.id)).toString(),subtitleToVtt(Buffer.from(reference.stdout),'reference.vtt').vtt)
 assert.deepEqual(await service.extract({...mp4source,url:'C:/not-readable-after-caching.mp4'},mp4info.tracks[0].id,160),mp4track)
 const restarted=await createEmbeddedSubtitles({root,data})
 assert.deepEqual(await restarted.extract({...mp4source,url:'C:/not-readable-after-restart.mp4'},mp4info.tracks[0].id,160),mp4track)
 const bytes=await readFile(mp4)
 let calls=0,nonExactRanges=0,readBytes=0
 const server=http.createServer((req,res)=>{
   calls++
   const range=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '')
   if(!range){nonExactRanges++;res.writeHead(400);res.end();return}
   const start=Number(range[1]),end=Number(range[2]);readBytes+=end-start+1
   res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1})
   res.end(bytes.subarray(start,end+1))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
   const remote={key:'fixture-remote',container:'mov',url:`http://127.0.0.1:${server.address().port}/video`}
   const remoteInfo=await service.probe(remote)
   assert.equal(remoteInfo.tracks.length,2)
   const partial=await service.extract(remote,remoteInfo.tracks[0].id,0)
   assert.notEqual(partial.complete,true)
   assert.match((await service.file(partial.id)).toString(),/内封中文字幕/)
   assert.doesNotMatch((await service.file(partial.id)).toString(),/跳转后中文字幕/)
   const full=await service.prefetch(remote,remoteInfo.tracks[0].id)
   assert.equal(full.complete,true)
   assert.match((await service.file(full.id)).toString(),/跳转后中文字幕/)
   const before=calls
   assert.deepEqual(await service.extract(remote,remoteInfo.tracks[0].id,160),full)
   assert.equal(calls,before,'seeking must reuse the complete subtitle without network access')
   assert.equal(nonExactRanges,0,'never ask the server for a full video or open-ended video range')
   assert.ok(readBytes<bytes.length,'index and text-only reads should skip the video payload')
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 const corrupted=Buffer.from(bytes),stsz=corrupted.indexOf('stsz')
 assert.ok(stsz>0);corrupted.writeUInt32BE(0xffffffff,stsz+12)
 await assert.rejects(readMp4Index({},async(_source,start,length)=>corrupted.subarray(start,start+length)),/兼容读取/)
 const index=await readMp4Index(mp4source)
 const direct=await readMp4TextTrack(mp4source,index,mp4info.tracks[1].id)
 assert.match(direct.vtt,/Embedded English/);assert.doesNotMatch(direct.vtt,/内封中文/)
 await assert.rejects(readMediaRange({url:'https://evil.test/media'},0,8),/本机播放代理/)
 await assert.rejects(readMediaRange(mp4source,-1,8),/范围无效/)
})
