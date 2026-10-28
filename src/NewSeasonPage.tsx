import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  Cloud,
  FolderOpen,
  Link,
  LoaderCircle,
  RefreshCw,
  Search,
  Star,
  Play,
  History,
} from 'lucide-react'
import { api } from './api'
import type { WebSourceResult } from './OnlinePlayer'
import OnlineSources from './OnlineSources'
import QuarkResults from './QuarkResults'
import useQuarkSearch, { type QuarkResource } from './useQuarkSearch'
import type { MediaCategory } from '../media-category.mjs'
import Dialog from './ui'
import HeroCarousel from './HeroCarousel'
import Poster from './Poster'
import type { SkinId } from './skins'
import type { AppState, Media } from './types'
import { episodeLabel } from './episode-labels'

export type SeasonTitle = {
  category?: MediaCategory
  replaceMediaId?: string
  id: string
  title: string
  subtitle: string
  description: string
  image: string
  score?: number
  votes?: number
  airDate?: string
  sourceUrl?: string
  platform?: string
  status?: string
}
type Catalog = {
  season: { id: string; label: string; monthLabel?: string }
  updatedAt: string | null
  items?: SeasonTitle[]
  slides: SeasonTitle[]
  refreshing?: boolean
  error?: string
}
type SeasonOption = {
  id: string
  monthLabel: string
  label: string
  current?: boolean
}

