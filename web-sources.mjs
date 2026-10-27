import { createHash } from 'node:crypto'
import { matchesWork } from './media-match.mjs'
import { seasonNumber } from './episode-seasons.mjs'
import { probeStream, publicVideoUrl } from './stream-probe.mjs'
// Search -> selected work -> playback roads follows Kazumi's documented rule flow.
// giriGiriLove endpoints/field mappings: Predidit/KazumiRules (MIT), see licenses.
const SOURCES = [
  {
    id: 'giri',
    name: 'giriGiriLove · 动漫',
    api: 'https://m3u8.girigirilove.com/api.php/Vod/',
    anime: true,
  },
  {
    id: 'bf',
    name: '暴风资源',
    api: 'https://bfzyapi.com/api.php/provide/vod',
  },
  {
    id: 'lz',
    name: '量子资源',
    api: 'https://cj.lziapi.com/api.php/provide/vod',
  },
  {
    id: 'ff',
    name: '非凡资源',
    api: 'https://api.ffzyonline.com/api.php/provide/vod',
  },
  {
    id: 'zy360',
    name: '360资源',
    api: 'https://360zy5.com/api.php/provide/vod',
  },
]
const idFor = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24)
async function mapLimit(items, limit, task) {
  let index = 0
  const output = []
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const i = index++
        output[i] = await task(items[i], i)
      }
    }),
  )
  return output
}
export function parsePlayRoads(vod) {
  const names = String(vod.vod_play_from || '').split('$$$')
  return String(vod.vod_play_url || '')
    .split('$$$')
    .flatMap((group, index) => {
      const episodes = group.split('#').flatMap((entry) => {
        const split = entry.indexOf('$')
        if (split < 0) return []
        try {
          const url = publicVideoUrl(entry.slice(split + 1).trim())
          if (!/\.(?:m3u8|mp4|webm)(?:$|\?)/i.test(url)) return []
          return [
            {
              id: idFor(url),
              originalTitle: entry.slice(0, split).trim(),
              url,
            },
          ]
        } catch {
          return []
        }
      })
      if (!episodes.length) return []
      const season = seasonNumber(vod.vod_name)
      return [
        {
          name:
            { chs: '简体字幕', cht: '繁体字幕' }[names[index]] ||
            names[index] ||
            `线路 ${index + 1}`,
          episodes: episodes.map((episode, i) => ({
            ...episode,
            title: `第${i + 1}集`,
            season,
            number: i + 1,
          })),
        },
      ]
    })
    .sort(
      (a, b) => Number(b.name === '简体字幕') - Number(a.name === '简体字幕'),
    )
}
export function createWebSources({
  fetcher = fetch,
  now = Date.now,
  providers = SOURCES,
  probe = probeStream,
} = {}) {
  const records = new Map(),
    pending = new Map(),
    failed = new Map()
  async function api(url, signal) {
    const r = await fetcher(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 Huanyu/1.3',
        Accept: 'application/json',
      },
    })
    if (!r.ok) throw new Error('来源不可用')
    return r.json()
  }
  function publicItem(item) {
    return {
      ...item,
      headers: undefined,
      episodes: item.episodes
        .filter((ep) => (failed.get(`${item.id}/${ep.id}`) || 0) < now())
        .map(({ url, ...episode }) => episode),
    }
  }
  async function search(keyword, options = {}) {
    const query = String(keyword || '')
      .trim()
      .slice(0, 80)
    if (query.length < 2) return { results: [], sources: [] }
    const aliases = (options.aliases || [])
        .filter((x) => typeof x === 'string' && x.trim())
        .slice(0, 2),
      key = JSON.stringify([query, aliases, options.category])
    if (pending.has(key)) return pending.get(key)
    const operation = (async () => {
      const statuses = await Promise.all(
        providers
          .filter((source) => !source.anime || options.category !== 'movie')
          .map(async (source) => {
            const found = [],
              deadline = AbortSignal.timeout(20000)
            const boundedFetch = (url, options = {}) =>
              fetcher(url, {
                ...options,
                signal: options.signal
                  ? AbortSignal.any([deadline, options.signal])
                  : deadline,
              })
            try {
              for (const term of [...new Set([query, ...aliases])].slice(
                0,
                2,
              )) {
                const data = await api(
                  source.anime
                    ? `${source.api}get_list?vod_name=${encodeURIComponent(term)}&offset=0&limit=20`
                    : `${source.api}?ac=detail&wd=${encodeURIComponent(term)}`,
                  deadline,
                )
                const candidates =
                    (source.anime ? data.info?.rows : data.list) || [],
                  matched = candidates
                    .filter((vod) =>
                      matchesWork(vod, query, {
                        aliases,
                        category: options.category,
                      }),
                    )
                    .slice(0, 4)
                await mapLimit(matched, 3, async (vod) => {
                  try {
                    const detail = source.anime
                      ? (
                          await api(
                            `${source.api}get_detail?vod_id=${encodeURIComponent(vod.vod_id)}`,
                            deadline,
                          )
                        ).info
                      : vod
                    if (
                      !detail ||
                      !matchesWork(detail, query, {
                        aliases,
                        category: options.category,
                      })
                    )
                      return
                    for (const road of parsePlayRoads(detail).slice(0, 3)) {
                      const item = {
                        id: `web-${source.id}-${vod.vod_id}-${idFor(road.name)}`,
                        sourceId: source.id,
                        sourceName: source.name,
                        road: road.name,
                        title: String(detail.vod_name).trim(),
                        cover: String(detail.vod_pic || vod.vod_pic || ''),
                        year: String(detail.vod_year || vod.vod_year || ''),
                        remarks: String(detail.vod_remarks || ''),
                        episodes: road.episodes,
                        headers: {},
                        checkedAt: null,
                        checkedEpisode: null,
                      }
                      let verified = false
                      for (const episode of item.episodes.slice(0, 2)) {
                        if (deadline.aborted) break
                        if (
                          (failed.get(`${item.id}/${episode.id}`) || 0) > now()
                        )
                          continue
                        try {
                          await probe(
                            { url: episode.url, headers: item.headers },
                            { fetcher: boundedFetch },
                          )
                          item.checkedAt = new Date(now()).toISOString()
                          item.checkedEpisode = episode.id
                          verified = true
                          break
                        } catch {
                          failed.set(`${item.id}/${episode.id}`, now() + 120000)
                        }
                      }
                      if (verified) {
                        records.set(item.id, {
                          item,
                          expires: now() + 30 * 60000,
                        })
                        found.push(item)
                      }
                    }
                  } catch {}
                })
                if (found.length) break
              }
              return {
                name: source.name,
                status: 'ok',
                count: found.length,
                results: found,
              }
            } catch {
              return {
                name: source.name,
                status: 'error',
                count: 0,
                results: [],
              }
            }
          }),
      )
      for (const [id, entry] of records)
        if (entry.expires < now()) records.delete(id)
      while (records.size > 300) records.delete(records.keys().next().value)
      for (const [key, expires] of failed)
        if (expires < now()) failed.delete(key)
      const results = [
        ...new Map(
          statuses
            .flatMap((source) => source.results)
            .map((item) => [item.id, publicItem(item)]),
        ).values(),
      ].filter((item) => item.episodes.length)
      return {
        results,
        sources: statuses.map(({ results, ...source }) => source),
        searchedAt: new Date(now()).toISOString(),
      }
    })().finally(() => pending.delete(key))
    pending.set(key, operation)
    return operation
  }
  async function resolve(resultId, episodeId) {
    const record = records.get(resultId),
      episode = record?.item.episodes.find((ep) => ep.id === episodeId)
    if (!episode || record.expires < now())
      throw new Error('片源记录已过期，请重新搜索')
    const source = { url: episode.url, headers: record.item.headers, web: true }
    try {
      const verified = await probe(source, { fetcher })
      return { ...source, ...verified }
    } catch (error) {
      failed.set(`${resultId}/${episodeId}`, now() + 120000)
      throw error
    }
  }
  function report(resultId, episodeId) {
    if (records.get(resultId)?.item.episodes.some((ep) => ep.id === episodeId))
      failed.set(`${resultId}/${episodeId}`, now() + 120000)
  }
  return {
    search,
    resolve,
    report,
    alternate: async (keyword, excludeSourceId, options) => {
      const value = await search(keyword, options)
      return {
        ...value,
        results: value.results.filter(
          (item) => item.sourceId !== excludeSourceId,
        ),
      }
    },
  }
}
