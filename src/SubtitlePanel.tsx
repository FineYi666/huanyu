import { useEffect, useRef, useState } from 'react'
import {
  Captions,
  LoaderCircle,
  Search,
  Upload,
  Minus,
  Plus,
} from 'lucide-react'
import type { Media, Episode } from './types'
import './subtitles.css'

export type SubtitleTrack = {
  id: string
  url: string
  label: string
  language: string
  origin: string
  source?: string
}
type Result = {
  tracks: SubtitleTrack[]
  selectedId: string
  delay: number
  message: string
  query?: string
}
export default function SubtitlePanel({
  media,
  episode,
  onTrack,
  trackError,
}: {
  media: Media
  episode: Episode
  onTrack: (track: (SubtitleTrack & { delay: number }) | null) => void
  trackError: string
}) {
  const [data, setData] = useState<Result | null>(null),
    [busy, setBusy] = useState('正在匹配外挂字幕…'),
    [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    active = useRef(true)
  const callback = useRef(onTrack)
  callback.current = onTrack
  const identity = { mediaId: media.id, episodeId: episode.id }
  async function request(action: string, input: object = {}) {
    const r = await fetch('/api/subtitles/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...identity, ...input }),
    })
    const value = await r.json()
    if (!r.ok) throw new Error(value.error || '字幕暂时无法加载')
    return value as Result
  }
  function update(value: Result) {
    setData(value)
    const selected = value.tracks.find((track) => track.id === value.selectedId)
    callback.current(selected ? { ...selected, delay: value.delay } : null)
  }
  async function discover() {
    const id = ++generation.current
    setBusy('正在匹配外挂字幕…')
    setError('')
    try {
      let result = await request('discover')
      if (!active.current || id !== generation.current) return
      update(result)
      if (!result.tracks.length && result.selectedId !== 'off') {
        setBusy('没有外挂字幕，正在在线搜索…')
        result = await request('search')
        if (active.current && id === generation.current) update(result)
      }
    } catch (e) {
      if (active.current && id === generation.current)
        setError((e as Error).message)
    } finally {
      if (active.current && id === generation.current) setBusy('')
    }
  }
  useEffect(() => {
    active.current = true
    void discover()
    return () => {
      active.current = false
      ++generation.current
      callback.current(null)
    }
  }, [media.id, episode.id])
  async function search() {
    const id = ++generation.current
    setBusy('正在搜索中文字幕…')
    setError('')
    try {
      const result = await request('search', { force: true })
      if (active.current && id === generation.current) update(result)
    } catch (e) {
      if (active.current && id === generation.current)
        setError((e as Error).message)
    } finally {
      if (active.current && id === generation.current) setBusy('')
    }
  }
  async function preference(patch: { selected?: string; delay?: number }) {
    if (!data) return
    update({
      ...data,
      selectedId: patch.selected ?? data.selectedId,
      delay: patch.delay ?? data.delay,
    })
    try {
      await request('preferences', patch)
    } catch (e) {
      if (active.current) setError((e as Error).message)
    }
  }
  async function upload(selected: File) {
    if (selected.size > 6 * 1024 * 1024) {
      setError('字幕文件最多支持 6 MB')
      return
    }
    const id = ++generation.current
    setBusy('正在载入字幕…')
    setError('')
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer())
      let binary = ''
      for (let at = 0; at < bytes.length; at += 8192)
        binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
      const result = await request('upload', {
        name: selected.name,
        content: btoa(binary),
      })
      if (active.current && id === generation.current) update(result)
    } catch (e) {
      if (active.current && id === generation.current)
        setError((e as Error).message)
    } finally {
      if (active.current && id === generation.current) setBusy('')
    }
  }
  const selected = data?.tracks.find((track) => track.id === data.selectedId)
  return (
    <section className="subtitle-panel" aria-label="字幕设置">
      <div className="subtitle-heading">
        <span>
          <Captions size={18} />
          <strong>字幕</strong>
          <i>
            {busy ? (
              <LoaderCircle size={12} className="spin" />
            ) : selected ? (
              selected.origin === 'online' ? (
                '在线匹配'
              ) : selected.origin === 'manual' ? (
                '手动载入'
              ) : (
                '外挂已加载'
              )
            ) : data?.selectedId === 'off' ? (
              '已关闭'
            ) : (
              '自动匹配'
            )}
          </i>
        </span>
        <div>
          <button
            className="button subtle"
            disabled={!!busy}
            onClick={() => void search()}
          >
            <Search size={13} />
            搜索字幕
          </button>
          <button
            className="button subtle"
            onClick={() => file.current?.click()}
          >
            <Upload size={13} />
            载入字幕
          </button>
        </div>
      </div>
      <input
        ref={file}
        hidden
        type="file"
        accept=".srt,.ass,.ssa,.vtt"
        aria-label="选择外挂字幕文件"
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0])
          e.target.value = ''
        }}
      />
      <p className="subtitle-status" role="status">
        {busy ||
          error ||
          trackError ||
          (selected
            ? `${selected.source ? selected.source + ' · ' : ''}${selected.label}`
            : data?.selectedId === 'off'
              ? '外挂字幕已关闭，可从字幕轨道中重新开启。'
              : data?.message || '自动识别同目录字幕，优先中文字幕。')}
      </p>
      {!!data?.tracks.length && (
        <div className="subtitle-controls">
          <label>
            <span>字幕轨道</span>
            <select
              aria-label="字幕轨道"
              value={data.selectedId || 'off'}
              onChange={(e) => void preference({ selected: e.target.value })}
            >
              <option value="off">关闭外挂字幕</option>
              {data.tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.language.startsWith('zh') ? '中文 · ' : ''}
                  {track.label}
                </option>
              ))}
            </select>
          </label>
          <div className="subtitle-delay">
            <span>时间偏移</span>
            <button
              aria-label="字幕提前半秒"
              disabled={!selected || data.delay <= -120}
              onClick={() =>
                void preference({ delay: Math.max(-120, data.delay - 0.5) })
              }
            >
              <Minus size={12} />
            </button>
            <output aria-label="字幕时间偏移">
              {data.delay > 0 ? '+' : ''}
              {data.delay.toFixed(1)} 秒
            </output>
            <button
              aria-label="字幕延后半秒"
              disabled={!selected || data.delay >= 120}
              onClick={() =>
                void preference({ delay: Math.min(120, data.delay + 0.5) })
              }
            >
              <Plus size={12} />
            </button>
            {!!data.delay && (
              <button
                className="subtitle-reset"
                onClick={() => void preference({ delay: 0 })}
              >
                重置
              </button>
            )}
          </div>
        </div>
      )}
      <p className="subtitle-hint">
        支持 SRT / ASS / SSA / VTT。搜索仅发送作品名和季集信息。
        {selected?.origin === 'online'
          ? '在线字幕版本可能不同，可调整时间偏移。'
          : '视频已有画面字幕时，可关闭外挂字幕。'}
        {data?.query && !selected && (
          <a
            href={`https://assrt.net/sub/?searchword=${encodeURIComponent(data.query)}`}
            target="_blank"
            rel="noreferrer"
          >
            去字幕网站查找 ↗
          </a>
        )}
      </p>
    </section>
  )
}
