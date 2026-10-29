import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises'
import { downloadPoster } from './metadata.mjs'

// Brief Chinese summaries adapted from the linked subject's public synopsis.
const BRIEFS = {
  623249:
    '熟悉的热血冒险，全新的银幕表达。通过新增镜头、重绘画面与故事重构，再次走进《龙珠超》的世界。',
  637802:
    '一碰冷水就变成女孩的乱马，与未婚妻小茜的日常继续。格斗、误会与心动，交织成热热闹闹的青春喜剧。',
  568244:
    '猫猫重回花街药师的生活，一次日常饭食却引出新的疑点。宫廷里的灾厄预兆与神秘传闻，也让壬氏再次陷入难题。',
  555605:
    '青井苇人终于晋升青年队 A 队，却迎来更高强度的挑战。速度、技术与想象力，都将在新的赛场上重新接受考验。',
  537738:
    '学园都市的平静背后，四名能力者少女组成了暗部组织「道具」。第五名少女的出现，将她们的日常与羁绊引向更深的黑暗。',
}

const seasonFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function buildSeason(year, quarter, today) {
  return {
    id: `${year}-Q${quarter + 1}`,
    year,
    month: quarter * 3 + 1,
    monthLabel: `${year}年${quarter * 3 + 1}月新番`,
    label: `${year} ${['冬', '春', '夏', '秋'][quarter]}季`,
    start: `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-01`,
    end:
      quarter === 3
        ? `${year + 1}-01-01`
        : `${year}-${String(quarter * 3 + 4).padStart(2, '0')}-01`,
    today,
  }
}

export function seasonAt(now = new Date()) {
  const today = seasonFormatter.format(now)
  return buildSeason(
    Number(today.slice(0, 4)),
    Math.floor((Number(today.slice(5, 7)) - 1) / 3),
    today,
  )
}

// Rebuild any archived quarter (e.g. 2025-Q4) with the same shape as seasonAt.
export function seasonByKey(key, now = new Date()) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(key || '').trim())
  if (!match) return null
  return buildSeason(Number(match[1]), Number(match[2]) - 1, seasonFormatter.format(now))
}

export function selectSeasonalCatalog(items, season) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .filter(
      (item) =>
        ['TV', 'WEB'].includes(item.platform) &&
        item.date >= season.start &&
        item.date < season.end &&
        !item.nsfw,
    )
    .sort(
      (a, b) =>
        Number(a.date > season.today) - Number(b.date > season.today) ||
        b.date.localeCompare(a.date) ||
        (b.rating?.score || 0) - (a.rating?.score || 0),
    )
}

export function selectSeasonal(items, season) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .filter(
      (item) =>
        ['TV', 'WEB'].includes(item.platform) &&
        item.date >= season.start &&
        item.date < season.end &&
        item.date <= season.today &&
        item.rating?.score >= 7 &&
        item.rating?.total >= 30 &&
        !item.nsfw,
    )
    .sort(
      (a, b) =>
        b.rating.score - a.rating.score || b.rating.total - a.rating.total,
    )
    .slice(0, 8)
}

// Also validate cached recommendations so a previous quarter or a legacy slide
// can never enter the current banner, including while the network is offline.
// 低票高分与高分低票的条目都会误导 banner，逐级放宽保证任何季度都有内容可展示。
export function seasonalBanner(catalog, season) {
  const originals = new Map(
    (catalog.slides || []).map((item) => [item.id, item]),
  )
  const pool = (catalog.items || catalog.slides || []).filter(
    (item) =>
      (!item.platform || ['TV', 'WEB'].includes(item.platform)) &&
      item.airDate >= season.start &&
      item.airDate < season.end &&
      item.airDate <= season.today,
  )
  const pick = (filter, sort, limit = 8) =>
    pool
      .filter(filter)
      .sort(sort)
      .slice(0, limit)
  const byScore = (a, b) =>
    b.score - a.score || b.votes - a.votes || b.airDate.localeCompare(a.airDate)
  const byVotes = (a, b) =>
    b.votes - a.votes || b.score - a.score || b.airDate.localeCompare(a.airDate)
  const byDate = (a, b) => b.airDate.localeCompare(a.airDate)
  const strict = pick(
    (item) => item.score >= 7 && item.votes >= 30,
    byScore,
  )
  const relaxed = strict.length
    ? strict
    : pick((item) => item.score >= 6.5 && item.votes >= 20, byScore)
  const popular = relaxed.length ? relaxed : pick((item) => item.votes >= 5, byVotes)
  return (popular.length ? popular : pick(() => true, byDate)).map((item) => ({
    ...originals.get(item.id),
    ...item,
  }))
}

