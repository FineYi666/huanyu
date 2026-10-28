import { useState } from 'react'
import { Heart, LoaderCircle } from 'lucide-react'
import { api } from './api'
import type { AppState, Media } from './types'

export default function CatalogFavoriteButton({subjectId,title,media,onChange}:{subjectId:string;title:string;media:Media[];onChange:(state:AppState)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const favorite=media.some(item=>item.source!=='sample' && item.subjectId===subjectId && item.favorite)
  async function toggle(){setBusy(true);setError('');try{onChange(await api<AppState>('/catalog/favorite',{subjectId,favorite:!favorite}))}catch(reason){setError((reason as Error).message)}finally{setBusy(false)}}
  return <span className="catalog-favorite-control"><button type="button" className={`catalog-favorite ${favorite?'active':''}`} aria-label={`${favorite?'取消收藏':'收藏'}${title}`} aria-pressed={favorite} disabled={busy} onClick={()=>void toggle()}>{busy?<LoaderCircle size={15} className="spin"/>:<Heart size={15} fill={favorite?'currentColor':'none'}/>}<span>{favorite?'已收藏':'收藏'}</span></button>{error&&<small role="alert">{error}</small>}</span>
}
