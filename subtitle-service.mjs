import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { fetchVideoSource } from './video-stream.mjs'
import {
  findLocalSubtitles,
  readLocalSubtitle,
  subtitleToVtt,
  subtitleLanguage,
  sidecarScore,
  subtitleQuery,
  rankOnlineSubtitles,
  MAX_SUBTITLE_BYTES,
  isSubtitle,
} from './subtitles.mjs'

async function limitedBody(response, limit = MAX_SUBTITLE_BYTES) {
  if (!response.ok) throw new Error('字幕来源暂时无法读取')
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new Error('字幕文件超过大小限制')
  }
  const reader = response.body.getReader(),
    chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('字幕文件超过大小限制')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
export async function createSubtitleService({ data, quark, fetcher = fetch }) {
  const directory = path.join(data, 'subtitles')
  await mkdir(directory, { recursive: true })
  let stored = { tracks: {}, preferences: {} }
  try {
    const value = JSON.parse(
      await readFile(path.join(directory, 'index.json'), 'utf8'),
    )
    if (value.tracks && value.preferences) stored = value
  } catch {}
  let writing = Promise.resolve()
  const pending = new Map(),
    searched = new Map()
  const context = (media, episode) => `${media.id}/${episode.id}`
  function save() {
    const snapshot = JSON.stringify(stored)
    writing = writing
      .catch(() => {})
      .then(async () => {
        await writeFile(path.join(directory, 'index.tmp'), snapshot)
        await rename(
          path.join(directory, 'index.tmp'),
          path.join(directory, 'index.json'),
        )
      })
    return writing
  }
  function view(key, message = '', query = '') {
    const tracks = Object.values(stored.tracks)
      .filter((track) => track.context === key)
      .sort(
        (a, b) =>
          Number(b.origin === 'manual') - Number(a.origin === 'manual') ||
          Number(a.origin === 'online') - Number(b.origin === 'online') ||
          Number(b.language === 'zh-CN') - Number(a.language === 'zh-CN'),
      )
    const pref = stored.preferences[key] || {}
    return {
      tracks: tracks.map(({ context, ...track }) => ({
        ...track,
        url: `/api/subtitles/file/${track.id}.vtt`,
      })),
      selectedId:
        pref.selected === 'off'
          ? 'off'
          : tracks.some((t) => t.id === pref.selected)
            ? pref.selected
            : tracks[0]?.id || '',
      delay: pref.delay || 0,
      message,
      query,
    }
  }
  async function add(
    media,
    episode,
    bytes,
    name,
    origin,
    source = '',
    language,
  ) {
    const converted = subtitleToVtt(bytes, name),
      key = context(media, episode)
    const id = createHash('sha256')
      .update(key)
      .update(converted.vtt)
      .digest('hex')
      .slice(0, 32)
    await writeFile(path.join(directory, id + '.vtt'), converted.vtt)
    stored.tracks[id] = {
      id,
      context: key,
      label: String(name).split(/[\\/]/).at(-1).slice(0, 180),
      language: language || subtitleLanguage(name),
      origin,
      source,
      cueCount: converted.cueCount,
    }
    await save()
    return id
  }
  async function remote(source) {
    return limitedBody(
      await fetchVideoSource(source, {
        method: 'GET',
        signal: AbortSignal.timeout(18000),
      }),
    )
  }
  return {
    async discover(media, episode, refresh = false) {
      const key = context(media, episode)
      if (pending.has(key)) return pending.get(key)
      const operation = (async () => {
        let failed = 0,
          candidates = []
        if (media.source === 'local') {
          candidates = await findLocalSubtitles(episode)
          for (const candidate of candidates.slice(0, 6))
            try {
              await add(
                media,
                episode,
                await readLocalSubtitle(candidate.path),
                candidate.name,
                'local',
              )
            } catch {
              failed++
            }
        } else if (media.source === 'quark') {
          try {
            const files = await quark.findSubtitles(media, refresh)
            candidates = files
              .filter((file) => sidecarScore(episode.name, file.name))
              .sort(
                (a, b) =>
                  Number(subtitleLanguage(b.name).startsWith('zh')) -
                    Number(subtitleLanguage(a.name).startsWith('zh')) ||
                  sidecarScore(episode.name, b.name) -
                    sidecarScore(episode.name, a.name),
              )
            for (const file of candidates.slice(0, 4)) {
              if (file.size > MAX_SUBTITLE_BYTES) continue
              if (
                !refresh &&
                Object.values(stored.tracks).some(
                  (track) =>
                    track.context === key &&
                    track.origin === 'quark' &&
                    track.label === String(file.name).split(/[\\/]/).at(-1),
                )
              )
                continue
              try {
                await add(
                  media,
                  episode,
                  await remote(await quark.subtitleSource(media, file)),
                  file.name,
                  'quark',
                  '夸克网盘',
                )
              } catch {
                failed++
              }
            }
          } catch {
            failed++
          }
        }
        const result = view(key)
        result.message = result.tracks.length
          ? '已自动加载匹配的外挂字幕'
          : failed
            ? '未能读取匹配字幕，正在尝试在线搜索'
            : '未发现同目录外挂字幕，正在尝试在线搜索'
        return result
      })().finally(() => pending.delete(key))
      pending.set(key, operation)
      return operation
    },
    async search(media, episode, force = false) {
      const key = context(media, episode),
        target = subtitleQuery(media, episode),
        now = Date.now()
      const previous = searched.get(key)
      if (!force && previous && now - previous.at < 10 * 60000)
        return view(key, previous.message, target.query)
      if (pending.has('online:' + key)) return pending.get('online:' + key)
      const operation = (async () => {
        let message = '',
          rows = []
        try {
          const response = await fetcher(
            'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' +
              encodeURIComponent(target.query),
            {
              redirect: 'error',
              signal: AbortSignal.timeout(15000),
              headers: {
                Accept: 'application/json',
                'User-Agent': 'Yingyu/1.3',
              },
            },
          )
          const json = JSON.parse(
            (await limitedBody(response, 2 * 1024 * 1024)).toString('utf8'),
          )
          if (json.code !== 0 || !Array.isArray(json.data))
            throw new Error('字幕来源暂时不可用')
          rows = rankOnlineSubtitles(json.data, target)
          let downloaded = 0
          for (const row of rows
            .filter((row) => row.language.startsWith('zh'))
            .slice(0, 3)) {
            try {
              const u = new URL(row.url)
              // This provider's public text-subtitle CDN only. No user-supplied
              // URL, redirects, cookies, filenames or video fingerprint leave here.
              if (
                u.protocol !== 'https:' ||
                u.hostname !== 'subtitle.v.geilijiasu.com' ||
                u.port ||
                u.username ||
                u.password
              )
                continue
              const bytes = await limitedBody(
                await fetcher(u.href, {
                  redirect: 'error',
                  signal: AbortSignal.timeout(15000),
                }),
              )
              await add(
                media,
                episode,
                bytes,
                row.name || `中文字幕.${row.ext}`,
                'online',
                '迅雷字幕',
                row.language,
              )
              if (++downloaded >= 2) break
            } catch {}
          }
          message = downloaded
            ? '已搜索并加载中文字幕，请核对时间轴'
            : rows.length
              ? '找到相关条目，但未取得可用的中文字幕'
              : '暂未找到片名、季数和集数均匹配的中文字幕'
        } catch {
          message = '在线字幕来源暂时不可用，可重试或手动载入字幕'
        }
        searched.set(key, { at: now, message })
        return view(key, message, target.query)
      })().finally(() => pending.delete('online:' + key))
      pending.set('online:' + key, operation)
      return operation
    },
    async upload(media, episode, name, content) {
      if (
        typeof name !== 'string' ||
        !isSubtitle(name) ||
        typeof content !== 'string' ||
        content.length > MAX_SUBTITLE_BYTES * 1.4
      )
        throw new Error('请选择不超过 6 MB 的 SRT、ASS、SSA 或 VTT 字幕')
      const id = await add(
        media,
        episode,
        Buffer.from(content, 'base64'),
        name,
        'manual',
      )
      const key = context(media, episode)
      stored.preferences[key] = { ...stored.preferences[key], selected: id }
      await save()
      return view(key, '字幕已载入并保存在幻屿缓存中')
    },
    async preference(media, episode, input) {
      const key = context(media, episode),
        pref = stored.preferences[key] || {}
      if (input.selected !== undefined) {
        if (
          input.selected !== 'off' &&
          stored.tracks[input.selected]?.context !== key
        )
          throw new Error('请选择当前分集的字幕')
        pref.selected = input.selected
      }
      if (input.delay !== undefined) {
        if (!Number.isFinite(input.delay) || Math.abs(input.delay) > 120)
          throw new Error('字幕偏移应在前后 120 秒以内')
        pref.delay = input.delay
      }
      stored.preferences[key] = pref
      await save()
      return view(key)
    },
    file(id) {
      return /^[a-f0-9]{32}$/.test(id) && stored.tracks[id]
        ? path.join(directory, id + '.vtt')
        : null
    },
  }
}
