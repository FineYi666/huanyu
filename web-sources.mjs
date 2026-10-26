import { createHash } from 'node:crypto'

// 苹果 CMS 采集站聚合：JSON API 直接返回每集 m3u8，无需解析网页。
const SOURCES = [
  { id: 'bf', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod' },
  { id: 'lz', name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod' },
  { id: 'ff', name: '非凡资源', api: 'https://api.ffzyonline.com/api.php/provide/vod' },
  { id: 'zy360', name: '360资源', api: 'https://360zy5.com/api.php/provide/vod' },
]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Yingyu/1.3'
const REQUEST_TIMEOUT = 12000

function pickM3u8Group(vod) {
  const from = String(vod.vod_play_from || '').split('$$$')
  const groups = String(vod.vod_play_url || '').split('$$$')
  // 组名带 m3u8 的是直链播放组，优先；否则取第一组。
  let index = from.findIndex((name) => name.toLowerCase().includes('m3u8'))
  if (index < 0) index = 0
  const episodes = (groups[index] || '')
    .split('#')
    .map((entry) => {
      const separator = entry.indexOf('$')
      if (separator < 0) return null
      const title = entry.slice(0, separator).trim()
      const url = entry.slice(separator + 1).trim()
      if (!/^https?:\/\//.test(url)) return null
      return { title, url }
    })
    .filter(Boolean)
  if (!episodes.length && index !== 0) {
    // 首选组无效时尝试其余组
    for (let i = 0; i < groups.length && i < from.length; i++) {
      if (i === index) continue
      const fallback = (groups[i] || '')
        .split('#')
        .map((entry) => {
          const separator = entry.indexOf('$')
          if (separator < 0) return null
          const title = entry.slice(0, separator).trim()
          const url = entry.slice(separator + 1).trim()
          return /^https?:\/\//.test(url) ? { title, url } : null
        })
        .filter(Boolean)
      if (fallback.length) return fallback
    }
  }
  return episodes
}

export function createWebSources({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map()
  const CACHE_TTL = 30 * 60000

  async function requestApi(api, params) {
    const url = `${api}?ac=detail&wd=${encodeURIComponent(params.keyword)}`
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  // 聚合搜索：并发各采集站，结果带来源与每集 m3u8。
  async function search(keyword) {
    const clean = String(keyword || '').trim().slice(0, 80)
    if (clean.length < 2) return { results: [] }
    const key = createHash('sha256')
      .update(`web-sources:${clean.toLowerCase()}`)
      .digest('hex')
      .slice(0, 24)
    const cached = cache.get(key)
    if (cached && now() - cached.at < CACHE_TTL) return cached.value
    const settled = await Promise.allSettled(
      SOURCES.map(async (source) => {
        const data = await requestApi(source.api, { keyword: clean })
        return (data.list || []).map((vod) => {
          const episodes = pickM3u8Group(vod)
          return {
            id: `web-${source.id}-${vod.vod_id}`,
            sourceId: source.id,
            sourceName: source.name,
            title: String(vod.vod_name || '').trim(),
            cover: String(vod.vod_pic || ''),
            year: String(vod.vod_year || ''),
            remarks: String(vod.vod_remarks || ''),
            episodes,
          }
        })
      }),
    )
    const results = settled
      .filter((entry) => entry.status === 'fulfilled')
      .flatMap((entry) => entry.value)
      .filter((item) => item.title && item.episodes.length)
    const value = { results, searchedAt: new Date(now()).toISOString() }
    if (results.length) {
      if (cache.size >= 60) cache.delete(cache.keys().next().value)
      cache.set(key, { at: now(), value })
    }
    return value
  }

  // 换源：同标题跨采集站再搜一轮，返回其它源的片单。
  async function alternate(keyword, excludeSourceId) {
    const value = await search(keyword)
    return {
      results: (value.results || []).filter(
        (item) => item.sourceId !== excludeSourceId,
      ),
    }
  }

  return { search, alternate }
}
