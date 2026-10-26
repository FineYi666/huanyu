import { createHash } from 'node:crypto'

export const GAME_RESOURCE_SITES = [
  { id: 'cheese', name: '芝士游戏', origin: 'https://www.cheesegame.org' },
  { id: 'gameshare', name: 'Game Share', origin: 'https://www.gameshare.cc' },
]
const UA = 'Huanyu/1.3 (personal game library)'
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
function plain(value) {
  return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : '')
    .replace(/\s+/g, ' ').trim()
}
function articleUrl(value, site) {
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), site.origin)
    const origin = new URL(site.origin)
    if (url.protocol !== 'https:' || url.hostname !== origin.hostname || url.port || url.username || url.password) return null
    const valid = site.id === 'cheese' ? /^\/\d+\.html$/.test(url.pathname) : /^\/posts\/\d+$/.test(url.pathname)
    return valid && !url.search ? url.origin + url.pathname : null
  } catch { return null }
}
export function parseGameSearch(html, site, query) {
  const candidates = []
  const blocks = site.id === 'cheese'
    ? [...html.matchAll(/<h2\b[^>]*class=["'][^"']*item-heading[^"']*["'][^>]*>([\s\S]*?)<\/h2>/gi)].map((match) => match[1])
    : [...html.matchAll(/<a\b[^>]*href=["'][^"']*\/posts\/\d+["'][^>]*>[\s\S]*?<\/a>/gi)].map((match) => match[0])
  for (const block of blocks) {
    const href = /href=["']([^"']+)["']/i.exec(block)?.[1]
    const url = href && articleUrl(href, site)
    const heading = site.id === 'cheese'
      ? block.replace(/<span\b[^>]*class=["'][^"']*aidoc-cover[^"']*["'][\s\S]*$/i, '')
      : /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(block)?.[1]
    const title = plain(heading)
    if (!url || !title || !normalize(title).includes(normalize(query))) continue
    if (/(?:电影|电视剧|影视|蓝光|2160p|1080p|BDRip|WEB-DL)/i.test(title)) continue
    if (site.id === 'cheese' && !/\[(?:PC|SWITCH|NS|PS\d|安卓|Android|手机)\]/i.test(title)) continue
    candidates.push({ title, url })
  }
  return [...new Map(candidates.map((item) => [item.url, item])).values()]
}

export function createGameResourceSearch({ fetcher = fetch, now = Date.now } = {}) {
  const pending = new Map()
  async function request(url, site) {
    // Never follow a site redirect to another provider or a network drive.
    for (let redirects = 0; redirects < 4; redirects++) {
      if (new URL(url).origin !== site.origin) throw new Error('来源跳转到了其他网站')
      const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA, Accept: 'text/html' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => {})
        if (!location) throw new Error('来源跳转无效')
        url = new URL(location, url).href
        continue
      }
      if (!response.ok) throw new Error(`来源页面无法访问（${response.status}）`)
      return { html: await response.text(), url }
    }
    throw new Error('来源跳转次数过多')
  }
  async function search(query) {
    const keyword = String(query || '').trim().slice(0, 80)
    if (normalize(keyword).length < 2) throw Object.assign(new Error('请输入 2 个字以上的游戏名称'), { status: 400 })
    const key = normalize(keyword)
    if (pending.has(key)) return pending.get(key)
    const operation = Promise.all(GAME_RESOURCE_SITES.map(async (site) => {
      const searchUrl = `${site.origin}${site.id === 'cheese' ? '/?s=' : '/search?q='}${encodeURIComponent(keyword)}`
      try {
        const { html } = await request(searchUrl, site)
        const candidates = parseGameSearch(html, site, keyword).slice(0, 12)
        const results = []
        let cursor = 0
        await Promise.all(Array.from({ length: 4 }, async () => {
          while (cursor < candidates.length) {
            const candidate = candidates[cursor++]
            try {
              const page = await request(candidate.url, site)
              if (!articleUrl(page.url, site)) continue
              const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page.html)?.[1]
              const title = plain(heading)
              if (!title || !normalize(title).includes(key) || /电影|电视剧|资源已删除|资源已下架|404|页面不存在|验证|captcha/i.test(title)) continue
              const article = page.html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || page.html
              if (/资源(?:已失效|已下架|已删除)|分享(?:已取消|已失效)/.test(plain(article).slice(0, 18000))) continue
              results.push({ id: createHash('sha256').update(page.url).digest('hex').slice(0, 20), title: candidate.title,
                source: site.name, sourceUrl: page.url, links: [{ type: '查看资源', url: page.url }],
                code: '', date: '', checkedAt: new Date(now()).toISOString() })
            } catch { /* Unreachable, deleted, and unverified pages are omitted. */ }
          }
        }))
        results.sort((a, b) => candidates.findIndex((item) => item.url === a.sourceUrl) - candidates.findIndex((item) => item.url === b.sourceUrl))
        return { results, source: { name: site.name, url: searchUrl, status: 'ok', count: results.length } }
      } catch {
        return { results: [], source: { name: site.name, url: searchUrl, status: 'error', count: 0, message: '暂时无法连接来源网站' } }
      }
    })).then((values) => ({ query: keyword, results: values.flatMap((value) => value.results), sources: values.map((value) => value.source), searchedAt: new Date(now()).toISOString() }))
      .finally(() => pending.delete(key))
    pending.set(key, operation)
    return operation
  }
  return { search }
}
