import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Clapperboard, Film, LoaderCircle, Search, Star } from 'lucide-react'
import { api } from './api'
import Poster from './Poster'
import type { AppState, Media } from './types'
import CatalogFavoriteButton from './CatalogFavoriteButton'
import type { SeasonTitle } from './NewSeasonPage'
import { filterMovies, type RecommendedMovie } from '../movie-filters.mjs'

type Catalog = { movies: RecommendedMovie[]; updatedAt?: string; genres: string[] }
export default function MovieDiscovery({ query, onClearSearch, onResource, onOpen, media, onFavoriteChange }: {
  query: string; onClearSearch: () => void; onResource: (movie: SeasonTitle) => void;
  onOpen: (id: string) => void; media: Media[];
  onFavoriteChange:(state:AppState)=>void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [genre, setGenre] = useState('全部')
  const [sort, setSort] = useState('rank')
  const [page, setPage] = useState(1)
  useEffect(() => {
    let active = true
    setError('')
    api<Catalog>('/movie-seed').then((value) => { if (active) setCatalog(value) })
      .catch((reason) => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [retry])
  useEffect(() => setPage(1), [query, genre, sort])
  const movies = catalog?.movies || []
  const filtered = useMemo(() => filterMovies(movies, { query, genre, sort }), [movies, query, genre, sort])
  const genreCounts = useMemo(() => movies.reduce((counts, movie) => {
    for (const item of movie.genres) counts.set(item, (counts.get(item) || 0) + 1)
    return counts
  }, new Map<string, number>()), [movies])
  const genres = [...genreCounts.keys()].sort((a, b) => (genreCounts.get(b) || 0) - (genreCounts.get(a) || 0))
  const pageSize = 30
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const selectMovie = (movie: RecommendedMovie) => onResource({
    id: movie.id, title: movie.title, subtitle: movie.foreignTitle || '',
    description: movie.quote || `${movie.year} · ${movie.genres.join(' / ')} · 豆瓣评分 ${movie.score}`,
    image: movie.cover, score: movie.score, sourceUrl: movie.url, category: 'movie',
  })
  if (!catalog) return <section className="discovery-state" aria-live="polite">
    {error ? <><Film size={34} /><h2>暂时无法打开片单</h2><p>{error}</p><button className="button outline" onClick={() => setRetry((value) => value + 1)}>重新加载</button></>
      : <><LoaderCircle className="spin" size={28} /><p>正在打开高分电影片单…</p></>}
  </section>
  return <section className="movie-discovery" aria-label="豆瓣高分电影推荐">
    {!query.trim() && genre === '全部' && movies.length > 0 && <div className="discovery-intro">
      <div className="discovery-intro-copy">
        <span className="discovery-kicker"><Clapperboard size={16} /> THE CINEMA COLLECTION</span>
        <h2>下一场好电影，<br />从这里开始。</h2>
        <p>从经典故事到银幕奇想，找到今晚想看的那一部。</p>
        <div className="discovery-stats"><span><strong>{movies.length}</strong> 部精选电影</span><i /><span><strong>{genres.length}</strong> 种类型</span></div>
        {catalog.updatedAt && <small>豆瓣 Top250 片单 · 资料更新于 {new Date(catalog.updatedAt).toLocaleDateString('zh-CN')}</small>}
      </div>
      <div className="discovery-feature-posters">
        {[movies.find((movie) => movie.title === '星际穿越'), movies[0], movies[2]].filter((movie): movie is RecommendedMovie => Boolean(movie)).map((movie, index) =>
          <button key={`${movie.id}-${index}`} onClick={() => selectMovie(movie)} aria-label={`查找${movie.title}的片源`}>
            <Poster src={movie.cover} title={movie.title} eager /><span>{movie.title}<small><Star size={11} fill="currentColor" /> {movie.score.toFixed(1)}</small></span>
          </button>)}
      </div>
    </div>}
    <div className="discovery-toolbar">
      <div><h2>{query.trim() ? '片名搜索结果' : genre === '全部' ? '全部佳片' : `${genre}电影`} <span>{filtered.length} 部</span></h2><p>搜索中文名或原名，选择类型进一步筛选。</p></div>
      <label>排序 <select aria-label="推荐电影排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="rank">榜单顺序</option><option value="score">评分优先</option><option value="year">年份从新到旧</option></select></label>
    </div>
    <div className="discovery-genres" role="group" aria-label="电影类型筛选">
      {['全部', ...genres].map((item) => <button key={item} aria-pressed={genre === item} className={genre === item ? 'active' : ''} onClick={() => setGenre(item)}>{item}<small>{item === '全部' ? movies.length : genreCounts.get(item)}</small></button>)}
    </div>
    {filtered.length > 0 ? <>
      <div className="discovery-grid">
        {filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((movie) => {
          const linked = media.find((item) => !['sample','catalog'].includes(item.source) && item.subjectId === movie.id)
          return <article className="discovery-movie" key={movie.id}>
            <button className="discovery-poster" onClick={() => selectMovie(movie)} aria-label={`查找${movie.title}的片源`}>
              <Poster src={movie.cover} title={movie.title} /><span className="discovery-rank">#{String(movie.rank).padStart(2, '0')}</span><span className="discovery-score"><Star size={12} fill="currentColor" />{movie.score.toFixed(1)}</span>
              <span className="discovery-poster-action">查找片源 <ArrowUpRight size={16} /></span>
            </button>
            <div className="discovery-movie-meta"><span>{movie.year}</span><span>{movie.genres.slice(0, 2).join(' / ')}</span></div>
            <h3>{movie.title}</h3><p className="discovery-original" title={movie.foreignTitle}>{movie.foreignTitle || movie.title}</p>
            <div className="discovery-movie-actions"><button onClick={() => linked ? onOpen(linked.id) : selectMovie(movie)}>{linked ? '打开已入库影片' : '查找播放资源'}<ArrowUpRight size={13} /></button><CatalogFavoriteButton subjectId={movie.id} title={movie.title} media={media} onChange={onFavoriteChange}/><a href={movie.url} target="_blank" rel="noreferrer" aria-label={`${movie.title}的豆瓣资料`}>资料</a></div>
          </article>
        })}
      </div>
      {pageCount > 1 && <nav className="discovery-pagination" aria-label="电影推荐分页"><button disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={15} /> 上一页</button><span>{currentPage} / {pageCount}</span><button disabled={currentPage === pageCount} onClick={() => setPage((value) => value + 1)}>下一页 <ArrowRight size={15} /></button></nav>}
    </> : <div className="discovery-state"><Search size={32} /><h3>没有找到匹配的电影</h3><p>试试其他片名，或清除类型筛选。</p><button className="button outline" onClick={() => { setGenre('全部'); onClearSearch() }}>清除筛选</button></div>}
  </section>
}