function bangumiRequest(fetcher) {
  return async function request(url, options = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(url, {
          ...options, redirect: 'error', signal: AbortSignal.timeout(12000),
          headers: { 'User-Agent': 'Yingyu/1.3 (personal media library)', 'Content-Type': 'application/json' },
        })
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429) throw Object.assign(new Error('季度片单服务暂时不可用'), { permanent: true })
          throw new Error('季度片单暂时无法更新')
        }
        return await response.json()
      } catch (error) {
        if (attempt === 2 || error.permanent) throw new Error('暂时无法连接新番资料源，请稍后重试')
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
      }
    }
  }
}

function mapCatalogItem(item, season) {
  return {
    id: `seasonal-${item.id}`,
    subjectId: item.id,
    title: item.name_cn || item.name || '',
    subtitle: item.name || '',
    description: String(item.summary || '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700),
    image:
      item.images?.common || item.images?.large || item.images?.medium || '',
    score: item.rating?.score || 0,
    votes: item.rating?.total || 0,
    airDate: item.date,
    platform: item.platform,
    status: item.date > season.today ? 'upcoming' : 'airing',
    sourceUrl: `https://bgm.tv/subject/${item.id}`,
    source: 'Bangumi',
  }
}

export async function fetchSeasonal({
  now = new Date(),
  fetcher = fetch,
  saveImage,
  season: seasonOverride,
  knownItems = [],
} = {}) {
  const season = seasonOverride || seasonAt(now)
  const request = bangumiRequest(fetcher)
  const query = (offset) =>
    request(`https://api.bgm.tv/v0/search/subjects?limit=50&offset=${offset}`, {
      method: 'POST',
      body: JSON.stringify({
        keyword: '',
        // score 排序：rank 索引会漏掉大量条目（某季 total 从 293 缩水到 68），导致 banner 精选无源可选。
        sort: 'score',
        filter: {
          type: [2],
          air_date: [`>=${season.start}`, `<${season.end}`],
          nsfw: false,
        },
      }),
    })
  const first = await query(0)
  const others = await Promise.all(
    Array.from(
      { length: Math.max(0, Math.min(5, Math.ceil(first.total / 50)) - 1) },
      (_, i) => query((i + 1) * 50),
    ),
  )
  const rawItems = [
    ...(first.data || []),
    ...others.flatMap((page) => page.data || []),
  ]
  // Search indexes can omit subjects that their detail endpoint still dates to
  // this quarter. Recheck known omissions instead of dropping them on refresh.
  const present=new Set(rawItems.map(item=>Number(item.id)))
  const missing=knownItems.filter(item=>item.airDate>=season.start&&item.airDate<season.end&&!present.has(Number(String(item.id).replace('seasonal-','')))).slice(0,40)
  for(let offset=0;offset<missing.length;offset+=5){
    const checked=await Promise.allSettled(missing.slice(offset,offset+5).map(item=>request(`https://api.bgm.tv/v0/subjects/${String(item.id).replace('seasonal-','')}`)))
    for(const item of checked)if(item.status==='fulfilled'&&item.value.type===2&&item.value.id&&!present.has(item.value.id)){rawItems.push(item.value);present.add(item.value.id)}
  }
  const selected = selectSeasonal(rawItems, season)
  const items = selectSeasonalCatalog(rawItems, season).map((item) =>
    mapCatalogItem(item, season),
  )
  const results = await Promise.allSettled(
    selected.map(async (item) => {
      const detail = await request(`https://api.bgm.tv/v0/subjects/${item.id}`)
      let image = detail.images.large
      if (saveImage) {
        let poster
        try {
          poster = await downloadPoster(image, undefined, fetcher)
        } catch {
          poster = await downloadPoster(
            detail.images.common || image,
            undefined,
            fetcher,
          )
        }
        image = await saveImage(item.id, poster)
      }
      const summary = String(detail.summary || '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const description =
        BRIEFS[item.id] ||
        (summary && !/[\u3040-\u30ff]/.test(summary.slice(0, 80))
          ? summary.slice(0, 220)
          : '本季新作，已经收获观众的关注与好评。查看作品资料，发现下一部想追的故事。')
      return {
        id: `seasonal-${item.id}`,
        title: detail.name_cn || detail.name,
        subtitle: detail.name,
        description,
        image,
        score: item.rating.score,
        votes: item.rating.total,
        airDate: item.date,
        sourceUrl: `https://bgm.tv/subject/${item.id}`,
        source: 'Bangumi',
      }
    }),
  )
  const detailedSlides = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
  if (!items.length) throw new Error('当前季度暂无可用的新番资料，请稍后刷新')
  for (const slide of detailedSlides) {
    const item = items.find((item) => item.id === slide.id)
    if (item)
      Object.assign(item, {
        title: slide.title,
        subtitle: slide.subtitle,
        description: slide.description,
        image: slide.image,
      })
  }
  const slides = seasonalBanner({ items, slides: detailedSlides }, season)
  return { season, indexVersion:1, updatedAt: now.toISOString(), slides, items }
}

export async function createSeasonalService({
  root,
  data,
  fetcher = fetch,
  now = () => new Date(),
}) {
  let cached,
    pending,
    lastAttempt = 0,
    lastError = ''
  const subjects = new Map()
  function remember(items = []) {
    for (const item of items) {
      if (!/^seasonal-\d{1,12}$/.test(item?.id || '')) continue
      subjects.set(item.id, item)
    }
    return items
  }
  // The Bangumi search index can omit titles that the saved catalog already
  // verified (FX战士久留美 is one example). Merge remembered subjects into the
  // displayed quarter so a failed/short refresh never hides a known new anime.
  function mergeKnown(items = [], season = seasonAt(now())) {
    const merged = new Map((items || []).filter(Boolean).map(item => [item.id, item]))
    for (const item of subjects.values()) {
      if (!item?.id || item.nsfw || !item.airDate) continue
      if (item.airDate < season.start || item.airDate >= season.end) continue
      if (item.platform && !['TV', 'WEB'].includes(item.platform)) continue
      const existing = merged.get(item.id)
      merged.set(item.id, existing ? { ...item, ...existing } : item)
    }
    return [...merged.values()].sort(
      (a, b) =>
        Number(a.status === 'upcoming') - Number(b.status === 'upcoming') ||
        String(b.airDate || '').localeCompare(String(a.airDate || '')) ||
        (b.score || 0) - (a.score || 0),
    )
  }
  for (const file of [
    path.join(data, 'recommendations.json'),
    path.join(root, 'seasonal.json'),
  ]) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (
        value.season?.id === seasonAt(now()).id &&
        Array.isArray(value.slides)
      ) {
        cached = value
        remember(value.items || value.slides)
        break
      }
    } catch {}
  }
  try{const seed=JSON.parse(await readFile(path.join(root,'seasonal.json'),'utf8'));remember((seed.items || []).filter(item=>!subjects.has(item.id)))}catch{}
  async function refresh() {
    lastAttempt = Date.now()
    try {
      const value = await fetchSeasonal({
        now: now(),
        fetcher,
        knownItems:[...subjects.values()],
      })
      await writeFile(
        path.join(data, 'recommendations.tmp'),
        JSON.stringify(value, null, 2),
      )
      await rename(
        path.join(data, 'recommendations.tmp'),
        path.join(data, 'recommendations.json'),
      )
      cached = value
      remember(value.items || value.slides)
      lastError = ''
    } catch {
      lastError = '暂时无法连接新番资料源，请稍后重试'
      /* Preserve the last successfully verified list during network outages. */
    } finally {
      pending = undefined
    }
  }
  // Archived quarters: cached per key on disk, fetched from Bangumi on first view.
  const archiveDir = path.join(data, 'seasonal-archive')
  async function view(key) {
    const season = seasonByKey(key, now())
    if (!season)
      throw Object.assign(new Error('季度不存在'), { status: 400 })
    const currentId = seasonAt(now()).id
    if (season.id === currentId) return get(true)
    const file = path.join(archiveDir, `${season.id}.json`)
    try {
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (value?.season?.id === season.id && Array.isArray(value.items) && value.items.length) {
        remember(value.items)
        return { ...value, season, slides: seasonalBanner(value, season) }
      }
    } catch {}
    const value = await fetchSeasonal({ season, fetcher, now: now() })
    remember(value.items)
    try {
      await mkdir(archiveDir, { recursive: true })
      await writeFile(
        path.join(archiveDir, `${season.id}.tmp`),
        JSON.stringify(value, null, 2),
      )
      await rename(
        path.join(archiveDir, `${season.id}.tmp`),
        path.join(archiveDir, `${season.id}.json`),
      )
    } catch {}
    return { ...value, season, slides: seasonalBanner(value, season) }
  }
  function seasons() {
    const current = seasonAt(now())
    const list = []
    let year = current.year
    let quarter = Math.floor((current.month - 1) / 3)
    for (let index = 0; index < 16; index++) {
      list.push({
        id: `${year}-Q${quarter + 1}`,
        monthLabel: `${year}年${quarter * 3 + 1}月新番`,
        label: `${year} ${['冬', '春', '夏', '秋'][quarter]}季`,
        current: index === 0,
      })
      quarter -= 1
      if (quarter < 0) {
        quarter = 3
        year -= 1
      }
    }
    return list
  }
  // Bangumi 不可达时的离线回退：扫描本机已缓存的季度归档、搜索缓存与当前片单。
  async function searchLocalArchives(query) {
    const needle = String(query || '').trim().toLowerCase()
    if (!needle) return []
    const seen = new Set()
    const found = []
    const sources = [
      path.join(data, 'recommendations.json'),
    ]
    try {
      for (const entry of await readdir(path.join(data, 'seasonal-archive')))
        sources.push(path.join(data, 'seasonal-archive', entry))
    } catch {}
    try {
      for (const entry of await readdir(path.join(data, 'search-cache')))
        sources.push(path.join(data, 'search-cache', entry))
    } catch {}
    for (const file of sources) {
      try {
        const value = JSON.parse(await readFile(file, 'utf8'))
        for (const item of value.items || value.results || []) {
          const key = item.subjectId || item.id
          if (!key || seen.has(key)) continue
          if (
            `${item.title || ''} ${item.subtitle || ''}`
              .toLowerCase()
              .includes(needle) &&
            !item.nsfw
          ) {
            seen.add(key)
            found.push(item)
          }
        }
      } catch {}
    }
    return found.slice(0, 40)
  }
  // 跨季度搜索：2023 年 1 月开播至今（随年份自动扩展）的全部新番。
  // 结果缓存 24 小时：Bangumi 访问异常时，搜过的关键词仍然可用。
  async function search(keyword) {
    const query = String(keyword || '').trim().slice(0, 60)
    if (!query) return { results: [] }
    const digest = createHash('sha256')
      .update(`search:${query.toLowerCase()}`)
      .digest('hex')
      .slice(0, 24)
    const cacheFile = path.join(data, 'search-cache', `${digest}.json`)
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
      if (Date.now() - cached.at < 24 * 3600000 && cached.results?.length)
        return { results: remember(cached.results), cached: true }
    } catch {}
    const request = bangumiRequest(fetcher)
    const start = `${now().getFullYear() - 3}-01-01`
    let results = []
    try {
      const response = await request(
        'https://api.bgm.tv/v0/search/subjects?limit=40',
        {
          method: 'POST',
          body: JSON.stringify({
            keyword: query,
            sort: 'match',
            filter: {
              type: [2],
              air_date: [`>=${start}`],
              nsfw: false,
            },
          }),
        },
      )
      const season = seasonAt(now())
      results = remember(
        (response.data || [])
          .filter((item) => ['TV', 'WEB'].includes(item.platform) && !item.nsfw)
          .map((item) => mapCatalogItem(item, season)),
      )
      if (results.length) {
        try {
          await mkdir(path.join(data, 'search-cache'), { recursive: true })
          await writeFile(
            path.join(data, 'search-cache', `${digest}.json`),
            JSON.stringify({ at: Date.now(), results }),
          )
        } catch {}
      }
    } catch {
      // Bangumi 不可达（DNS 污染/网络封锁）时，回退扫描本机缓存的季度归档。
      results = await searchLocalArchives(query)
    }
    return { results }
  }
  // Imports must resolve trusted works across viewed quarters and search results,
  // rather than treating membership of the current banner as import permission.
  async function findSubject(id) {
    const match = /^seasonal-(\d{1,12})$/.exec(typeof id === 'string' ? id : '')
    if (!match) return undefined
    if (subjects.has(id)) return subjects.get(id)
    let files = []
    try { files = await readdir(archiveDir) } catch {}
    for (const file of files.filter((name) => /^\d{4}-Q[1-4]\.json$/.test(name))) {
      try {
        const value = JSON.parse(await readFile(path.join(archiveDir, file), 'utf8'))
        if (`${value.season?.id}.json` !== file || !Array.isArray(value.items)) continue
        remember(value.items)
        if (subjects.has(id)) return subjects.get(id)
      } catch {}
    }
    let item
    try {
      item = await bangumiRequest(fetcher)(`https://api.bgm.tv/v0/subjects/${match[1]}`)
    } catch {
      throw Object.assign(new Error('暂时无法读取这部作品的资料，请稍后重试'), { status: 502 })
    }
    if (String(item.id) !== match[1] || item.type !== 2 || item.nsfw ||
        !['TV', 'WEB'].includes(item.platform) || !(item.name_cn || item.name)) return undefined
    const subject = mapCatalogItem(item, seasonAt(now()))
    remember([subject])
    return subject
  }
  function get(catalog = false) {
      const season = seasonAt(now())
      const current = cached?.season?.id === season.id ? cached : undefined
      if (
        !pending &&
        Date.now() - lastAttempt > 60000 &&
        (!current ||
          (catalog && !current.items) ||
          (current.indexVersion!==1 && [...subjects.values()].some(item=>item.airDate>=season.start&&item.airDate<season.end&&!current.items?.some(present=>present.id===item.id))) ||
          now().getTime() - Date.parse(current.updatedAt) > 6 * 3600000)
      )
        pending = refresh()
      const items = mergeKnown(current?.items, season)
      const merged = { ...(current || { season, updatedAt: null }), items }
      return {
        ...merged,
        season,
        slides: seasonalBanner(merged, season),
        refreshing: Boolean(pending),
        error: lastError,
      }
  }
  return {
    get,
    async update() {
      if (!pending && Date.now() - lastAttempt > 10000) pending = refresh()
      await pending
      return this.get(true)
    },
    view,
    seasons,
    search,
    findSubject,
  }
}
