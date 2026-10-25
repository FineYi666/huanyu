import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { replaceMediaSource } from '../replace-source.mjs'
const {allowFullscreen}=createRequire(import.meta.url)('../desktop/permissions.cjs')
test('fullscreen permissions only allow the player origin and explicit fullscreen',()=>{
  const origin='http://127.0.0.1:4317'
  assert.equal(allowFullscreen('fullscreen',origin+'/player',origin),true)
  for(const url of ['https://evil.test', 'http://127.0.0.1:4318', 'invalid']) assert.equal(allowFullscreen('fullscreen',url,origin),false)
  for(const permission of ['automatic-fullscreen','camera','microphone','notifications']) assert.equal(allowFullscreen(permission,origin,origin),false)
})
const current={id:'stable',source:'quark',title:'作品',cover:'poster',description:'介绍',category:'movie',subjectId:'subject',favorite:true,shareUrl:'old',stoken:'private',subtitleFiles:[{}],episodes:[{id:'one',fid:'f1',savedFid:'saved'}],progress:{one:{time:30}}}
test('reselecting replaces bindings while preserving work identity and metadata',()=>{
 const result=replaceMediaSource(current,{source:'local',episodes:[{id:'new',path:'C:/new.mp4'}]})
 for(const key of ['id','title','cover','description','category','subjectId','favorite'])assert.equal(result[key],current[key])
 assert.equal(result.source,'local');assert.equal(result.shareUrl,undefined);assert.equal(result.stoken,undefined);assert.equal(result.subtitleFiles,undefined)
 assert.deepEqual(result.progress,{});assert.equal(result.sourceRevision,1);assert.equal(current.source,'quark')
})
test('unchanged files retain transfer identity and progress, ID collisions reset both',()=>{
 const same=replaceMediaSource(current,{source:'quark',shareUrl:'new',episodes:[{id:'one',fid:'f1'}]})
 assert.equal(same.episodes[0].savedFid,'saved');assert.equal(same.progress.one.time,30)
 const other=replaceMediaSource(current,{source:'quark',episodes:[{id:'one',fid:'f2'}]})
 assert.equal(other.episodes[0].savedFid,undefined);assert.deepEqual(other.progress,{})
})
test('invalid or empty replacement leaves the old source intact',()=>{
 assert.throws(()=>replaceMediaSource(current,{source:'local',episodes:[]}))
 assert.throws(()=>replaceMediaSource(current,{source:'url',episodes:[{}]}))
 assert.equal(current.episodes[0].fid,'f1');assert.equal(current.shareUrl,'old')
})
