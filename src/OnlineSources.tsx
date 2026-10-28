import { useState } from 'react'
import { LoaderCircle, Play, Radio, Heart } from 'lucide-react'
import type { WebEpisode, WebSourceResult } from './OnlinePlayer'
import Poster from './Poster'
import { api } from './api'
import type { AppState, Media } from './types'

export default function OnlineSources({ results, busy, error, library, onLibraryChange, onPlaySaved }: {
  results: WebSourceResult[] | null
  busy: boolean
  error: string
  onInvalid: (resultId: string, episodeId: string) => void
  library: Media[]
  onLibraryChange: (state:AppState)=>void
  onPlaySaved: (state:AppState,id:string,episodeId:string)=>void
}) {
  const [saving,setSaving]=useState('')
  const [savingFavorite,setSavingFavorite]=useState(false)
  const [saveError,setSaveError]=useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  async function save(item:WebSourceResult,episode?:WebEpisode,favorite?:boolean) {
    setSaving(item.id);setSavingFavorite(!episode);setSaveError('')
    try {
      const value=await api<AppState & {id:string;episodeId:string}>('/web-library',{resultId:item.id,episodeId:episode?.id,favorite})
      if(episode)onPlaySaved(value,value.id,value.episodeId)
      else onLibraryChange(value)
    }catch(err){setSaveError((err as Error).message)}finally{setSaving('')}
  }
  function play(item:WebSourceResult,episode:WebEpisode) {
    void save(item,episode)
  }
  return <div className="web-sources-block" aria-live="polite" aria-busy={busy}>
    <div className="web-sources-head">
      <strong><Radio size={15} /> 在线片源 · 已校验入口</strong>
      <span>{results?.[0]?.category==='anime'?'动漫优先 DDYS / giriGiriLove / AGE；同来源优先超清，每集播放前再次校验':'优先超清线路；核对片名、季度与类型，每集播放前再次校验'}</span>
    </div>
    {saveError&&<div className="form-error" role="alert">{saveError}</div>}
    {busy ? <div className="season-empty"><LoaderCircle size={24} className="spin" /><h3>正在查找可播放的线路…</h3><p>正在核对片名并检查播放入口，请稍候。</p></div>
      : error ? <p className="web-sources-error" role="alert">{error}</p>
      : results?.length ? <div className="web-source-list">
        {results.map(item => <article className="web-source-card" key={item.id}>
          <Poster src={item.cover} title={item.title} />
          <div className="web-source-copy">
            <h4>{item.title}</h4>
            <span className={`online-quality ${item.height ? 'confirmed' : ''}`}>{item.quality || '清晰度待确认'}{item.width && item.height ? ` · ${item.width}×${item.height}` : ''}</span>
            <span>{item.sourceName} · {item.road}{item.year ? ` · ${item.year}` : ''}{item.remarks ? ` · ${item.remarks}` : ''} · {item.episodes.length} 集</span>
            <div className="web-source-episodes">
              <button type="button" className="online-play-entry" disabled={!!saving} onClick={() => play(item,item.episodes.find(ep => ep.id === item.checkedEpisode) || item.episodes[0])}>{saving===item.id&&!savingFavorite?<LoaderCircle size={12} className="spin"/>:<Play size={12} fill="currentColor"/>} 立即播放</button>
              <button type="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? '收起选集' : `选择 ${item.episodes.length} 集`}</button>
              <button type="button" className="online-save-button" disabled={!!saving} aria-pressed={Boolean(library.find(media=>media.id===item.libraryKey)?.favorite)} onClick={()=>void save(item,undefined,!library.find(media=>media.id===item.libraryKey)?.favorite)}>{saving===item.id&&savingFavorite?<LoaderCircle size={13} className="spin"/>:<Heart size={13} fill={library.find(media=>media.id===item.libraryKey)?.favorite?'currentColor':'none'}/>} {saving===item.id&&savingFavorite?'正在保存…':library.find(media=>media.id===item.libraryKey)?.favorite?'已收藏':'收藏到片库'}</button>
            </div>
            {expanded === item.id && <div className="web-source-episodes online-episode-grid" aria-label={`${item.title}选集`}>
              {item.episodes.map(episode => <button key={episode.id} title={episode.originalTitle} disabled={!!saving} type="button" onClick={() => play(item,episode)}>{episode.title}</button>)}
            </div>}
          </div>
        </article>)}
      </div>
        : results ? <div className="online-no-results"><h3>没有找到符合条件的在线片源</h3><p>可以尝试完整片名与季数，或导入已有的超清夸克分享链接。</p></div> : null}
  </div>
}
