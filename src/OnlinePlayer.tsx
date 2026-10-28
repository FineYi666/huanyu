import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  Radio,
  RefreshCw,
  Heart,
} from 'lucide-react'
import Dialog from './ui'
import CinemaVideo, { type PlaybackQuality } from './CinemaVideo'
import { api } from './api'
import type { Media } from './types'

export type WebEpisode = {
  id: string
  title: string
  originalTitle: string
  season?: number | null
  number: number
}
export type WebSourceResult = {
  id: string
  category?: 'anime' | 'movie' | 'tv'
  sourceId: string
  sourceName: string
  road: string
  title: string
  cover: string
  year: string
  remarks: string
  checkedAt: string
  checkedEpisode: string
  height?: number
  width?: number
  quality?: string
  libraryKey?: string
  mediaId?: string
  episodes: WebEpisode[]
}
export default function OnlinePlayer({
  results,
  initialResult,
  initialEpisode,
  onClose,
  onInvalid,
  libraryMedia,
  onFavorite,
  onProgress,
  autoNext = true,
}: {
  results: WebSourceResult[]
  initialResult: WebSourceResult
  initialEpisode: WebEpisode
  onClose: () => void
  onInvalid: (resultId: string, episodeId: string) => void
  libraryMedia?: Media
  onFavorite?: () => void
  onProgress?: () => void
  autoNext?: boolean
}) {
  const [result, setResult] = useState(initialResult),
    [episode, setEpisode] = useState(initialEpisode),
    [stream, setStream] = useState<PlaybackQuality | null>(null),
    [qualities, setQualities] = useState<PlaybackQuality[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0)
  const video = useRef<HTMLVideoElement>(null),
    revision = useRef(0),
    resume = useRef<{ time: number; paused: boolean; rate: number } | null>(
      null,
    ),
    invalid = useRef(onInvalid)
  const lineResume = useRef<{
    time: number
    paused: boolean
    rate: number
  } | null>(null)
  invalid.current = onInvalid
  const fullscreenLeft = useRef(0)
  const stage = useRef<HTMLDivElement>(null)
  const lastSaved = useRef(0)
  const point = useRef<{episodeId:string;time:number;duration:number}|null>(null)
  const progressCallback = useRef(onProgress)
  progressCallback.current = onProgress
  function capture() {
    const el=video.current
    if(libraryMedia && el?.dataset.episodeId && Number.isFinite(el.duration) && el.duration>0 && el.currentTime>=.2)
      point.current={episodeId:el.dataset.episodeId,time:Math.min(el.currentTime,el.duration),duration:el.duration}
  }
  function saveProgress() {
    capture()
    if(libraryMedia && point.current)return api('/progress',{mediaId:libraryMedia.id,...point.current}).then(()=>progressCallback.current?.()).catch(()=>{})
    return Promise.resolve()
  }
  const saveCallback=useRef(saveProgress)
  saveCallback.current=saveProgress
  useEffect(()=>()=>{void saveCallback.current()},[])
  function selectEpisode(next:WebEpisode) {
    saveProgress()
    point.current=null
    setStream(null)
    setEpisode(next)
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await stage.current?.requestFullscreen()
  }
  useEffect(() => {
    const changed = () => {
      if (!document.fullscreenElement) fullscreenLeft.current = Date.now()
    }
    document.addEventListener('fullscreenchange', changed)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {})
    }
  }, [])
  function close() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (Date.now() - fullscreenLeft.current < 350) return
    void saveProgress().finally(onClose)
  }
  const index = result.episodes.findIndex((item) => item.id === episode.id)
  const sources = results.some((item) => item.id === result.id)
    ? results
    : [result, ...results]
  useEffect(() => {
    const current = ++revision.current
    setBusy(true)
    setError('')
    setStream(null)
    setQualities([])
    const saved=libraryMedia?.progress?.[episode.id]
    resume.current = lineResume.current || (saved && saved.time < saved.duration-10 ? {time:saved.time,paused:false,rate:1} : null)
    lineResume.current = null
    api<{ url: string; format: string; qualities?: PlaybackQuality[] }>(
      '/web-stream',
      { resultId: result.id, episodeId: episode.id,mediaId:libraryMedia?.id },
    )
      .then((value) => {
        if (current === revision.current) {
          const options = value.qualities || []
          setQualities(options)
          setStream(
            options[0] || {
              id: 'original',
              label: '原画',
              url: value.url,
              format: value.format,
            },
          )
        }
      })
      .catch((reason) => {
        if (current === revision.current) {
          setError(
            `${reason.message}，已暂时隐藏本集失效入口，可切换其他线路。`,
          )
          invalid.current(result.id, episode.id)
        }
      })
      .finally(() => {
        if (current === revision.current) setBusy(false)
      })
    return () => {
      ++revision.current
    }
  }, [result.id, episode.id, retry])
  function choose(item: WebSourceResult) {
    const matching = item.episodes.find(
      (candidate) =>
        candidate.number === episode.number &&
        candidate.season === episode.season,
    )
    const next = matching || item.episodes[0]
    if (next) {
      saveProgress()
      point.current=null
      const element = video.current
      lineResume.current =
        matching && element
          ? {
              time: element.currentTime,
              paused: element.paused,
              rate: element.playbackRate,
            }
          : null
      setStream(null)
      setResult(item)
      setEpisode(next)
    }
  }
  function failed(message: string) {
    setError(`${message}，可切换其他播放线路。`)
    invalid.current(result.id, episode.id)
    void api('/web-sources/report', {
      resultId: result.id,
      episodeId: episode.id,
    }).catch(() => {})
  }
  return (
    <Dialog
      title={`${libraryMedia?.title || result.title} · ${episode.title}`}
      onClose={close}
      hideHeader
      className="online-cinema-dialog"
    >
      <div className="cinema-window-header">
        <button onClick={close} aria-label="关闭在线播放">
          <ArrowLeft size={19} />
        </button>
        <div>
          <strong>{libraryMedia?.title || result.title}</strong>
          <span>
            {episode.season ? `第${episode.season}季 · ` : ''}
            {episode.title}
          </span>
        </div>
        <span className="cinema-source-badge">
          <Radio size={13} />
          {result.sourceName}
        </span>
        {libraryMedia && onFavorite && <button className={`online-library-favorite ${libraryMedia.favorite?'active':''}`} aria-label={`${libraryMedia.favorite?'取消收藏':'收藏'}${libraryMedia.title}`} aria-pressed={Boolean(libraryMedia.favorite)} onClick={onFavorite}><Heart size={16} fill={libraryMedia.favorite?'currentColor':'none'} /><span>{libraryMedia.favorite?'已收藏':'收藏'}</span></button>}
      </div>
      <div className="online-cinema-layout">
        <div className="online-cinema-main">
          <div className="online-cinema-stage" ref={stage}>
            {(
              <CinemaVideo
                ref={video}
                title={libraryMedia?.title || result.title}
                episodeTitle={`${episode.title} · ${result.road}`}
                src={stream?.url || ''}
                format={stream?.format}
                autoPlay={!resume.current?.paused}
                playsInline
                data-episode-id={stream ? episode.id : undefined}
                onTimeUpdate={()=>{capture();if(point.current&&Date.now()-lastSaved.current>5000){lastSaved.current=Date.now();void saveProgress()}}}
                onPause={saveProgress}
                qualities={qualities}
                qualityId={stream?.id}
                onFullscreen={()=>{void toggleFullscreen().catch(()=>setError('当前窗口暂未允许全屏'))}}
                onQualityChange={(option) => {
                  const element = video.current
                  resume.current = element
                    ? {
                        time: element.currentTime,
                        paused: element.paused,
                        rate: element.playbackRate,
                      }
                    : null
                  setStream(option)
                }}
                onStreamError={failed}
                onError={() => failed('当前视频无法解码')}
                onLoadedMetadata={() => {
                  const element = video.current,
                    point = resume.current
                  if (element && point) {
                    element.currentTime = Math.min(
                      point.time,
                      Math.max(0, element.duration - 1),
                    )
                    element.playbackRate = point.rate
                    if (point.paused) element.pause()
                    resume.current = null
                  }
                }}
                onPrevious={
                  index > 0
                    ? () => selectEpisode(result.episodes[index - 1])
                    : undefined
                }
                onNext={
                  index < result.episodes.length - 1
                    ? () => selectEpisode(result.episodes[index + 1])
                    : undefined
                }
                onEnded={() => {
                  saveProgress()
                  if (autoNext && result.episodes[index + 1])
                    selectEpisode(result.episodes[index + 1])
                }}
              />
            )}
            {(busy || error) && (
              <div className="online-cinema-status" role="status">
                {busy ? (
                  <>
                    <LoaderCircle className="spin" size={30} />
                    <h3>正在校验本集播放线路</h3>
                    <p>检查视频内容与首段连接</p>
                  </>
                ) : (
                  <>
                    <Radio size={30} />
                    <h3>这条线路暂时无法播放</h3>
                    <p>{error}</p>
                    <div>
                      <button
                        className="button outline"
                        onClick={() => setRetry((value) => value + 1)}
                      >
                        <RefreshCw size={14} />
                        重试本集
                      </button>
                      {sources.some((item) => item.id !== result.id) && (
                        <button
                          className="button primary"
                          onClick={() =>
                            choose(
                              sources.find((item) => item.id !== result.id)!,
                            )
                          }
                        >
                          切换其他线路
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <p className="cinema-help">
            默认最高可用画质 · 点击画面暂停 · ← / → 快进后退 · F 全屏
          </p>
        </div>
        <aside className="online-cinema-sidebar">
          <div className="cinema-sidebar-heading">
            <h3>播放线路</h3>
            <span>{sources.length} 条</span>
          </div>
          <select
            aria-label="切换在线播放线路"
            value={result.id}
            onChange={(event) => {
              const item = sources.find(
                (source) => source.id === event.target.value,
              )
              if (item) choose(item)
            }}
          >
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sourceName} · {item.road}
              </option>
            ))}
          </select>
          <div className="cinema-sidebar-heading">
            <h3>{episode.season ? `第${episode.season}季` : '剧集'}</h3>
            <span>{result.episodes.length} 集</span>
          </div>
          <div className="online-cinema-episodes">
            {result.episodes.map((item) => (
              <button
                key={item.id}
                title={`来源标记：${item.originalTitle}`}
                className={item.id === episode.id ? 'active' : ''}
                aria-pressed={item.id === episode.id}
                onClick={() => selectEpisode(item)}
              >
                <span>{String(item.number).padStart(2, '0')}</span>
                {item.title}
              </button>
            ))}
          </div>
          <p>已校验推荐入口；每集播放前再次检查。画质档位由片源实际提供。</p>
        </aside>
      </div>
    </Dialog>
  )
}
