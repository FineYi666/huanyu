import path from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'

export const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.vtt'])
export const isSubtitle = (name) =>
  SUBTITLE_EXTENSIONS.has(path.extname(name).toLowerCase())
export const MAX_SUBTITLE_BYTES = 6 * 1024 * 1024
const base = (name) => String(name).split(/[\\/]/).at(-1)
const stem = (name) =>
  base(name)
    .replace(/\.[^.]+$/, '')
    .normalize('NFKC')
    .toLowerCase()
const normalized = (text) => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
const cnNumber = (text) =>
  /^\d+$/.test(text)
    ? Number(text)
    : text.includes('十')
      ? (text.split('十')[0]
          ? '零一二三四五六七八九'.indexOf(text.split('十')[0])
          : 1) *
          10 +
        (text.split('十')[1]
          ? '零一二三四五六七八九'.indexOf(text.split('十')[1])
          : 0)
      : '零一二三四五六七八九'.indexOf(text)

export function episodeNumbers(name) {
  const value = stem(name)
  let m = value.match(/(?:^|[^a-z0-9])s(\d{1,2})[ ._-]*e(\d{1,3})(?=$|[^0-9])/i)
  if (m) return { season: Number(m[1]), episode: Number(m[2]) }
  m = value.match(/第([零一二三四五六七八九十\d]+)[集话話]/)
  if (m) return { episode: cnNumber(m[1]) }
  m = value.match(
    /(?:\b(?:ep?|episode)[ ._-]*|\[|(?:^|[ ._-]))(\d{1,3})(?=\]|(?:[ ._-](?:end|chs|cht|sc|tc|zh|jp|1080|720|2160|v\d))|$)/i,
  )
  return m ? { episode: Number(m[1]) } : {}
}
export function subtitleLanguage(name) {
  if (/(?:chs|zh[-_.]?cn|简体|简中|简日|sc\b)/i.test(name)) return 'zh-CN'
  if (/(?:cht|zh[-_.]?(?:tw|hk)|繁体|繁中|繁日|tc\b)/i.test(name))
    return 'zh-TW'
  if (/(?:\beng?\b|英语|英文)/i.test(name)) return 'en'
  if (/(?:\bjp[n]?\b|\bja\b|日语)/i.test(name)) return 'ja'
  return 'und'
}
export function sidecarScore(videoName, subtitleName) {
  const a = stem(videoName),
    b = stem(subtitleName)
  const clean = (value) =>
    normalized(
      value
        .replace(
          /(?:[ ._\-\[])(?:chs|cht|zh[-_.]?(?:cn|tw|hk)|en|eng|ja|jp|jpn|sc|tc|简体|繁体|简中|繁中|简日|繁日|中日|双语|字幕|subtitles?)(?=[ ._\-\]]|$)/gi,
          '',
        )
        .replace(
          /\b(?:1080p|720p|2160p|x26[45]|h26[45]|avc|hevc|aac|flac|web[- .]?dl|bluray)\b/gi,
          '',
        ),
    )
  if (a === b || clean(a) === clean(b)) return 100
  if (b.startsWith(a + '.') || b.startsWith(a + '_')) return 98
  const av = episodeNumbers(videoName),
    bv = episodeNumbers(subtitleName)
  if (
    av.episode === undefined ||
    av.episode !== bv.episode ||
    (av.season && bv.season && av.season !== bv.season)
  )
    return 0
  const title = (value) =>
    clean(
      value.replace(
        /\bs\d{1,2}[ ._-]*e\d{1,3}\b|第[零一二三四五六七八九十\d]+[集话話]|(?:^|[ ._\-\[])\d{1,3}(?=[\]. _-]|$)/gi,
        '',
      ),
    )
  const at = title(a),
    bt = title(b)
  if (
    !at ||
    !bt ||
    at === bt ||
    (Math.min(at.length, bt.length) >= 4 &&
      (at.includes(bt) || bt.includes(at)))
  )
    return 85
  return 0
}

export async function findLocalSubtitles(episode) {
  const root = path.dirname(episode.path),
    candidates = []
  let visited = 0
  async function walk(folder, depth) {
    if (++visited > 20) return
    const entries = await readdir(folder, { withFileTypes: true }).catch(
      () => [],
    )
    for (const entry of entries.slice(0, 3000)) {
      const file = path.join(folder, entry.name)
      if (entry.isFile() && isSubtitle(entry.name)) {
        const score = sidecarScore(episode.name, entry.name)
        if (score)
          candidates.push({
            name: entry.name,
            path: file,
            score,
            language: subtitleLanguage(entry.name),
          })
      } else if (
        entry.isDirectory() &&
        depth < 2 &&
        (depth ||
          /^(?:subs?|subtitles?|字幕|外挂字幕|中文|chs|cht|sc|tc|zh[-_]?(?:cn|tw)|简体|繁体)$/i.test(
            entry.name,
          ))
      )
        await walk(file, depth + 1)
    }
  }
  await walk(root, 0)
  return candidates
    .sort(
      (a, b) =>
        Number(b.language.startsWith('zh')) -
          Number(a.language.startsWith('zh')) || b.score - a.score,
    )
    .slice(0, 12)
}