export default function NewSeasonPage({
  skin,  query,
  onResource,
  onImport,
  onOpen,
  media,
}: {
  skin?: SkinId
  query: string
  onResource: (subject: SeasonTitle) => void
  onImport: (subject: SeasonTitle, mode: 'local' | 'quark') => void
  onOpen: (id: string) => void
  media: Media[]
}) {
  const [data, setData] = useState<Catalog | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('all'),
    [sort, setSort] = useState('date'),
    [seasons, setSeasons] = useState<SeasonOption[]>([]),
    [selected, setSelected] = useState(''),
    [cross, setCross] = useState<SeasonTitle[] | null>(null),
    [crossBusy, setCrossBusy] = useState(false),
    [crossCooldown, setCrossCooldown] = useState(0)
  useEffect(() => {
    if (selected) return
    let active = true
    const load = () =>
      api<Catalog>('/seasonal')
        .then((value) => {
          if (active) {
            setData(value)
            setError('')
          }
        })
        .catch((e) => {
          if (active) setError(e.message)
        })
    void load()
    const timer = setInterval(load, 8000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [selected])
  useEffect(() => {
    let active = true
    api<{ seasons: SeasonOption[] }>('/seasonal/seasons')
      .then((value) => {
        if (active) setSeasons(value.seasons || [])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  async function viewSeason(key: string) {
    setSelected(key)
    setBusy(true)
    setError('')
    try {
      const value = await api<Catalog>(
        `/seasonal/view?key=${encodeURIComponent(key)}`,
      )
      setData(value)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function loadSeasons() {
    api<{ seasons: SeasonOption[] }>('/seasonal/seasons')
      .then((value) => setSeasons(value.seasons || []))
      .catch(() => {})
  }
  // 搜索跨全部季度（2023 年 1 月开播至今，随年份自动扩展）。
  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setCross(null)
      setCrossBusy(false)
      return
    }
    // 资料源不可达时冷却 30 秒，期间直接用本地片单匹配。
    if (Date.now() < crossCooldown) {
      setCross(null)
      setCrossBusy(false)
      return
    }
    let active = true
    const timer = setTimeout(() => {
      setCrossBusy(true)
      api<{ results: SeasonTitle[] }>(
        `/seasonal/search?q=${encodeURIComponent(keyword)}`,
      )
        .then((value) => {
          if (active) {
            setCross(value.results || [])
            setError('')
          }
        })
        .catch(() => {
          // 资料源不可达时冷却 30 秒，期间直接用本地片单匹配。
          if (active) {
            setCross([])
            setCrossCooldown(Date.now() + 30000)
          }
        })
        .finally(() => {
          if (active) setCrossBusy(false)
        })
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])
  const items = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const searching = Boolean(keyword)
    // 搜索态优先用跨季度结果；Bangumi 不可达或无结果时回退本地片单匹配。
    const usingCross = searching && Boolean(cross?.length)
    const base = usingCross
      ? cross!
      : (data?.items || data?.slides || [])
    const values = base.filter(
      (item) =>
        (filter === 'all' || item.status === filter) &&
        (usingCross ||
          `${item.title} ${item.subtitle}`
            .toLowerCase()
            .includes(keyword)),
    )
    return [...values].sort((a, b) =>
      sort === 'rating'
        ? (b.score || 0) - (a.score || 0)
        : sort === 'title'
          ? a.title.localeCompare(b.title, 'zh-CN')
          : Number(a.status === 'upcoming') - Number(b.status === 'upcoming') ||
            (b.airDate || '').localeCompare(a.airDate || ''),
    )
  }, [data, cross, filter, sort, query])
  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const value = await api<Catalog>('/seasonal/refresh', {})
      setData(value)
      if (value.error) setError(value.error)
      // 刷新总是对准当前季度：跨入新一季后自动带回最新片单与新的选项。
      setSelected('')
      loadSeasons()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const find = (title: string) =>
    onResource(
      (data?.items || data?.slides || []).find(
        (item) => item.title === title,
      ) || { id: '', title, subtitle: '', description: '', image: '' },
    )
  const recent = media.filter(m => m.source !== 'sample' && Object.keys(m.progress || {}).length).map(m => {
    const latest = Object.entries(m.progress || {}).sort((a, b) => b[1].at - a[1].at)[0]
    return { media: m, episode: m.episodes.find(e => e.id === latest[0]), progress: latest[1] }
  }).sort((a, b) => b.progress.at - a.progress.at).slice(0, 3)
  const highlights = data?.slides.slice(0, 3) || []
  return (
    <div className="new-season-page">
      {!query && <div className="season-feature-layout">
        <aside className="watch-shelf" aria-label="放映手记">
          <div className="shelf-heading"><History size={16} /><h2>继续观看</h2><span>{recent.length ? `${recent.length} 部` : 'YOUR CINEMA'}</span></div>
          {recent.length ? recent.map(({ media: m, episode, progress }) => <button className="continue-item" key={m.id} onClick={() => onOpen(m.id)}>
            <Poster src={m.cover} title={m.title} />
            <span className="continue-copy"><strong>{m.title}</strong><small>{episode ? episodeLabel(m.episodes.indexOf(episode),m.episodes,m.title) : '上次观看'} · {Math.floor(progress.time / 60)} 分钟</small><span className="continue-progress"><i style={{ width: `${Math.min(100, progress.duration ? progress.time / progress.duration * 100 : 0)}%` }} /></span></span><Play size={13} />
          </button>) : <div className="shelf-empty"><Play size={23} strokeWidth={1.3} /><p>把暂停的故事，留给下次相遇。</p><small>导入并播放后，这里会记住你的进度。</small></div>}
          <div className="shelf-heading shelf-picks"><Star size={15} /><h2>本季口碑</h2><span>精选</span></div>
          {highlights.map((item, index) => <button className="shelf-pick" key={item.id} onClick={() => onResource(item)}><span className="pick-rank">0{index + 1}</span><Poster src={item.image} title={item.title} /><span><strong>{item.title}</strong><small><Star size={10} fill="currentColor" /> {item.score?.toFixed(1)} <i>Bangumi</i></small></span><ArrowUpRight size={14} /></button>)}
          <p className="shelf-note">本地珍藏与云端故事，在此相遇。</p>
        </aside>
        <HeroCarousel skin={skin} catalog={data} onImport={find} onOpenLibrary={(_id, title) => find(title)} />
      </div>}

      <section aria-label="本季度新番片单" className="season-catalog">
        <div className="season-heading">
          <div>
            <span className="season-kicker">
              <CalendarDays size={15} />
              THIS SEASON
            </span>
            <h2>
              {query.trim()
                ? `搜索「${query.trim()}」`
                : data?.season.monthLabel ||
                  data?.season.label ||
                  '本季度新番'}
              <span>{items.length} 部</span>
            </h2>
            <p>
              {query.trim()
                ? '在 2023 年 1 月开播至今的全部新番中查找。'
                : '这一季，下一部想追的故事。'}
            </p>
          </div>
          <div className="season-heading-actions">
            <label className="season-sort">
              <select
                value={selected}
                aria-label="选择季度"
                disabled={busy}
                onChange={(e) => {
                  const key = e.target.value
                  if (key) void viewSeason(key)
                  else setSelected('')
                }}
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.current ? '' : s.id}>
                    {s.monthLabel}
                    {s.current ? ' · 本季' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button subtle"
              title={selected ? '回到本季并刷新最新片单' : undefined}
              onClick={refresh}
              disabled={busy || data?.refreshing}
            >
              <RefreshCw
                size={15}
                className={busy || data?.refreshing ? 'spin' : ''}
              />
              {busy || data?.refreshing ? '更新片单中…' : '刷新新番'}
            </button>
          </div>
        </div>
        <div className="season-toolbar">
          <div className="genre-tabs">
            {[
              ['all', '全部新番'],
              ['airing', '已开播'],
              ['upcoming', '待开播'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? 'active' : ''}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="season-sort">
            排序
            <select
              aria-label="新番排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="date">最近开播</option>
              <option value="rating">评分优先</option>
              <option value="title">名称排序</option>
            </select>
          </label>
        </div>
        {(error || data?.error) && (
          <div className="catalog-notice" role="status">
            <Cloud size={16} /><span>{items.length ? '当前显示本机保存的片单，联网后会自动更新。已缓存的海报可继续查看。' : '暂时无法连接新番资料源，请检查网络后重试。'}</span><button onClick={refresh} disabled={busy || data?.refreshing}>重试更新</button>
          </div>
        )}
        {!data && !error ? (
          <div className="season-empty">
            <LoaderCircle size={28} className="spin" />
            <h3>正在获取本季度新番</h3>
            <p>从作品资料库整理开播日期、海报与评分。</p>
          </div>
        ) : items.length ? (
          <div className="season-grid">
            {items.map((item) => {
              const linked = media.filter(
                (m) => m.source !== 'sample' && m.subjectId === item.id,
              )
              return (
                <article className="season-card" key={item.id}>
                  <button
                    className="season-poster"
                    aria-label={`查看${item.title}的夸克资源`}
                    onClick={() => onResource(item)}
                  >
                    <Poster src={item.image} title={item.title} />
                    <span className="season-platform">
                      {item.platform || '新番'}
                    </span>
                    <span
                      className={`season-status ${item.status === 'upcoming' ? 'upcoming' : ''}`}
                    >
                      {item.status === 'upcoming' ? '即将开播' : '本季放送'}
                    </span>
                    <span className="season-poster-action">
                      <Search size={22} />
                      发现资源
                    </span>
                  </button>
                  <div className="season-card-meta">
                    <span>
                      {item.airDate?.slice(5).replace('-', ' / ')} 开播
                    </span>
                    {item.votes ? (
                      <span className="season-score">
                        <Star size={12} fill="currentColor" />
                        {item.score?.toFixed(1)}
                      </span>
                    ) : (
                      <span>待评分</span>
                    )}
                  </div>
                  <h3 title={item.title}>{item.title}</h3>
                  <p className="season-original" title={item.subtitle}>
                    {item.subtitle || '本季度新作'}
                  </p>
                  <button
                    className="button season-find"
                    aria-label={`获取${item.title}的夸克资源`}
                    onClick={() => onResource(item)}
                  >
                    <Cloud size={15} />
                    获取夸克资源
                    <ArrowUpRight size={14} />
                  </button>
                  <div
                    className="season-import-actions"
                    aria-label={`${item.title}的导入方式`}
                  >
                    <button
                      onClick={() => onImport(item, 'local')}
                      aria-label={`关联${item.title}的本地视频`}
                    >
                      <FolderOpen size={13} />
                      关联本地
                    </button>
                    <button
                      onClick={() => onImport(item, 'quark')}
                      aria-label={`导入${item.title}的夸克分享`}
                    >
                      <Link size={13} />
                      导入链接
                    </button>
                  </div>
                  {!!linked.length && (
                    <div className="season-linked-list" aria-label="已关联资源">
                      {linked.map((resource) => (
                        <button
                          key={resource.id}
                          className="season-linked"
                          onClick={() => onOpen(resource.id)}
                          aria-label={`打开${item.title}的${resource.source === 'local' ? '本地' : '夸克'}分集`}
                        >
                          {resource.source === 'local' ? (
                            <FolderOpen size={11} />
                          ) : (
                            <Cloud size={11} />
                          )}
                          {resource.source === 'local' ? '本地' : '夸克'} ·{' '}
                          {resource.episodes.length} 集{' '}
                          <ArrowUpRight size={11} />
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="season-empty">
            <Search size={28} />
            <h3>{query ? '没有找到匹配的新番' : '当前没有符合条件的新番'}</h3>
            <p>可以调整筛选，或刷新本季度片单。</p>
          </div>
        )}
        <footer className="season-footer">
          <span>Bangumi 作品资料 · TV / WEB · 按当前季度自动更新</span>
          <span>
            {data?.updatedAt
              ? `更新于 ${new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </span>
        </footer>
      </section>
    </div>
  )
}

export function ResourceSearch({
  subject,
  onImported,
  onWorking,
  onManualImport,
}: {
  subject: SeasonTitle
  onImported: (data: AppState, ids: string[], count: number) => void
  onWorking: (busy: boolean) => void
  onManualImport: () => void
}) {
  const [query, setQuery] = useState(subject.title)
  const [importing, setImporting] = useState('')
  const [importError, setImportError] = useState('')
  const quark = useQuarkSearch()
  const [webSources, setWebSources] = useState<WebSourceResult[] | null>(null)
  const [webBusy, setWebBusy] = useState(false)
  const [webError, setWebError] = useState('')
  const webRevision=useRef(0)
  async function loadWebSources(keyword: string) {
    const revision=++webRevision.current
    setWebBusy(true)
    setWebError('')
    try {
      const value = await api<{ results: WebSourceResult[] }>(
        '/web-sources/search',
        { keyword, subjectId:subject.id, category:subject.category||'anime' },
      )
      if(revision!==webRevision.current)return
      setWebSources(value.results || [])
    } catch (e) {
      if(revision===webRevision.current){setWebError((e as Error).message);setWebSources([])}
    } finally {
      if(revision===webRevision.current)setWebBusy(false)
    }
  }
  function search(value: string) {
    setImportError('')
    void loadWebSources(value)
    void quark.search(value, subject.id)
  }
  useEffect(() => {
    search(subject.title)
    return () => { webRevision.current++ }
  }, [subject.id, subject.title])
  async function importResource(resource: QuarkResource) {
    setImporting(resource.id)
    setImportError('')
    onWorking(true)
    try {
      const data = await api<AppState & { ids: string[]; count: number }>(
        subject.replaceMediaId ? `/media/${subject.replaceMediaId}/source` : '/import/quark',
        {
          mode: 'quark',
          url: resource.url,
          code: resource.code,
          title: subject.title,
          category: subject.category || 'anime',
          subjectId: subject.id,
        },
      )
      onImported(data, data.ids, data.count)
    } catch (e) {
      setImportError((e as Error).message)
    } finally {
      setImporting('')
      onWorking(false)
    }
  }
  return (
    <div className="resource-search-body">
      <div className="resource-subject">
        {subject.image && (
          <img src={subject.image} alt="" referrerPolicy="no-referrer" />
        )}
        <div>
          <span className="season-kicker">{subject.category === 'movie' ? 'MOVIE SOURCES' : subject.category === 'tv' ? 'SERIES SOURCES' : 'QUARK RESOURCES'}</span>
          <h3>{subject.title}</h3>
          <p>
            {subject.description ||
              subject.subtitle ||
              '搜索这部作品的夸克网盘分享。'}
          </p>
          {subject.sourceUrl && (
            <a
              className="text-button"
              href={subject.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              作品资料
              <ArrowUpRight size={12} />
            </a>
          )}
        </div>
      </div>
      <form
        className="resource-query"
        onSubmit={(e) => {
          e.preventDefault()
          void search(query)
        }}
      >
        <Search size={17} />
        <input
          aria-label="资源搜索关键词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={150}
          minLength={2}
          required
        />
        <button className="button primary" disabled={!!importing}>
          {quark.loading ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Search size={15} />
          )}
          搜索
        </button>
      </form>
      <p className="resource-note">
        同时搜索夸克盘搜、PanSearch 和
        PanSou，自动尝试别名。{subject.category === 'movie' ? '请核对片名、版本与字幕' : '请核对季数与字幕'}；导入时验证分享，播放前确认转存。
      </p>
      <QuarkResults data={quark} importing={importing} error={importError} onImport={resource => void importResource(resource)} />
      <OnlineSources results={webSources} busy={webBusy} error={webError} onInvalid={(resultId, episodeId) => setWebSources(items => items?.map(item => item.id === resultId ? { ...item, episodes: item.episodes.filter(episode => episode.id !== episodeId) } : item).filter(item => item.episodes.length) || [])} />
      <div className="resource-fallback-actions">
        <button
          className="button outline"
          disabled={!!importing}
          onClick={onManualImport}
        >
          <Link size={15} />
          已有链接，直接导入
        </button>
        <a
          className="resource-source-link text-button"
          target="_blank"
          rel="noreferrer"
          href={`https://www.zhongchuangwl.com/s/${encodeURIComponent(quark.queries[0] || query)}/`}
        >
          打开夸克盘搜继续查找
          <ArrowUpRight size={13} />
        </a>
      </div>
    </div>
  )
}
