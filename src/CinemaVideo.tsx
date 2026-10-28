import { forwardRef, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import StreamVideo, { type StreamVideoProps } from './StreamVideo'
import { qualityLabel, resolutionHeight, type QualityOption } from '../stream-quality.mjs'

export type PlaybackQuality = {
  id: string
  label: string
  url: string
  format?: string
  context?: string
}
type Props = StreamVideoProps & {
  title: string
  episodeTitle?: string
  qualities?: PlaybackQuality[]
  qualityId?: string
  onQualityChange?: (quality: PlaybackQuality) => void
  onPrevious?: () => void
  onNext?: () => void
  onBack?: () => void
  onFullscreen?: () => void
}
const clock = (value: number) => {
  if (!Number.isFinite(value)) return '00:00'
  const seconds = Math.floor(value)
  return `${seconds >= 3600 ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
const CinemaVideo = forwardRef<HTMLVideoElement, Props>(function CinemaVideo(
  {
    title,
    episodeTitle,
    qualities = [],
    qualityId,
    onQualityChange,
    onPrevious,
    onNext,
    onBack,
    onFullscreen,
    onQualities,
    ...props
  },
  forwarded,
) {
  const video = useRef<HTMLVideoElement | null>(null),
    shell = useRef<HTMLDivElement>(null),
    idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [paused, setPaused] = useState(true),
    [waiting, setWaiting] = useState(true),
    [volume, setVolume] = useState(1),
    [muted, setMuted] = useState(false),
    [rate, setRate] = useState(1),
    [hud, setHud] = useState(true),
    [levels, setLevels] = useState<QualityOption[]>([]),
    [hlsQuality, setHlsQuality] = useState(''),
    [height, setHeight] = useState(0),
    [notice, setNotice] = useState('')
  const wake = () => {
    setHud(true)
    clearTimeout(idle.current)
    idle.current = setTimeout(() => {
      if (video.current && !video.current.paused) setHud(false)
    }, 3000)
  }
  useEffect(() => {
    setLevels([])
    setHlsQuality('')
    setWaiting(true)
    setTime(0)
    setDuration(0)
    setHeight(0)
    wake()
    return () => clearTimeout(idle.current)
  }, [props.src])
  useEffect(() => {
    const element = video.current
    if (!element) return
    const update = () => {
      setTime(element.currentTime)
      setDuration(Number.isFinite(element.duration) ? element.duration : 0)
      setPaused(element.paused)
      setVolume(element.volume)
      setMuted(element.muted)
      setRate(element.playbackRate)
      setHeight(resolutionHeight(element.videoWidth, element.videoHeight))
    }
    const ready = () => {
        setWaiting(false)
        update()
      },
      loading = () => setWaiting(true),
      pause = () => {
        setHud(true)
        update()
      }
    const events = [
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'volumechange',
      'ratechange',
      'play',
    ]
    for (const event of events) element.addEventListener(event, update)
    element.addEventListener('playing', ready)
    element.addEventListener('canplay', ready)
    element.addEventListener('waiting', loading)
    element.addEventListener('pause', pause)
    update()
    return () => {
      for (const event of events) element.removeEventListener(event, update)
      element.removeEventListener('playing', ready)
      element.removeEventListener('canplay', ready)
      element.removeEventListener('waiting', loading)
      element.removeEventListener('pause', pause)
    }
  }, [props.src])
  async function play() {
    const element = video.current
    if (!element) return
    if (element.paused) {
      try {
        await element.play()
        wake()
      } catch {
        setNotice('无法开始播放，请切换线路或画质')
      }
    } else element.pause()
  }
  async function fullscreen() {
    if (onFullscreen) {
      onFullscreen()
      return
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await shell.current?.requestFullscreen()
    } catch {
      setNotice('当前窗口未允许全屏')
    }
  }
  async function picture() {
    try {
      if (document.pictureInPictureElement)
        await document.exitPictureInPicture()
      else await video.current?.requestPictureInPicture()
    } catch {
      setNotice('当前视频暂不支持画中画')
    }
  }
  function capture() {
    try {
      const element = video.current
      if (!element?.videoWidth) return
      const canvas = document.createElement('canvas')
      canvas.width = element.videoWidth
      canvas.height = element.videoHeight
      canvas.getContext('2d')?.drawImage(element, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob),
          a = document.createElement('a')
        a.href = url
        a.download = `幻屿-${title.replace(/[\\/:*?"<>|]/g, '')}-${Math.floor(time)}s.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    } catch {
      setNotice('此线路不允许截取画面')
    }
  }
  const external = qualities.length > 1
  const options = external
    ? qualities.map((item) => ({ id: `source:${item.id}`, label: item.label }))
    : levels.length
      ? levels.map((item) => ({
          ...item,
          label:
            levels.length === 1 && !item.height
              ? qualityLabel(height)
              : item.label,
        }))
      : [{ id: 'original', label: qualityLabel(height) }]
  const selected = external
    ? `source:${qualityId || qualities[0]?.id}`
    : hlsQuality || levels[0]?.id || 'original'
  return (
    <div
      ref={shell}
      className={`cinema-video ${hud || paused ? 'show-hud' : 'hide-hud'}`}
      tabIndex={0}
      onPointerMove={wake}
      onFocus={wake}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('input,select,button')) return
        const element = video.current
        if (!element) return
        if (event.key === ' ') {
          event.preventDefault()
          void play()
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          element.currentTime = Math.max(
            0,
            Math.min(
              duration,
              element.currentTime + (event.key === 'ArrowRight' ? 10 : -10),
            ),
          )
        }
        if (event.key.toLowerCase() === 'm') element.muted = !element.muted
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault()
          event.stopPropagation()
          void fullscreen()
        }
      }}
    >
      <StreamVideo
        {...props}
        ref={(element) => {
          video.current = element
          if (typeof forwarded === 'function') forwarded(element)
          else if (forwarded) forwarded.current = element
        }}
        controls={false}
        qualityId={hlsQuality}
        onQualities={(items) => {
          setLevels(items)
          setHlsQuality(items[0]?.id || '')
          onQualities?.(items)
        }}
        onStreamError={(message) => {
          setNotice(message)
          setWaiting(false)
          props.onStreamError(message)
        }}
        onError={(event) => {
          setNotice('此视频暂时无法播放，可切换画质或线路')
          setWaiting(false)
          props.onError?.(event)
        }}
        onClick={(event) => {
          props.onClick?.(event)
          void play()
        }}
      />
      <header className="cinema-hud cinema-top">
        <div>
          {onBack && (
            <button aria-label="返回片源" title="返回片源" onClick={onBack}>
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <strong>{title}</strong>
            {episodeTitle && <span>{episodeTitle}</span>}
          </div>
        </div>
        <div>
          <button
            aria-label="截图"
            title="保存当前画面"
            disabled={!height}
            onClick={capture}
          >
            <Camera size={19} />
          </button>
          <button
            aria-label="画中画"
            title="画中画"
            onClick={() => void picture()}
          >
            <PictureInPicture2 size={20} />
          </button>
        </div>
      </header>
      {waiting && (
        <div className="cinema-buffer" aria-live="polite">
          <i />
          <span>正在缓冲画面</span>
        </div>
      )}
      {paused && !waiting && (
        <button
          className="cinema-center-play"
          aria-label="继续播放"
          onClick={() => void play()}
        >
          <Play size={32} fill="currentColor" />
        </button>
      )}
      {notice && (
        <button className="cinema-notice" onClick={() => setNotice('')}>
          {notice}
        </button>
      )}
      <div className="cinema-hud cinema-bottom">
        <input
          className="cinema-seek"
          aria-label="播放进度"
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(time, duration || 1)}
          disabled={!duration}
          style={
            {
              '--played': `${duration ? (time / duration) * 100 : 0}%`,
            } as React.CSSProperties
          }
          onChange={(event) => {
            if (video.current)
              video.current.currentTime = Number(event.target.value)
            wake()
          }}
        />
        <div className="cinema-control-row">
          <div>
            <button
              aria-label={paused ? '播放' : '暂停'}
              title={paused ? '播放' : '暂停'}
              onClick={() => void play()}
            >
              {paused ? (
                <Play size={22} fill="currentColor" />
              ) : (
                <Pause size={22} fill="currentColor" />
              )}
            </button>
            {onPrevious && (
              <button aria-label="上一集" title="上一集" onClick={onPrevious}>
                <SkipBack size={19} />
              </button>
            )}
            {onNext && (
              <button aria-label="下一集" title="下一集" onClick={onNext}>
                <SkipForward size={19} />
              </button>
            )}
            <span className="cinema-time">
              {clock(time)} <i>/</i> {clock(duration)}
            </span>
            <button
              aria-label={muted ? '取消静音' : '静音'}
              onClick={() => {
                if (video.current) video.current.muted = !video.current.muted
              }}
            >
              {muted || volume === 0 ? (
                <VolumeX size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>
            <input
              className="cinema-volume"
              aria-label="音量"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => {
                if (video.current) {
                  video.current.volume = Number(event.target.value)
                  video.current.muted = false
                }
              }}
            />
          </div>
          <div>
            <label
              className="cinema-select"
              title={
                options.length > 1
                  ? '切换实际可用画质，保留播放进度'
                  : '此线路只提供一种画质，可尝试其他线路'
              }
            >
              <span>清晰度</span>
              <select
                aria-label="视频清晰度"
                value={selected}
                onChange={(event) => {
                  const id = event.target.value
                  if (id.startsWith('source:')) {
                    const option = qualities.find(
                      (item) => item.id === id.slice(7),
                    )
                    if (option) onQualityChange?.(option)
                  } else setHlsQuality(id)
                }}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cinema-select">
              <select
                aria-label="播放倍速"
                value={rate}
                onChange={(event) => {
                  if (video.current)
                    video.current.playbackRate = Number(event.target.value)
                }}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                  <option key={value} value={value}>
                    {value === 1 ? '倍速' : `${value}×`}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="全屏播放"
              title="全屏 · F"
              onClick={() => void fullscreen()}
            >
              <Maximize size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
export default CinemaVideo
