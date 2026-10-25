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
        const providers = [
          {
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
          },
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
        async function collect(search) {
          const values = await Promise.allSettled(
            queries.slice(0, 2).map(search),
          )
          const okay = values.filter((value) => value.status === 'fulfilled')
          if (!okay.length) throw new Error('来源暂时不可用，请在来源网站重试')
          return okay.flatMap((value) => value.value)
        }
        await Promise.all(
          providers.map(async (provider) => {
            try {
              const values = await provider.run()
              all.push(...values)
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
          }),
        )
        const unique = new Map()
        for (const item of all) {
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
        const value = {
          query,
          queries,
          source: '多源搜索',
          sourceUrl: providers[0].url,
          sources: providers.map((p) => sources.find((s) => s.name === p.name)),
          results,
          searchedAt: new Date(now()).toISOString(),
        }
        if (cache.size >= 80) cache.delete(cache.keys().next().value)
        cache.set(key, { at: now(), value })
        return value
      })().finally(() => pending.delete(key))
      pending.set(key, operation)
      return operation
    },
  }
}
