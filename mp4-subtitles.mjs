import { open } from 'node:fs/promises'
import { createFile } from 'mp4box'
import { MAX_SUBTITLE_BYTES, subtitleToVtt } from './subtitles.mjs'

const MAX_INDEX_BYTES = 12 * 1024 * 1024
const MAX_READ_BYTES = 20 * 1024 * 1024
const MAX_SAMPLES = 250000

// This reader only accepts a server-created loopback proxy or a library path.
// Upstream cookies and signed CDN URLs stay inside the existing video proxy.
export async function readMediaRange(source, start, length) {
  source.signal?.throwIfAborted()
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_READ_BYTES) throw new Error('字幕索引范围无效')
  if (/^https?:/i.test(source.url)) {
    const url = new URL(source.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('字幕只允许通过本机播放代理读取')
    const timeout=AbortSignal.timeout(18000)
    const response = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, redirect: 'error', signal: source.signal ? AbortSignal.any([source.signal,timeout]) : timeout })
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '')
    if (response.status !== 206 || !range || Number(range[1]) !== start || Number(range[2]) !== start + length - 1) {
      await response.body?.cancel()
      throw new Error('播放源不支持精确范围读取')
    }
    const chunks = []; let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > length) throw new Error('字幕数据超出范围限制')
      chunks.push(chunk)
    }
    if (size !== length) throw new Error('字幕数据不完整')
    return Buffer.concat(chunks)
  }
  const file = await open(source.url, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const result = await file.read(buffer, read, length - read, start + read)
      if (!result.bytesRead) throw new Error('字幕索引不完整')
      read += result.bytesRead
    }
    return buffer
  } finally { await file.close() }
}

function validateSampleCounts(bytes) {
  let samples = 0, boxes = 0
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])
  function walk(start, end, depth = 0) {
    if (depth > 6) throw new Error('字幕索引层级无效')
    for (let at = start; at + 8 <= end;) {
      if (++boxes > 20000) throw new Error('字幕索引过大')
      let size = bytes.readUInt32BE(at), header = 8
      const type = bytes.toString('ascii', at + 4, at + 8)
      if (size === 1) { if (at + 16 > end) throw new Error('字幕索引无效'); size = Number(bytes.readBigUInt64BE(at + 8)); header = 16 }
      if (!size) size = end - at
      if (!Number.isSafeInteger(size) || size < header || at + size > end) throw new Error('字幕索引无效')
      if (type === 'stsz') {
        if (size < header + 12) throw new Error('字幕样本表无效')
        const count = bytes.readUInt32BE(at + header + 8)
        samples += count
        if (count > MAX_SAMPLES || samples > 1000000) throw new Error('当前视频索引需要兼容读取')
      }
      if (type === 'stz2') throw new Error('当前字幕索引需要兼容读取')
      if (containers.has(type)) walk(at + header, at + size, depth + 1)
      at += size
    }
  }
  walk(0, bytes.length)
}

export async function readMp4Index(source, read = readMediaRange) {
  let offset = 0, moov, ftyp
  for (let boxes = 0; boxes < 80; boxes++) {
    const head = await read(source, offset, 8)
    let size = head.readUInt32BE(0), header = 8
    const type = head.toString('ascii', 4, 8)
    if (size === 1) { size = Number((await read(source, offset + 8, 8)).readBigUInt64BE()); header = 16 }
    if (!Number.isSafeInteger(size) || size < header || !Number.isSafeInteger(offset + size)) throw new Error('MP4 索引无效或未完成')
    if (type === 'moov') {
      if (size > MAX_INDEX_BYTES) throw new Error('视频索引需要兼容读取')
      moov = await read(source, offset, size)
      break
    }
    if (type === 'ftyp' && size <= 65536) ftyp = await read(source, offset, size)
    offset += size
  }
  if (!moov) throw new Error('没有找到 MP4 字幕索引')
  validateSampleCounts(moov)
  const file = createFile()
  let info, failed = false
  file.onReady = value => { info = value }
  file.onError = () => { failed = true }
  const bytes = Buffer.concat([ftyp || Buffer.alloc(0), moov])
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  buffer.fileStart = 0
  file.appendBuffer(buffer, true)
  if (failed || !info || info.isFragmented) throw new Error('当前 MP4 字幕需要兼容读取')
  const tracks = info.tracks.map((track, index) => {
    const entry = file.getTrackById(track.id)?.mdia?.minf?.stbl?.stsd?.entries?.[0]
    const isSubtitle = ['tx3g', 'wvtt', 'stpp'].includes(entry?.type)
    const samples = isSubtitle ? file.getTrackSamplesInfo(track.id) || [] : []
    return {
      id: String(index), index, containerId: track.id,
      codec: entry?.type === 'tx3g' ? 'mov_text' : entry?.type === 'wvtt' ? 'webvtt' : track.codec,
      language: track.language || 'und', title: track.name || '',
      isSubtitle,
      width: track.video?.width || 0, height: track.video?.height || 0,
      timescale: track.timescale, duration: track.duration / track.timescale,
      movieTimescale: info.timescale, edits: track.edits || [],
      samples: samples.map(sample => ({ offset: sample.offset, size: sample.size, cts: sample.cts, duration: sample.duration })),
    }
  })
  return { tracks, duration: info.duration / info.timescale }
}

