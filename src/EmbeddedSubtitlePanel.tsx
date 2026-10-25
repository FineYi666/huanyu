import { useEffect, useRef, useState, type RefObject } from 'react'
import { Captions, LoaderCircle, RefreshCw, FilePlus2 } from 'lucide-react'
import { api } from './api'
import type { NativeSubtitleTrack } from './StreamVideo'
import type { SubtitleTrack } from './SubtitlePanel'
type Track = {id:string;label:string;language:string;supported:boolean;default?:boolean}
type Props={mediaId:string;episodeId:string;context:string;video:RefObject<HTMLVideoElement|null>;nativeTracks:NativeSubtitleTrack[];onNative:(id:string)=>void;onTrack:(track:(SubtitleTrack & {delay:number})|null)=>void;onAvailable:(value:boolean)=>void;externalMode:boolean;onExternal:()=>void}
export default function EmbeddedSubtitlePanel({mediaId,episodeId,context,video,nativeTracks,onNative,onTrack,onAvailable,externalMode,onExternal}:Props){
  const [tracks,setTracks]=useState<Track[]>([]),[choice,setChoice]=useState('auto'),[busy,setBusy]=useState('正在识别视频自带字幕…'),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[probed,setProbed]=useState(false)
  const [readState,setReadState]=useState<'idle'|'partial'|'full'>('idle')
  const callbacks=useRef({onNative,onTrack,onAvailable});callbacks.current={onNative,onTrack,onAvailable}
  const key=`yingyu:embedded:${mediaId}/${episodeId}`
  const all=[...nativeTracks.map(t=>({...t,id:t.id,supported:true})),...tracks.map(t=>({...t,id:'file:'+t.id}))]
  const signature=JSON.stringify(all)
  const available=all.length>0
  useEffect(()=>{
    let active=true
    try{setChoice(localStorage.getItem(key)||'auto')}catch{}
    setBusy('正在识别视频自带字幕…');setError('');setProbed(false)
    api<{tracks:Track[]}>('/subtitles/embedded',{mediaId,episodeId,context}).then(result=>{if(active)setTracks(result.tracks)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active){setBusy('');setProbed(true)}})
    return ()=>{active=false}
  },[mediaId,episodeId,context,attempt,key])
  useEffect(()=>{if(probed || nativeTracks.length)callbacks.current.onAvailable(available)},[probed,available,nativeTracks.length])
  useEffect(()=>{
    if(externalMode || !probed)return
    if(choice!=='auto' && choice!=='off' && !all.some(t=>t.id===choice)){setChoice('auto');return}
    if(choice==='auto'){
      const selected=all.filter(t=>t.supported).sort((a,b)=>Number(/^(zh|chi|zho)/i.test(b.language))-Number(/^(zh|chi|zho)/i.test(a.language)) || Number(!!b.default)-Number(!!a.default))[0]
      if(selected)setChoice(selected.id)
      else if(all.length)setChoice('off')
    }
  },[signature,choice,probed,externalMode])
  useEffect(()=>{
    setReadState('idle')
    if(externalMode){setBusy('');return}
    callbacks.current.onTrack(null)
    callbacks.current.onNative(choice.startsWith('native:')?choice:'off')
    if(!choice.startsWith('file:')){if(choice!=='auto')setBusy('');return}
    const track=all.find(t=>t.id===choice)
    if(!track?.supported)return
    let active=true,loading=false,revision=0,loaded:{start:number;end:number;complete?:boolean}|null=null,retryAfter=0
    const update=async()=>{
      if(!video.current || video.current.readyState<1)return
      const time=video.current?.currentTime || 0
      if(loading || Date.now()<retryAfter || (loaded && time>=loaded.start && time<loaded.end-(loaded.complete?0:60)))return
      loading=true;const request=++revision
      setBusy('正在读取所选内封字幕…');setError('')
      try{
        const result=await api<{id:string;url:string;start:number;end:number;complete?:boolean}>('/subtitles/embedded',{mediaId,episodeId,context,trackId:choice.slice(5),time})
        if(!active || request!==revision)return
        loaded=result
        setReadState(result.complete?'full':'partial')
        const now=video.current?.currentTime || 0
        if(now>=result.start && now<result.end)callbacks.current.onTrack({id:'embedded:'+result.id,url:result.url,label:track.label,language:track.language,origin:'embedded',delay:0})
        else loaded=null
      }catch(e){if(active){setError((e as Error).message);retryAfter=Date.now()+30000}}
      finally{loading=false;if(active)setBusy('')}
    }
    void update()
    const element=video.current
    const changed=()=>queueMicrotask(()=>{if(active)void update()})
    element?.addEventListener('loadedmetadata',changed)
    element?.addEventListener('seeked',changed)
    const timer=setInterval(()=>void update(),1000)
    return ()=>{active=false;++revision;clearInterval(timer);element?.removeEventListener('loadedmetadata',changed);element?.removeEventListener('seeked',changed);callbacks.current.onTrack(null)}
  },[choice,signature,context,mediaId,episodeId,video,externalMode,attempt])
  function select(id:string){setChoice(id);setError('');try{localStorage.setItem(key,id)}catch{}}
  return <section className="subtitle-panel embedded-subtitle-panel" aria-label="视频自带字幕">
    <div className="subtitle-heading"><span><Captions size={18}/><strong>视频自带字幕</strong><i>{busy?<LoaderCircle size={12} className="spin"/>:externalMode?'已切换外挂':choice==='off'?'已关闭':available?`${all.length} 条轨道`:'未发现'}</i></span><div><button className="button subtle" onClick={()=>setAttempt(v=>v+1)} disabled={!!busy}><RefreshCw size={13}/>重新识别</button><button className="button subtle" onClick={onExternal}><FilePlus2 size={13}/>{externalMode?'返回自带字幕':'使用外挂字幕'}</button></div></div>
    <div className="subtitle-controls"><label><span>自带字幕轨道</span><select aria-label="自带字幕轨道" value={externalMode?'off':choice} onChange={e=>select(e.target.value)} disabled={externalMode}><option value="auto">自动选择 · 优先中文</option><option value="off">关闭视频自带字幕</option>{all.map(t=><option key={t.id} value={t.id} disabled={!t.supported}>{t.label}{t.supported?'':' · 图片字幕暂不支持'}</option>)}</select></label></div>
    <p className="subtitle-status" role="status">{busy || error || (externalMode?'正在使用外挂字幕。关闭外挂后可重新选择自带轨道。':choice==='off'?'视频自带字幕已关闭。':readState==='full'?'整集字幕已缓存，快进无需重新读取。':readState==='partial'?'当前字幕已就绪，其余内容在后台缓存。':available?'直接使用视频里的字幕，不需要另找字幕。':'此播放源未暴露可读取的字幕，仍可载入或搜索外挂字幕。')}</p>
  </section>
}