export async function readLocalSubtitle(file) {
  const info = await stat(file)
  if (!info.isFile() || info.size > MAX_SUBTITLE_BYTES)
    throw new Error('字幕文件过大，最多支持 6 MB')
  return readFile(file)
}
function decode(bytes) {
  if (!bytes.length || bytes.length > MAX_SUBTITLE_BYTES)
    throw new Error('字幕文件为空或超过 6 MB')
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}
const timestamp = (text) => {
  const m = String(text)
    .trim()
    .match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/)
  if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) return NaN
  return (
    Number(m[1] || 0) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4].padEnd(3, '0')) / 1000
  )
}
const formatTime = (seconds) => {
  const ms = Math.round(seconds * 1000)
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}
function plainCue(value) {
  return value
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\u0000/g, '')
    .trim()
}
export function subtitleToVtt(bytes, name) {
  const text = decode(bytes)
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n'),
    cues = []
  const add = (start, end, line) => {
    const content = plainCue(line)
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end < 360000 &&
      content &&
      cues.length < 100000
    )
      cues.push({ start, end, text: content })
  }
  if (/\.(ass|ssa)$/i.test(name) || /\[Events\]/i.test(text)) {
    let inEvents = false,
      fields = [
        'layer',
        'start',
        'end',
        'style',
        'name',
        'marginl',
        'marginr',
        'marginv',
        'effect',
        'text',
      ]
    for (const line of text.split('\n')) {
      if (/^\[/.test(line.trim())) inEvents = /^\[Events\]/i.test(line.trim())
      if (!inEvents) continue
      if (/^Format:/i.test(line))
        fields = line
          .slice(line.indexOf(':') + 1)
          .split(',')
          .map((s) => s.trim().toLowerCase())
      if (!/^Dialogue:/i.test(line)) continue
      const value = line.slice(line.indexOf(':') + 1).trimStart(),
        columns = value.split(',')
      if (columns.length < fields.length || fields.at(-1) !== 'text') continue
      const content = columns.slice(fields.length - 1).join(',')
      if (/\{[^}]*\\p[1-9]/.test(content)) continue
      add(
        timestamp(columns[fields.indexOf('start')]),
        timestamp(columns[fields.indexOf('end')]),
        content,
      )
    }
  } else {
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n'),
        at = lines.findIndex((line) => line.includes('-->'))
      if (at < 0) continue
      const pair = lines[at].split('-->')
      add(
        timestamp(pair[0]),
        timestamp(pair[1].trim().split(/\s+/)[0]),
        lines.slice(at + 1).join('\n'),
      )
    }
  }
  if (!cues.length)
    throw new Error('未识别到有效字幕，支持 SRT、ASS、SSA、WebVTT 文本字幕')
  cues.sort((a, b) => a.start - b.start)
  const escape = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    vtt:
      'WEBVTT\n\n' +
      cues
        .map(
          (c, i) =>
            `${i + 1}\n${formatTime(c.start)} --> ${formatTime(c.end)}\n${escape(c.text)}\n`,
        )
        .join('\n'),
    cueCount: cues.length,
  }
}

export function subtitleQuery(media, episode) {
  const index = media.episodes.findIndex((item) => item.id === episode.id)
  const numbers = episodeNumbers(episode.name)
  const seasonText = String(media.title).match(
    /第([一二三四五六七八九十\d]+)[季期]|season\s*(\d{1,2})/i,
  )
  const season =
    numbers.season ||
    (seasonText ? cnNumber(seasonText[1] || seasonText[2]) : 1)
  const ep = numbers.episode ?? index + 1
  const title = String(media.title)
    .replace(/第[一二三四五六七八九十\d]+[季期]|season\s*\d+/gi, '')
    .trim()
    .slice(0, 120)
  const movie = media.category === 'movie' || media.genre === '电影'
  return {
    title,
    season,
    episode: ep,
    movie,
    year: media.year,
    query: movie
      ? `${title} ${media.year || ''}`.trim()
      : `${title} S${String(season).padStart(2, '0')}E${String(ep).padStart(2, '0')}`,
  }
}
export function rankOnlineSubtitles(rows, target) {
  const title = normalized(target.title)
  return rows
    .filter((row) => {
      if (
        !isSubtitle('file.' + String(row.ext || '').replace(/^\./, '')) ||
        typeof row.url !== 'string'
      )
        return false
      const label = normalized(
        String(row.simple_name || '') + ' ' + String(row.name || ''),
      )
      if (!label.includes(title)) return false
      const info = episodeNumbers(String(row.name || '') + ' .srt'),
        summary = episodeNumbers(String(row.simple_name || '') + ' .srt')
      const episode = summary.episode ?? info.episode,
        season = summary.season ?? info.season
      if (
        !target.movie &&
        (episode !== target.episode || (season && season !== target.season))
      )
        return false
      if (
        target.movie &&
        target.year &&
        /(?:19|20)\d{2}/.test(label) &&
        !label.includes(String(target.year))
      )
        return false
      return true
    })
    .map((row) => ({
      ...row,
      language: subtitleLanguage(
        (row.languages || row.langs || []).toString() + ' ' + row.name,
      ),
      label: row.name || row.simple_name,
    }))
    .sort(
      (a, b) =>
        Number(b.language === 'zh-CN') - Number(a.language === 'zh-CN') ||
        Number(b.language.startsWith('zh')) -
          Number(a.language.startsWith('zh')),
    )
    .slice(0, 20)
}
