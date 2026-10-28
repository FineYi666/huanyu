import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Plus,
  Star,
} from 'lucide-react'
import { api } from './api'
import Poster from './Poster'
import { SceneWeather } from './SkinAtmospheres'
import type { SkinId } from './skins'

type Slide = {
  id: string
  title: string
  subtitle: string
  description: string
  image: string
  score?: number
  votes?: number
  airDate?: string
  sourceUrl?: string
}
type Recommendations = {
  season: { label: string }
  updatedAt: string | null
  slides: Slide[]
  refreshing?: boolean
}
const INTERVAL = 8000

export default function HeroCarousel({
  skin,  onImport,
  onOpenLibrary,
  catalog,
}: {
  skin?: SkinId
  onImport: (title: string) => void
  onOpenLibrary: (id: string, title: string) => void
  catalog?: Recommendations | null
}) {
  const [data, setData] = useState<Recommendations | null>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const remaining = useRef(INTERVAL)
  const recommendations = catalog === undefined ? data : catalog
  const slides = recommendations?.slides || []
  const active = slides.length ? index % slides.length : 0
  const stopped = paused || hovered || focused || hidden

  useEffect(() => {
    if (catalog !== undefined) return
    let cancelled = false
    const load = () =>
      api<Recommendations>('/recommendations')
        .then((value) => {
          if (!cancelled) setData(value)
        })
        .catch(() => {})
    void load()
    const poll = window.setInterval(load, 60000)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [catalog])
  useEffect(() => {
    const visibility = () => setHidden(document.hidden)
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => {
      if (preference.matches) setPaused(true)
    }
    document.addEventListener('visibilitychange', visibility)
    preference.addEventListener('change', change)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      preference.removeEventListener('change', change)
    }
  }, [])
  useEffect(() => {
    remaining.current = INTERVAL
  }, [active, slides.length])
  useEffect(() => {
    if (stopped || slides.length < 2) return
    const started = performance.now()
    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % slides.length),
      remaining.current,
    )
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - started),
      )
    }
  }, [active, slides.length, stopped])

  const updated = recommendations?.updatedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(recommendations.updatedAt))
    : ''
  if (!slides.length) return null
  return (
    <section
      className="hero carousel"
      role="region"
      aria-roledescription="轮播"
      aria-label="本季度高分新番推荐"
      data-paused={stopped}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
    >
      {slides.map((slide, i) => (
        <article
          key={slide.id}
          className={`hero-slide ${i === active ? 'is-active' : ''} ${slide.score ? 'seasonal-slide' : 'classic-slide'}`}
          role="group"
          aria-roledescription="幻灯片"
          aria-label={`${i + 1} / ${slides.length}：${slide.title}`}
          aria-hidden={i !== active}
          inert={i !== active}
        >
          <div className="hero-visual">
            <Poster src={slide.image} title="" className="hero-image" eager />
            {(skin === 'synth' || skin === 'glacier') && i === active && <SceneWeather kind={skin} compact />}
          </div>
          <div className="hero-shade" />
          {slide.score && (
            <div className="hero-poster-stage">
              <div
                className="hero-poster-reflection"
                style={{ backgroundImage: `url("${slide.image}")` }}
              />
              <Poster className="hero-feature-poster" src={slide.image} title={slide.title} eager />
              <span className="hero-poster-caption">
                SEASONAL SELECTION / {String(i + 1).padStart(2, '0')}
              </span>
            </div>
          )}
          <div className="hero-copy">
            <span className="hero-eyebrow">
              <i />
              {slide.score
                ? `${recommendations?.season.label} · 高分新番`
                : '光影珍藏 · 值得重温'}
            </span>
            <h2>{slide.title}</h2>
            <span className="hero-original-title">{slide.subtitle}</span>
            <p>{slide.description}</p>
            {slide.score && (
              <div className="hero-rating">
                <Star size={13} fill="currentColor" />
                <strong>{slide.score.toFixed(1)}</strong>
                <span>Bangumi · {slide.votes} 人评分</span>
                <i />{' '}
                <span>{slide.airDate?.slice(5).replace('-', '.')} 开播</span>
              </div>
            )}
            <div className="hero-cta-row">
              <button
                className="hero-button"
                onClick={() =>
                  slide.score
                    ? onImport(slide.title)
                    : onOpenLibrary(slide.id, slide.title)
                }
              >
                {slide.score ? (
                  <Plus size={15} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                {slide.score ? '查找播放资源' : '探索这个故事'}
                <ArrowUpRight size={16} />
              </button>
              {slide.sourceUrl && (
                <a
                  className="hero-source"
                  href={slide.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  作品资料 <ArrowUpRight size={13} />
                </a>
              )}
            </div>
          </div>
          <span className="hero-credit">
            {slide.score
              ? `Bangumi ≥ 7.0 · 至少 30 人评分 · 更新 ${updated}`
              : '© STUDIO GHIBLI · 官方公开静止画'}
          </span>
        </article>
      ))}
      <span className="hero-counter" aria-hidden="true">
        {String(active + 1).padStart(2, '0')}
        <span> / {String(slides.length).padStart(2, '0')}</span>
      </span>
      <div className="carousel-controls">
        <div className="carousel-pagination" aria-label="选择推荐">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              className={i === active ? 'active' : ''}
              aria-label={`推荐 ${i + 1}：${slide.title}`}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => setIndex(i)}
            >
              <span>{i === active && <i key={`${slide.id}-${active}`} />}</span>
            </button>
          ))}
        </div>
        <div className="carousel-transport">
          <span className="rotation-label">
            {paused ? '已暂停' : hovered || focused ? '浏览中' : '自动放映'}
          </span>
          <button
            className="carousel-control"
            aria-label="上一张推荐"
            onClick={() =>
              setIndex((active - 1 + slides.length) % slides.length)
            }
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="carousel-control"
            aria-label={paused ? '开始自动轮播' : '暂停自动轮播'}
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {paused ? (
              <Play size={13} fill="currentColor" />
            ) : (
              <Pause size={13} fill="currentColor" />
            )}
          </button>
          <button
            className="carousel-control"
            aria-label="下一张推荐"
            onClick={() => setIndex((active + 1) % slides.length)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  )
}
