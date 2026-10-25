import test from 'node:test'
import assert from 'node:assert/strict'
import {createQuark} from '../quark.mjs'
test('missing saved videos can be restored once with explicit consent and retain library progress',async()=>{
 const original=globalThis.fetch
 const episode={id:'episode',fid:'shared-file',savedFid:'deleted-file',parentFid:'folder'}
 const media={id:'work',shareId:'share',title:'作品',favorite:true,progress:{episode:{time:300,duration:1000}},episodes:[episode]}
 let saves=0,calls=0
 globalThis.fetch=async(input,options)=>{
  calls++;const url=new URL(input),body=options.body?JSON.parse(options.body):{}
  if(url.pathname.endsWith('/file/download')){
   if(body.fids[0]==='deleted-file')return Response.json({status:404,code:32002,message:'文件不存在'})
   assert.equal(body.fids[0],'new-saved-file');return Response.json({code:0,data:[{download_url:'https://video.quark.cn/restored.mp4'}]})
  }
  if(url.pathname.endsWith('/sharepage/token'))return Response.json({code:0,data:{stoken:'fresh'}})
  if(url.pathname.endsWith('/sharepage/detail'))return Response.json({code:0,data:{list:[{fid:'shared-file',share_fid_token:'fresh-file-token'}]}})
  if(url.pathname.endsWith('/sharepage/save')){saves++;assert.deepEqual(body.fid_list,['shared-file']);return Response.json({code:0,data:{task_id:'save-task'}})}
  if(url.pathname.endsWith('/task'))return Response.json({code:0,data:{save_as:{save_as_top_fids:['new-saved-file']}}})
  throw new Error('Unexpected endpoint')
 }
 try{
  const quark=createQuark(()=> 'test=credential')
  await assert.rejects(quark.getStream(media,episode,false),e=>e.needsRestore===true)
  const before=calls
  await assert.rejects(quark.getStream(media,episode,false,{restore:true}),e=>e.needsSave===true)
  assert.equal(calls,before);assert.equal(saves,0);assert.equal(episode.savedFid,'deleted-file')
  const results=await Promise.all([quark.getStream(media,episode,true,{restore:true}),quark.getStream(media,episode,true,{restore:true})])
  assert.equal(saves,1);assert.equal(episode.savedFid,'new-saved-file');assert.equal(results[0].url,results[1].url)
  assert.equal(media.favorite,true);assert.equal(media.title,'作品');assert.equal(media.progress.episode.time,300)
  await quark.getStream(media,episode,false);assert.equal(saves,1,'normal retries reuse the restored file')
 }finally{globalThis.fetch=original}
})
test('failed restore retains the old binding; completed transfer is retained even if playback fails',async()=>{
 const original=globalThis.fetch,episode={id:'ep',fid:'shared',savedFid:'old'},media={shareId:'share',episodes:[episode]}
 let shareExpired=true,saves=0
 globalThis.fetch=async(input)=>{
  const path=new URL(input).pathname
  if(path.endsWith('/sharepage/token'))return shareExpired?Response.json({code:41001,message:'分享已取消'}):Response.json({code:0,data:{stoken:'fresh'}})
  if(path.endsWith('/sharepage/detail'))return Response.json({code:0,data:{list:[{fid:'shared',share_fid_token:'fresh'}]}})
  if(path.endsWith('/sharepage/save')){saves++;return Response.json({code:0,data:{task_id:'task'}})}
  if(path.endsWith('/task'))return Response.json({code:0,data:{save_as:{save_as_top_fids:['restored']}}})
  if(path.endsWith('/file/download'))return Response.json({code:403,message:'播放权限受限'})
  throw new Error('Unexpected endpoint')
 }
 try{
  const quark=createQuark(()=> 'test=credential')
  await assert.rejects(quark.getStream(media,episode,true,{restore:true}),/分享已取消/)
  assert.equal(episode.savedFid,'old');assert.equal(saves,0)
  shareExpired=false
  await assert.rejects(quark.getStream(media,episode,true,{restore:true}),/播放权限受限/)
  assert.equal(episode.savedFid,'restored');assert.equal(saves,1)
 }finally{globalThis.fetch=original}
})