function timelineOffset(track) {
  // A leading empty edit delays the track; a media edit trims its origin.
  let offset = 0
  if(track.edits.filter(edit=>edit.media_time!==-1).length>1)throw new Error('复杂字幕时间轴需要兼容读取')
  for (const edit of track.edits) {
    if (edit.media_time === -1) offset += edit.segment_duration / track.movieTimescale
    else {
      if (edit.media_rate_integer !== 1 || edit.media_rate_fraction !== 0) throw new Error('字幕时间轴需要兼容读取')
      return offset - edit.media_time / track.timescale
    }
  }
  return offset
}
function timestamp(seconds) {
  const ms = Math.round(Math.max(0, seconds) * 1000)
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

export async function readMp4TextTrack(source, index, trackId, read = readMediaRange, window) {
  const track = index.tracks.find(t => t.id === String(trackId))
  if (!track?.isSubtitle || track.codec !== 'mov_text' || track.samples.length > 25000 || !track.timescale) throw new Error('此字幕需要兼容读取')
  const shift = timelineOffset(track)
  const samples = track.samples.filter(s => s.size > 2 && (!window || (s.cts / track.timescale + shift < window.end && (s.cts + s.duration) / track.timescale + shift > window.start)))
  if (samples.reduce((sum, s) => sum + s.size, 0) > MAX_SUBTITLE_BYTES) throw new Error('字幕数据超过限制')
  const groups = []
  // Merge nearby text samples, while keeping video bytes and memory bounded.
  for (const sample of [...samples].sort((a, b) => a.offset - b.offset)) {
    if (!Number.isSafeInteger(sample.offset) || sample.offset < 0 || !Number.isSafeInteger(sample.size) || sample.size < 2 || sample.size > MAX_SUBTITLE_BYTES) throw new Error('字幕样本索引无效')
    const last = groups.at(-1), end = sample.offset + sample.size
    if (last && sample.offset >= last.start && sample.offset <= last.end + 2048 && end - last.start <= 256 * 1024) { last.end = Math.max(last.end, end); last.samples.push(sample) }
    else groups.push({ start: sample.offset, end, samples: [sample] })
  }
  if (groups.length > 2500 || groups.reduce((sum, group) => sum + group.end - group.start, 0) > MAX_READ_BYTES) throw new Error('字幕读取需要兼容模式')
  const cues = []; let cursor = 0
  async function worker() {
    while (cursor < groups.length) {
      const group = groups[cursor++]
      const bytes = await read(source, group.start, group.end - group.start)
      for (const sample of group.samples) {
        const offset = sample.offset - group.start, size = bytes.readUInt16BE(offset)
        if (size > sample.size - 2) throw new Error('字幕样本不完整')
        if (!size) continue
        const raw = bytes.subarray(offset + 2, offset + 2 + size)
        const text = raw[0] === 0xfe && raw[1] === 0xff ? new TextDecoder('utf-16be').decode(raw.subarray(2)) : raw[0] === 0xff && raw[1] === 0xfe ? new TextDecoder('utf-16le').decode(raw.subarray(2)) : raw.toString('utf8')
        const start = sample.cts / track.timescale + shift, end = start + sample.duration / track.timescale
        if (end > 0 && end > start && text.trim()) cues.push({start: Math.max(0, start), end, text})
      }
    }
  }
  const results = await Promise.allSettled(Array.from({length: Math.min(6, groups.length)}, worker))
  const rejected = results.find(result => result.status === 'rejected')
  if (rejected) throw rejected.reason
  let vtt = 'WEBVTT\n\n'
  for (const cue of cues.sort((a, b) => a.start - b.start)) vtt += `${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n\n`
  if (cues.length) vtt = subtitleToVtt(Buffer.from(vtt), 'inner.vtt').vtt
  return { vtt, duration: Math.max(index.duration || 0, track.duration || 0, ...cues.map(cue => cue.end)), requests: groups.length }
}
