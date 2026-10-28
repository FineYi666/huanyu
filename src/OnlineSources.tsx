import { useState } from 'react'
import { LoaderCircle, Play, Radio } from 'lucide-react'
import OnlinePlayer, { type WebEpisode, type WebSourceResult } from './OnlinePlayer'
import Poster from './Poster'

export default function OnlineSources({ results, busy, error, onInvalid }: {
  results: WebSourceResult[] | null
  busy: boolean
  error: string
  onInvalid: (resultId: string, episodeId: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [playing, setPlaying] = useState<{ result: WebSourceResult; episode: WebEpisode } | null>(null)
  return <div className="web-sources-block" aria-live="polite" aria-busy={busy}>
    <div className="web-sources-head">
      <strong><Radio size={15} /> 在线片源 · 已校验入口</strong>
      <span>优先超清线路；核对片名、季度与类型，每集播放前再次校验</span>
    </div>
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
              <button type="button" className="online-play-entry" onClick={() => setPlaying({ result: item, episode: item.episodes.find(ep => ep.id === item.checkedEpisode) || item.episodes[0] })}><Play size={12} fill="currentColor" /> 立即播放</button>
              <button type="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? '收起选集' : `选择 ${item.episodes.length} 集`}</button>
            </div>
            {expanded === item.id && <div className="web-source-episodes online-episode-grid" aria-label={`${item.title}选集`}>
              {item.episodes.map(episode => <button key={episode.id} title={episode.originalTitle} type="button" onClick={() => setPlaying({ result: item, episode })}>{episode.title}</button>)}
            </div>}
          </div>
        </article>)}
      </div>
        : results ? <div className="online-no-results"><h3>没有找到符合条件的在线片源</h3><p>可以尝试完整片名与季数，或导入已有的超清夸克分享链接。</p></div> : null}
    {playing && <OnlinePlayer initialResult={playing.result} initialEpisode={playing.episode} results={results || []} onClose={() => setPlaying(null)} onInvalid={onInvalid} />}
  </div>
}
