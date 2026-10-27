import { forwardRef, useEffect, useRef, useState, useId, type VideoHTMLAttributes } from 'react'
import { DEFAULT_SUBTITLE_STYLE, positionSubtitleCue, subtitleFontPixels, type SubtitleStyle } from '../subtitle-style.mjs'
import type { SubtitleTrack } from './SubtitlePanel'
import type Hls from 'hls.js'
import { rankLevels, type QualityOption } from '../stream-quality.mjs'
export type NativeSubtitleTrack = { id: string; label: string; language: string; default?: boolean }

export type StreamVideoProps = VideoHTMLAttributes<HTMLVideoElement> & {
  src: string
  format?: string
  onStreamError: (message: string) => void
  subtitle?: (SubtitleTrack & { delay: number }) | null
  onSubtitleError?: (message: string) => void
  nativeSubtitleId?: string
  onNativeTracks?: (tracks: NativeSubtitleTrack[]) => void
  subtitleStyle?: SubtitleStyle
  qualityId?: string
  onQualities?: (options:QualityOption[])=>void
}

const StreamVideo = forwardRef<HTMLVideoElement, StreamVideoProps>(function StreamVideo(
  { src, format, onStreamError, subtitle, onSubtitleError, nativeSubtitleId = 'off', onNativeTracks, subtitleStyle = DEFAULT_SUBTITLE_STYLE, qualityId, onQualities, ...props },
  forwardedRef,
) {
  const element = useRef<HTMLVideoElement | null>(null)
  const hlsInstance = useRef<Hls|null>(null)
  const qualitiesCallback = useRef(onQualities)
  qualitiesCallback.current = onQualities
  useEffect(()=>{const hls=hlsInstance.current;if(hls && qualityId?.startsWith('hls:')){const index=Number(qualityId.slice(4));if(Number.isInteger(index)&&hls.levels[index]){hls.currentLevel=index;hls.loadLevel=index}}},[qualityId])
  const subtitleElement = useRef<HTMLTrackElement | null>(null)
  const captionId = useId().replace(/[^a-zA-Z0-9]/g,'')
  const [fontPixels,setFontPixels] = useState(24)
  const layout = useRef(subtitleStyle)
  layout.current = subtitleStyle
  const cueLayouts = useRef(new WeakMap<TextTrackCue,string>())
  function applyLayout(activeOnly = false) {
    const rect=element.current?.getBoundingClientRect()
    const viewport={width:rect?.width || 889,height:rect?.height || 500}
    const signature=JSON.stringify([layout.current,viewport.width,viewport.height])
    for(const track of Array.from(element.current?.textTracks || [])) {
      let changed=false
      for(const cue of Array.from((activeOnly ? track.activeCues : track.cues) || [])) {
        if(cueLayouts.current.get(cue)===signature)continue
        positionSubtitleCue(cue,layout.current,viewport)
        cueLayouts.current.set(cue,signature)
        changed=true
      }
      // Refresh paused/ended frames too; Chromium otherwise keeps an old cue box.
      if(changed && track.mode==='showing'){track.mode='hidden';track.mode='showing'}
    }
  }
  useEffect(()=>{
    const video=element.current!
    const update=()=>{setFontPixels(subtitleFontPixels(video.getBoundingClientRect().height,layout.current.scale));applyLayout()}
    const observer=new ResizeObserver(update)
    observer.observe(video);update();applyLayout()
    return()=>observer.disconnect()
  },[subtitleStyle.scale,subtitleStyle.x,subtitleStyle.y])
  useEffect(()=>{
    const video=element.current!,tracks=new Set<TextTrack>()
    const changed=()=>applyLayout(true)
    const added=()=>{for(const track of Array.from(video.textTracks))if(!tracks.has(track)){tracks.add(track);track.addEventListener('cuechange',changed)};applyLayout()}
    video.textTracks.addEventListener('addtrack',added)
    video.addEventListener('loadedmetadata',added)
    added()
    return()=>{video.textTracks.removeEventListener('addtrack',added);video.removeEventListener('loadedmetadata',added);for(const track of tracks)track.removeEventListener('cuechange',changed)}
  },[src])
  const cueTimes = useRef(
    new WeakMap<TextTrackCue, { start: number; end: number }>(),
  )
  const nativeChoice = useRef(nativeSubtitleId)
  nativeChoice.current = nativeSubtitleId
  const nativeCallback = useRef(onNativeTracks)
  nativeCallback.current = onNativeTracks
  const activeSubtitle = useRef(subtitle)
  activeSubtitle.current = subtitle
  function nativeTracks() {
    return Array.from(element.current?.textTracks || []).filter(track => track.id !== 'yingyu-external-subtitle' && track !== subtitleElement.current?.track && ['subtitles', 'captions'].includes(track.kind))
  }
  function applyNative() {
    nativeTracks().forEach((track,index)=>{track.mode = !activeSubtitle.current && nativeChoice.current === `native:${index}` ? 'showing' : 'disabled'})
  }
  const offset = useRef(0)
  offset.current = subtitle?.delay || 0
  function applySubtitles() {
    const track = subtitleElement.current?.track
    if (!track || !element.current) return
    for (const other of Array.from(element.current.textTracks))
      if (other !== track) {
        other.mode = 'disabled'
      }
    track.mode = 'showing'
    for (const cue of Array.from(track.cues || [])) {
      if (!cueTimes.current.has(cue))
        cueTimes.current.set(cue, { start: cue.startTime, end: cue.endTime })
      const original = cueTimes.current.get(cue)!
      cue.startTime = Math.max(0, original.start + offset.current)
      cue.endTime = Math.max(
        cue.startTime + 0.001,
        original.end + offset.current,
      )
    }
    applyLayout()
  }
  useEffect(() => {
    if (subtitle) applySubtitles()
    else applyNative()
  }, [subtitle?.id, subtitle?.delay, nativeSubtitleId])
  useEffect(() => {
    const video=element.current!
    let last=''
    const update=()=>{
      const tracks=nativeTracks().map((track,index)=>({id:`native:${index}`,label:track.label || `字幕轨道 ${index+1}`,language:track.language || 'und'}))
      const signature=JSON.stringify(tracks)
      if(signature!==last){last=signature;nativeCallback.current?.(tracks)}
      applyNative()
    }
    video.textTracks.addEventListener('addtrack',update)
    video.textTracks.addEventListener('removetrack',update)
    video.addEventListener('loadedmetadata',update)
    update()
    return ()=>{
      video.textTracks.removeEventListener('addtrack',update)
      video.textTracks.removeEventListener('removetrack',update)
      video.removeEventListener('loadedmetadata',update)
    }
  }, [src])
  const reportError = useRef(onStreamError)
  reportError.current = onStreamError

  useEffect(() => {
    const video = element.current!
    let disposed = false
    let destroy: (() => void) | undefined

    async function attach() {
      if (format !== 'hls') {
        video.src = src
        return
      }
      const [{ default: Hls }, { default: workerPath }] = await Promise.all([
        import('hls.js'),
        import('hls.js/dist/hls.worker.js?url'),
      ])
      if (disposed) return
      if (!Hls.isSupported()) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = src
          return
        }
        reportError.current(
          '当前环境不支持此视频流，请使用新版幻屿桌面端或升级浏览器',
        )
        return
      }
      const hls = new Hls({
        workerPath,
        backBufferLength: 30,
        autoStartLoad: false,
      })
      hlsInstance.current = hls
      destroy = () => {hls.destroy();hlsInstance.current=null}
      let recovered = false
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true
          hls.recoverMediaError()
          return
        }
        reportError.current(
          data.type === Hls.ErrorTypes.NETWORK_ERROR
            ? '视频流连接中断，请检查网络后重新尝试'
            : '当前线路无法解码，可尝试其他画质或播放线路',
        )
        hls.destroy()
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Some providers return a master playlist even for a chosen quality.
        // Select its highest level before requesting the first media fragment.
        let highest = 0
        for (let index = 1; index < hls.levels.length; index++) {
          const level = hls.levels[index]
          const best = hls.levels[highest]
          const pixels = (level.width || 0) * (level.height || 0)
          const bestPixels = (best.width || 0) * (best.height || 0)
          if (
            pixels > bestPixels ||
            (pixels === bestPixels && level.bitrate > best.bitrate)
          )
            highest = index
        }
        hls.startLevel = highest
        hls.loadLevel = highest
        qualitiesCallback.current?.(rankLevels(hls.levels))
        hls.startLoad()
        if (video.autoplay) void video.play().catch(() => {})
      })
      hls.loadSource(src)
      hls.attachMedia(video)
    }
    void attach().catch(() => {
      if (!disposed) reportError.current('播放器加载失败，请刷新页面后重试')
    })
    return () => {
      disposed = true
      destroy?.()
      video.removeAttribute('src')
      video.load()
    }
  }, [src, format])

  return (
    <><style>{`video[data-caption-id="${captionId}"]::cue { font-size: ${fontPixels}px; }`}</style><video
      {...props}
      data-caption-id={captionId}
      ref={(video) => {
        element.current = video
        if (typeof forwardedRef === 'function') forwardedRef(video)
        else if (forwardedRef) forwardedRef.current = video
      }}
    >
      {subtitle && (
        <track
          id="yingyu-external-subtitle"
          key={subtitle.id}
          ref={subtitleElement}
          kind="subtitles"
          label={subtitle.label}
          srcLang={subtitle.language}
          src={subtitle.url}
          default
          onLoad={() => {
            applySubtitles()
            onSubtitleError?.('')
          }}
          onError={() =>
            onSubtitleError?.('字幕加载失败，可重新搜索或手动载入')
          }
        />
      )}
    </video></>
  )
})

export default StreamVideo
