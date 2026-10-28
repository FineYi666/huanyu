import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { api } from './api'
import Dialog from './ui'
import OnlinePlayer, { type WebSourceResult } from './OnlinePlayer'
import type { Media, Episode } from './types'

export default function SavedOnlinePlayer({media,initialEpisode,autoNext,onClose,onProgress,onFavorite}: {
  media:Media;initialEpisode:Episode;autoNext:boolean;onClose:()=>void;onProgress:()=>void;onFavorite:()=>void
}) {
  const [data,setData]=useState<{results:WebSourceResult[];preferredId:string}|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    api<{results:WebSourceResult[];preferredId:string}>(`/media/${media.id}/online`).then(value=>{if(active)setData(value)}).catch(err=>{if(active)setError(err.message)})
    return()=>{active=false}
  },[media.id])
  const selected=data?.results.find(item=>item.id===data.preferredId && item.episodes.some(ep=>ep.id===initialEpisode.id)) || data?.results.find(item=>item.episodes.some(ep=>ep.id===initialEpisode.id))
  const episode=selected?.episodes.find(ep=>ep.id===initialEpisode.id)
  if(selected && episode)return <OnlinePlayer results={data!.results} initialResult={selected} initialEpisode={episode} libraryMedia={media} onFavorite={onFavorite} onProgress={onProgress} autoNext={autoNext} onClose={onClose} onInvalid={()=>{}} />
  return <Dialog title={media.title} onClose={onClose}><div className="season-empty">{!data&&!error?<LoaderCircle className="spin" size={28}/>:null}<h3>{error || (data?'本集没有可用线路，请重新选择资源':'正在打开观看记录…')}</h3></div></Dialog>
}
