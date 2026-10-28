import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Cloud, LoaderCircle, Search, Tv } from 'lucide-react'
import OnlineSources from './OnlineSources'
import type { WebSourceResult } from './OnlinePlayer'

type SourceStatus = { name: string; status: string; count: number }
export default function TvSearch({ query, onQuery, onImport }: {
  query: string
  onQuery: (query: string) => void
  onImport: () => void
}) {
  const [results, setResults] = useState<WebSourceResult[] | null>(null)
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState('')
  const [uhd, setUhd] = useState(true)
  const [searchedUhd, setSearchedUhd] = useState(true)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function search() {
    const keyword = query.trim()
    if (keyword.length < 2) { setError('请输入至少两个字的电视剧名称'); return }
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError('')
    setResults(null)
    setSources([])
    setSearched(keyword)
    setSearchedUhd(uhd)
    try {
      const response = await fetch('/api/web-sources/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, category: 'tv', minHeight: uhd ? 1080 : 0 }), signal: controller.signal,
      })
      const data = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(data.error || '搜索暂时不可用，请稍后重试')
      setResults(data.results || [])
      setSources(data.sources || [])
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const stale = searched !== query.trim() || searchedUhd !== uhd
  return <section className="tv-search" aria-label="电视剧在线搜索">
    <div className="tv-search-intro">
      <div className="tv-search-copy">
        <span className="season-kicker"><Tv size={15} /> SERIES COLLECTION</span>
        <h2>下一集好故事，<br />在这里继续。</h2>
        <p>从夸克收藏整部剧集，或按片名寻找在线线路。选好一集，就能开始播放。</p>
      </div>
      <div className="tv-search-tools">
        <form className="tv-query" onSubmit={event => { event.preventDefault(); void search() }}>
          <label htmlFor="tv-keyword">找一部想看的电视剧</label>
          <div><Search size={18} /><input id="tv-keyword" value={query} onChange={event => onQuery(event.target.value)} placeholder="输入完整剧名，如：琅琊榜、庆余年 第二季" maxLength={80} /><button className="button primary" type="submit">{busy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />} 搜索在线片源</button></div>
        </form>
        <div className="tv-import-hint"><span>已经有夸克分享链接？</span><button type="button" onClick={onImport}><Cloud size={15} /> 导入电视剧 <ArrowUpRight size={14} /></button></div>
        <label className="tv-quality-filter"><input type="checkbox" checked={uhd} onChange={event => setUhd(event.target.checked)} /> 超清优先 <span>1080P / 2K / 4K</span></label>
        <p className="tv-search-note">{uhd ? '过滤已知低于 1080P 的线路；未能识别分辨率的片源标注「待确认」。' : '显示所有通过播放校验的画质，超清排在前面。'} 默认播放最高可用画质。</p>
      </div>
    </div>
    {(busy || error || results) && <div className="tv-search-results">
      {searched && <div className="tv-result-heading"><h3>“{searched}”的在线线路</h3>{stale && <span>关键词已更改，点击搜索更新结果</span>}</div>}
      {!!sources.length && <div className="tv-source-status">{sources.map(source => <span key={source.name} className={source.status === 'error' ? 'unavailable' : ''}>{source.name}<small>{source.status === 'error' ? '暂不可用' : `${source.count} 条线路`}</small></span>)}</div>}
      <OnlineSources results={results} busy={busy} error={error} onInvalid={(resultId, episodeId) => setResults(items => items?.map(item => item.id === resultId ? { ...item, episodes: item.episodes.filter(episode => episode.id !== episodeId) } : item).filter(item => item.episodes.length) || [])} />
    </div>}
  </section>
}
