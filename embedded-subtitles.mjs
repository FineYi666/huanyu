import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { subtitleToVtt, MAX_SUBTITLE_BYTES } from './subtitles.mjs'
import { readMp4Index, readMp4TextTrack } from './mp4-subtitles.mjs'
const require = createRequire(import.meta.url)
const TEXT_CODECS = new Set(['ass','ssa','subrip','webvtt','mov_text','text'])
const LANGUAGES = {chi:'中文',zho:'中文',zh:'中文',eng:'英语',en:'英语',jpn:'日语',ja:'日语',kor:'韩语',fra:'法语',fre:'法语',ger:'德语',deu:'德语',ind:'印度尼西亚语',may:'马来语',pol:'波兰语',tha:'泰语',vie:'越南语',spa:'西班牙语',und:'未标注语言'}
export function embeddedTracks(streams = []) {
  return streams.filter(s=>s.codec_type === 'subtitle').map(s=>({
    id:String(s.index),index:s.index,language:s.tags?.language || 'und',
    label:[s.tags?.title,LANGUAGES[s.tags?.language] || s.tags?.language || '未标注语言',s.codec_name?.toUpperCase(),`轨道 ${s.index}`].filter(Boolean).join(' · '),
    supported:TEXT_CODECS.has(s.codec_name),codec:s.codec_name || 'unknown',default:Boolean(s.disposition?.default),
  }))
}
export function subtitleContainer(value) {
  if(/^(?:mov|mp4|m4v|m4a|3gp)/i.test(value))return 'mov'
  if(/^(?:matroska|mkv|webm)/i.test(value))return 'matroska'
  return ''
}
export function offsetVtt(text, seconds) {
  const timestamp = value => {const p=value.split(':').map(Number);return p[0]*3600+p[1]*60+p[2]}
  const format = value => {const ms=Math.round(value*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`}
  return text.replace(/^(\d{2,}:\d{2}:\d{2}\.\d{3}) --> (\d{2,}:\d{2}:\d{2}\.\d{3})/gm,(_,a,b)=>`${format(timestamp(a)+seconds)} --> ${format(timestamp(b)+seconds)}`)
}
function run(executable,args,{timeout=35000,limit=MAX_SUBTITLE_BYTES}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']})
    const chunks=[];let size=0,settled=false
    const finish=(error,bytes)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(bytes)}
    const timer=setTimeout(()=>{child.kill();finish(new Error('读取视频自带字幕超时，可重试或使用外挂字幕'))},timeout)
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>limit){child.kill();finish(new Error('视频字幕超出读取大小限制'))}else chunks.push(chunk)})
    // Tool diagnostics contain private paths and signed URLs; never expose them.
    child.stderr.resume()
    child.on('error',()=>finish(new Error('字幕解析组件不可用，请重新安装最新版映屿')))
    child.on('close',code=>finish(code===0?null:new Error('此播放源的内封字幕暂时无法读取，可重试或改用其他资源'),Buffer.concat(chunks)))
  })
}
export async function createEmbeddedSubtitles({root,data}) {
  const directory=path.join(data,'embedded-subtitles');await mkdir(directory,{recursive:true})
  const binary = name => {
    const packaged=path.join(root,'runtime',name+'.exe')
    return stat(packaged).then(()=>packaged).catch(()=>name==='ffmpeg'?require('ffmpeg-static'):require('ffprobe-static').path)
  }
  const probing=new Map(), pending=new Map()
  const indexes = new Map(), slowTracks = new Set()
  let active=0
  let backgroundReads=0
  const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,32)
  async function mp4Index(source) {
    if (indexes.has(source.key)) return indexes.get(source.key)
    const operation = (async () => {
      const name=path.join(directory,hash('mp4-index-v1/'+source.key)+'.json')
      try { const value=JSON.parse(await readFile(name,'utf8')); if(value.tracks && Number.isFinite(value.duration))return value }catch{}
      const value=await readMp4Index(source)
      await writeFile(name+'.tmp',JSON.stringify(value));await rename(name+'.tmp',name)
      return value
    })()
    indexes.set(source.key,operation)
    if(indexes.size>16)indexes.delete(indexes.keys().next().value)
    operation.catch(()=>indexes.delete(source.key))
    return operation
  }
  const inputArgs=source=>['-protocol_whitelist','file,http,tcp','-rw_timeout','12000000','-probesize','8000000','-analyzeduration','3000000','-f',source.container]
  async function fullTrack(source,trackId) {
    const id=hash(`mp4-full-v1/${source.key}/${trackId}`),file=path.join(directory,id+'.vtt'),metaFile=path.join(directory,id+'.json')
    try {const meta=JSON.parse(await readFile(metaFile,'utf8'));await stat(file);if(Number.isFinite(meta.end))return {id,url:`/api/subtitles/embedded/${id}.vtt`,start:0,end:meta.end,complete:true}}catch{}
    if(pending.has(id))return pending.get(id)
    if(backgroundReads>=2)throw new Error('正在缓存其他字幕')
    const operation=(async()=>{
      backgroundReads++
      try {
      const result=await readMp4TextTrack({...source,signal:AbortSignal.timeout(60000)},await mp4Index(source),trackId)
      await writeFile(file+'.tmp',result.vtt);await rename(file+'.tmp',file)
      const end=result.duration+1
      await writeFile(metaFile,JSON.stringify({end}))
      return {id,url:`/api/subtitles/embedded/${id}.vtt`,start:0,end,complete:true}
      }finally{backgroundReads--}
    })()
    pending.set(id,operation)
    try{return await operation}finally{pending.delete(id)}
  }
  return {
    async prefetch(source,trackId){return fullTrack(source,trackId)},
    async probe(source) {
      if(!source.container)return {tracks:[],message:'当前封装不支持读取内封字幕；播放流字幕仍可在下方选择'}
      if(probing.has(source.key))return probing.get(source.key)
      const promise=(async()=>{
        if(active>=3)throw new Error('正在读取其他字幕，请稍后重试')
        active++
        try {
          if(source.container==='mov') {
            try {
              const index=await mp4Index(source)
              const tracks=embeddedTracks(index.tracks.filter(t=>t.isSubtitle).map(t=>({index:t.index,codec_type:'subtitle',codec_name:t.codec,tags:{language:t.language,title:t.title==='SubtitleHandler'?'':t.title}})))
              return {tracks,message:'已读取视频字幕索引，优先中文字幕'}
            }catch{}
          }
          const bytes=await run(await binary('ffprobe'),['-v','error',...inputArgs(source),'-select_streams','s','-show_streams','-of','json','-i',source.url],{limit:2*1024*1024})
          const tracks=embeddedTracks(JSON.parse(bytes.toString()).streams)
          return {tracks,message:tracks.length?'已识别视频自带字幕，优先中文字幕':'当前播放源未提供可读取的内封字幕'}
        }finally{active--}
      })()
      probing.set(source.key,promise)
      promise.catch(()=>probing.delete(source.key))
      if(probing.size>100)probing.delete(probing.keys().next().value)
      return promise
    },
    async extract(source,trackId,time=0) {
      const fullId=hash(`mp4-full-v1/${source.key}/${trackId}`),fullFile=path.join(directory,fullId+'.vtt'),metaFile=path.join(directory,fullId+'.json')
      if(source.container==='mov')try {
        const meta=JSON.parse(await readFile(metaFile,'utf8'));await stat(fullFile)
        if(Number.isFinite(meta.end))return {id:fullId,url:`/api/subtitles/embedded/${fullId}.vtt`,start:0,end:meta.end,complete:true}
      }catch{}
      const info=await this.probe(source)
      const track=info.tracks.find(t=>t.id===String(trackId))
      if(!track || !track.supported)throw new Error('此字幕为图片字幕或不支持的格式，可改用文字字幕或系统播放器')
      if(source.container==='mov' && track.codec==='mov_text' && !slowTracks.has(fullId)) {
        if(!/^http:/i.test(source.url))return fullTrack(source,trackId)
        const start=Math.max(0,Math.floor(time/60)*60-15),end=start+135
        const id=hash(`mp4-window-v1/${source.key}/${trackId}/${start}`),file=path.join(directory,id+'.vtt')
        const result={id,url:`/api/subtitles/embedded/${id}.vtt`,start,end}
        try{await stat(file);void fullTrack(source,trackId).catch(()=>{});return result}catch{}
        if(pending.has(id))return pending.get(id)
        const operation=(async()=>{
          try{
            const value=await readMp4TextTrack(source,await mp4Index(source),trackId,undefined,{start,end})
            await writeFile(file+'.tmp',value.vtt);await rename(file+'.tmp',file)
            void fullTrack(source,trackId).catch(()=>{})
            return result
          }catch{
            slowTracks.add(fullId)
            if(slowTracks.size>100)slowTracks.delete(slowTracks.values().next().value)
            return this.extract(source,trackId,time)
          }
        })()
        pending.set(id,operation)
        try{return await operation}finally{pending.delete(id)}
      }
      const start=Math.max(0,Math.floor(time/60)*60-15),end=start+135
      const id=hash(`v2/${source.key}/${track.id}/${start}`),file=path.join(directory,id+'.vtt')
      try {await stat(file);return {id,url:`/api/subtitles/embedded/${id}.vtt`,start,end}}catch{}
      if(pending.has(id))return pending.get(id)
      const promise=(async()=>{
        if(active>=3)throw new Error('正在读取其他字幕，请稍后重试')
        active++
        try {
          const bytes=await run(await binary('ffmpeg'),['-hide_banner','-loglevel','error','-nostdin',...inputArgs(source),'-discard:v','all','-discard:a','all','-copyts','-ss',String(start),'-i',source.url,'-map',`0:${track.index}`,'-to',String(end),'-c:s','webvtt','-f','webvtt','pipe:1'],{timeout:55000})
          let vtt='WEBVTT\n\n'
          if(bytes.toString().includes('-->'))vtt=subtitleToVtt(bytes,'embedded.vtt').vtt
          await writeFile(file,vtt)
          return {id,url:`/api/subtitles/embedded/${id}.vtt`,start,end}
        }finally{active--}
      })()
      pending.set(id,promise)
      try{return await promise}finally{pending.delete(id)}
    },
    async file(id){if(!/^[a-f0-9]{32}$/.test(id))throw new Error('字幕不存在');return readFile(path.join(directory,id+'.vtt'))},
  }
}
