import { createHash } from 'node:crypto'
import { parseQuarkShare } from './media-utils.mjs'

const BASE = 'https://www.pansearch.me'
const normalized = (value) =>
  textOnly(value)
    .replace(/1\/2|½|二分之一/g, '半')
    .replace(/第[一二三四五六七八九十百0-9]+[季期部]/g, '')
    .replace(/season\s*\d+/gi, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()
const textOnly = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
export function extractQuarkResults(rows, sourceUrl) {
  const results = new Map()
  for (const row of rows) {
    const content = String(row.content || '').replace(/&amp;/g, '&')
    const plain = textOnly(content)
    const links =
      content.match(
        /https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:\?[^\s"'<>]*)?/g,
      ) || []
    for (const link of links) {
      try {
        const beforeLink = textOnly(
          content.slice(0, content.indexOf(link)).replace(/<[^>]*$/, ''),
        )
        const nearestTitle = [
          ...beforeLink.matchAll(
            /(?:^|\n)(?:名称[:：]\s*|\d+[、.．]\s*)([^\n]+)/g,
          ),
        ]
          .at(-1)?.[1]
          ?.replace(/https?:\/\/\S+.*/, '')
          .replace(/[:：]\s*$/, '')
          .trim()
        const parsed = parseQuarkShare(
          link,
          plain.match(
            /(?:提取码|访问码|密码)\s*[:：=]?\s*([a-zA-Z0-9]{4,8})/,
          )?.[1] || '',
        )
        if (results.has(parsed.shareId)) continue
        results.set(parsed.shareId, {
          id: createHash('sha256')
            .update(parsed.shareId)
            .digest('hex')
            .slice(0, 16),
          title:
            textOnly(row.title).slice(0, 180) ||
            nearestTitle ||
            plain
              .split('\n')
              .find((line) => line.trim())
              ?.replace(/^名称[:：]\s*/, '')
              .slice(0, 180) ||
            '夸克视频资源',
          description: plain.slice(0, 850),
          url: parsed.shareUrl,
          code: row.code || parsed.passcode,
          source: row.source || 'PanSearch',
          sourceUrl: row.sourceUrl || sourceUrl,
          updatedAt: row.time || null,
        })
      } catch {}
    }
  }
  return [...results.values()].slice(0, 24)
}

export function resourceQueries(query, aliases = []) {
  const values = [query, ...aliases].filter(
    (value) =>
      typeof value === 'string' &&
      value.trim().length >= 2 &&
      value.length <= 150,
  )
  const clean = (value) =>
    value
      .replace(
        /第[一二三四五六七八九十百0-9]+[季期部]|第[一二三四五六七八九十百0-9]+(?:部分|クール)|season\s*\d+|\bS\d{1,2}\b/gi,
        '',
      )
      .replace(/\s*\(\d{4}\)\s*/g, '')
      .trim()
  const names = values.flatMap((value) => {
    const base = clean(value)
    const short = base.split(/[:：]|[，,。！!]|转生为|轉生為/)[0].trim()
    return [
      base,
      ...(short.length >= 4 && short !== base ? [short] : []),
      ...(base.length > 18 && /^[\u4e00-\u9fff]/.test(base)
        ? [base.slice(0, 8)]
        : []),
    ]
  })
  return [...new Set(names.filter((name) => name.length >= 2))].slice(0, 4)
}

const chineseNumber = (value) => {
  if (/^\d+$/.test(value)) return Number(value)
  const digits = '零一二三四五六七八九'
  if (value === '十') return 10
  if (value.includes('十')) {
    const [a, b] = value.split('十')
    return (a ? digits.indexOf(a) : 1) * 10 + (b ? digits.indexOf(b) : 0)
  }
  return digits.indexOf(value)
}
export function resourceSeasonMatch(title, target) {
  const seasons = (text) =>
    [
      ...String(text).matchAll(
        /第([一二三四五六七八九十0-9]+)[季期]|\b(?:season\s*|S)(\d{1,2})\b/gi,
      ),
    ].map((m) => chineseNumber(m[1] || m[2]))
  const wanted = seasons(target)[0]
  const found = seasons(title)
  return wanted && found.length
    ? found.includes(wanted)
      ? 'season'
      : 'other-season'
    : 'related'
}

export function createResourceSearch({
  fetcher = fetch,
  now = Date.now,
  renderSearch,
} = {}) {
  const cache = new Map(),
    pending = new Map()
  async function request(url) {
    const response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(14000),
      headers: {
        'User-Agent': 'Yingyu/1.3 (personal library)',
        Accept: 'text/html,application/json',
      },
    })
    if (!response.ok) throw new Error('来源暂时不可用')
    const reader = response.body.getReader(),
      chunks = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('来源数据过大')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  async function pansearch(keyword) {
    const sourceUrl = `${BASE}/search?keyword=${encodeURIComponent(keyword)}`
    const html = await request(sourceUrl)
    const match = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    )
    if (!match) throw new Error('搜索页面结构已更新')
    const page = JSON.parse(match[1]),
      rows = [...(page.props?.pageProps?.data?.data || [])]
    if (
      extractQuarkResults(rows, sourceUrl).length < 4 &&
      /^[\w-]+$/.test(page.buildId || '')
    ) {
      const total = page.props?.pageProps?.data?.total || 0,
        limit = page.props?.pageProps?.limit || 10
      const more = await Promise.allSettled(
        [limit, limit * 2]
          .filter((offset) => offset < total)
          .map(async (offset) => {
            const next = JSON.parse(
              await request(
                `${BASE}/_next/data/${page.buildId}/search.json?keyword=${encodeURIComponent(keyword)}&offset=${offset}`,
              ),
            )
            return next.pageProps?.data?.data || []
          }),
      )
      for (const result of more)
        if (result.status === 'fulfilled') rows.push(...result.value)
    }
    return extractQuarkResults(rows, sourceUrl)
  }
  async function pansou(keyword) {
    const sourceUrl = `https://pansou.app/?q=${encodeURIComponent(keyword)}`
    const page = JSON.parse(
      await request(
        `https://pansou.app/api/search?kw=${encodeURIComponent(keyword)}&cloud_types=quark&res=merged_by_type`,
      ),
    )
    if (page.code !== 0 || !page.data) throw new Error('来源暂时不可用')
    return extractQuarkResults(
      (page.data.merged_by_type?.quark || []).map((row) => ({
        title: row.note,
        content: `${row.note || ''}\n${row.url || ''}`,
        code: row.password || '',
        time: row.datetime,
        source: 'PanSou',
      })),
      sourceUrl,
    )
  }
  return {
    async search(keyword, aliases = []) {
      const query = typeof keyword === 'string' ? keyword.trim() : ''
      if (query.length < 2 || query.length > 150)
        throw new Error('请输入 2 到 150 字的作品名称')
      const queries = resourceQueries(
        query,
        Array.isArray(aliases) ? aliases.slice(0, 3) : [],
      )
      const key = JSON.stringify([query, queries])
      const previous = cache.get(key)
      if (
        previous &&
        now() - previous.at < (previous.value.results.length ? 10 : 1) * 60000
      )
        return previous.value
      if (pending.has(key)) return pending.get(key)
      const operation = (async () => {
        const sources = [],
          all = []
        const collect = async (search) => {
          const values = await Promise.allSettled(
            queries.slice(0, 2).map(search),
          )
          const okay = values.filter((value) => value.status === 'fulfilled')
          if (!okay.length) throw new Error('来源暂时不可用，请在来源网站重试')
          return okay.flatMap((value) => value.value)
        }
        // 夸克盘搜依赖 Electron 渲染网页（最慢的源），与其余快速源分层处理：
        // 快速源先到先得立即返回，慢源在后台补全结果并写入缓存供下次使用。
        const slowProvider = {
          name: '夸克盘搜',
          url: `https://www.zhongchuangwl.com/s/${encodeURIComponent(queries[0])}/`,
          async run() {
            if (!renderSearch) throw new Error('请在桌面版或来源网站中查找')
            const value = await renderSearch(queries.slice(0, 2))
            if (value.error && !value.rows.length)
              throw new Error(value.error)
            return extractQuarkResults(
              value.rows.map((row) => ({
                ...row,
                content: `${row.description || row.title}\n${row.url}`,
                source: '夸克盘搜',
              })),
              this.url,
            )
          },
        }
        const fastProviders = [
          {
            name: 'PanSearch',
            url: `${BASE}/search?keyword=${encodeURIComponent(queries[0])}`,
            run: () => collect(pansearch),
          },
          {
            name: 'PanSou',
            url: `https://pansou.app/?q=${encodeURIComponent(queries[0])}`,
            run: () => collect(pansou),
          },
        ]
        const providers = [slowProvider, ...fastProviders]
        const collectInto = async (provider, sink) => {
          try {
            const values = await provider.run()
            sink.push(...values)
            sources.push({
              name: provider.name,
              url: provider.url,
              status: 'ok',
              count: values.length,
            })
          } catch (error) {
            sources.push({
              name: provider.name,
              url: provider.url,
              status: 'error',
              count: 0,
              message: String(error.message).slice(0, 120),
            })
          }
        }
        const slowCollector = (async () => {
          for (const provider of [slowProvider]) await collectInto(provider, all)
        })().catch(() => {})
        await Promise.allSettled(
          fastProviders.map((provider) => collectInto(provider, all)),
        )
        const buildValue = (items, providerList) => {
          const unique = new Map()
          for (const item of items) {
            if (
              !queries.some((name) =>
                normalized(item.title).includes(normalized(name)),
              )
            )
              continue
            const match = resourceSeasonMatch(item.title, query)
            const existing = unique.get(item.id)
            if (existing) {
              existing.sources = [...new Set([...existing.sources, item.source])]
              if (!existing.code && item.code) existing.code = item.code
              continue
            }
            unique.set(item.id, { ...item, sources: [item.source], match })
          }
          const rank = { season: 0, related: 1, 'other-season': 2 }
          const results = [...unique.values()]
            .sort(
              (a, b) =>
                rank[a.match] - rank[b.match] ||
                String(b.updatedAt || '').localeCompare(
                  String(a.updatedAt || ''),
                ),
            )
            .slice(0, 40)
          return {
            query,
            queries,
            source: '多源搜索',
            sourceUrl: providers[0].url,
            sources: providerList
              .map((p) => {
                const found = sources.find((s) => s.name === p.name)
                return found || null
              })
              .filter(Boolean),
            results,
            searchedAt: new Date(now()).toISOString(),
          }
        }
        let value = buildValue(all, providers)
        if (!value.results.length) {
          // 快速源颗粒无收，等待慢源（Electron 渲染搜索）补全。
          await slowCollector
          value = buildValue(all, providers)
        } else {
          // 快速源已有结果立即返回；慢源完成后把结果并入缓存供下次使用。
          void slowCollector.then(() => {
            if (!all.length) return
            const refreshed = buildValue(all, providers)
            if (!refreshed.results.length) return
            if (cache.size >= 80) cache.delete(cache.keys().next().value)
            cache.set(key, { at: now(), value: refreshed })
          })
        }
        if (cache.size >= 80) cache.delete(cache.keys().next().value)
        cache.set(key, { at: now(), value })
        return value
      })().finally(() => pending.delete(key))
      pending.set(key, operation)
      return operation
    },
    // 游戏资源搜索：通用网盘/磁力链接聚合（复用 PanSou 与 PanSearch）。
    async searchGames(keyword) {
      const clean = String(keyword || '').trim().slice(0, 80)
      if (clean.length < 2) throw new Error('请输入 2 个字以上的游戏名称')
      const key = 'games:' + clean.toLowerCase()
      const previous = cache.get(key)
      if (previous && now() - previous.at < 30 * 60000) return previous.value
      if (pending.has(key)) return pending.get(key)
      const operation = (async () => {
        const rows = []
        const collectInto = async (provider) => {
          try {
            rows.push(...(await provider(clean)))
          } catch {}
        }
        await Promise.allSettled([
          collectInto(async () => {
            const sourceUrl = `https://pansou.app/?q=${encodeURIComponent(clean)}`
            const page = JSON.parse(
              await request(
                `https://pansou.app/api/search?kw=${encodeURIComponent(clean)}&res=merged_by_type`,
              ),
            )
            if (page.code !== 0 || !page.data)
              throw new Error('来源暂时不可用')
            const merged = page.data.merged_by_type || {}
            const flattened = []
            for (const [type, entries] of Object.entries(merged)) {
              for (const row of entries || [])
                flattened.push({
                  title: row.note,
                  content: `${row.note || ''}
${row.url || ''}`,
                  code: row.password || '',
                  time: row.datetime,
                  source: `PanSou·${type}`,
                })
            }
            return flattened
          }),
          collectInto(async () => {
            const sourceUrl = `${BASE}/search?keyword=${encodeURIComponent(clean)}`
            const html = await request(sourceUrl)
            const match = html.match(
              /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
            )
            if (!match) throw new Error('搜索页面结构已更新')
            const page = JSON.parse(match[1])
            return [...(page.props?.pageProps?.data?.data || [])].map(
              (row) => ({
                title: '',
                content: `${row.description || row.title || ''}
${row.url || ''}`,
                code: row.password || '',
                time: row.datetime || row.time,
                source: 'PanSearch',
              }),
            )
          }),
        ])
        const linkTypes = [
          ['夸克网盘', /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/g],
          ['百度网盘', /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+/g],
          ['磁力链接', /magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}/g],
          ['123云盘', /https?:\/\/(?:www\.)?123(?:684|912)?pan\.com\/s\/[a-zA-Z0-9_-]+/g],
          ['阿里云盘', /https?:\/\/(?:www\.)?(?:alipan|aliyundrive)\.com\/s\/[a-zA-Z0-9]+/g],
          ['天翼云盘', /https?:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+/g],
          ['移动云盘', /https?:\/\/caiyun\.139\.com\/m\/i\?[a-zA-Z0-9]+/g],
        ]
        const results = []
        const seenLinks = new Set()
        for (const row of rows) {
          const content = String(row.content || '')
          const links = []
          for (const [type, pattern] of linkTypes) {
            for (const match of content.matchAll(pattern)) {
              if (seenLinks.has(match[0])) continue
              seenLinks.add(match[0])
              links.push({ type, url: match[0] })
            }
          }
          if (!links.length) continue
          const beforeLink = content
            .slice(0, Math.max(0, content.indexOf(links[0].url)))
            .replace(/<[^>]*$/g, '')
          const titleMatch = [
            ...beforeLink.matchAll(
              /(?:^|\n)(?:名称[:：]\s*|\d+[、.．]\s*)([^\n]+)/g,
            ),
          ].at(-1)?.[1]
          const title = (titleMatch || row.title || clean).trim().slice(0, 100)
          results.push({
            id: createHash('sha256')
              .update(links[0].url)
              .digest('hex')
              .slice(0, 20),
            title,
            links,
            code: row.code || '',
            date: row.time || '',
            source: row.source || '',
          })
        }
        const value = {
          query: clean,
          results: results.slice(0, 30),
          searchedAt: new Date(now()).toISOString(),
        }
        if (value.results.length) {
          if (cache.size >= 80) cache.delete(cache.keys().next().value)
          cache.set(key, { at: now(), value })
        }
        return value
      })().finally(() => pending.delete(key))
      pending.set(key, operation)
      return operation
    },
  }
}
