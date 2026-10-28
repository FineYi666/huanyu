import { createHash } from 'node:crypto'
import { matchesWork, workSearchTerms, canonicalWorkKey } from './media-match.mjs'
import { requestSite, normalizeSearchSites } from './resource-sites.mjs'
import { parsePageSources, pageTitle } from './page-sources.mjs'
import { resourceRelevance } from './resource-search.mjs'
import { seasonNumber } from './episode-seasons.mjs'
import { probeStream, publicVideoUrl } from './stream-probe.mjs'
import { qualityLabel, resolutionHeight } from './stream-quality.mjs'
// Search -> selected work -> playback roads follows Kazumi's documented rule flow.
// giriGiriLove endpoints/field mappings: Predidit/KazumiRules (MIT), see licenses.
export const AGE_SOURCE = { id: 'age', name: 'AGE动漫', api: 'https://www.agedm.io/', anime: true, page: true,
  site: normalizeSearchSites([{name:'AGE动漫',type:'page',url:'https://www.agedm.io/search?query={query}'}],true)[0] }
const SOURCES = [
  AGE_SOURCE,
  { id: 'subo', name: '速播资源', api: 'https://subocj.com/api.php/provide/vod' },
  { id: 'hn', name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod' },
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
    api: 'https://api.ffzyapi.com/api.php/provide/vod',
  },
  {
    id: 'zy360',
    name: '360资源',
    api: 'https://360zy5.com/api.php/provide/vod',
  },
]
export function sourcePriority(source, category) {
  if (category !== 'anime') return 0
  if (/https:\/\/(?:www\.)?ddys\.(?:app|info|one)(?:\/|$)/i.test(source.pageUrl || source.api || '') || /低端影视|低调影视|DDYS/i.test(source.sourceName || source.name || '')) return 0
  const name=source.sourceName || source.name || ''
  if ((source.sourceId || source.id) === 'giri' || /giriGiriLove/i.test(name)) return 1
  if ((source.sourceId || source.id) === 'age' || /AGE动漫/i.test(name)) return 2
  if ((source.sourceId || source.id) === 'subo' || /速播/.test(name)) return 20
  if ((source.sourceId || source.id) === 'hn' || /红牛/.test(name)) return 21
  return 10
}
const idFor = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24)
export const onlineEpisodeId = episode => `online-ep-${episode.season || 1}-${episode.number}`
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
  const episodeNumber = title => Number(String(title).match(/^(?:第\s*|ep?\s*)?(\d{1,3})\s*(?:集|话|話)?$/i)?.[1]) || null
  return String(vod.vod_play_url || '')
    .split('$$$')
    .flatMap((group, index) => {
      const entries = group.split('#')
      const season = seasonNumber(vod.vod_name)
      const firstNumber = entries.map(entry => episodeNumber(entry.split('$')[0])).find(Boolean) || 1
      const offset = season > 1 ? firstNumber - 1 : 0
      const episodes = entries.flatMap((entry, position) => {
        const split = entry.indexOf('$')
        if (split < 0) return []
        try {
          const url = publicVideoUrl(entry.slice(split + 1).trim())
          if (!/\.(?:m3u8|mp4|webm)(?:$|\?)/i.test(url)) return []
          return [
            {
              id: idFor(url),
              originalTitle: entry.slice(0, split).trim(),
              number: Math.max(1, (episodeNumber(entry.slice(0, split)) || position + 1 + offset) - offset),
              url,
            },
          ]
        } catch {
          return []
        }
      })
      if (!episodes.length) return []
      return [
        {
          name:
            { chs: '简体字幕', cht: '繁体字幕' }[names[index]] ||
            names[index] ||
            `线路 ${index + 1}`,
          episodes: episodes.map((episode) => ({
            ...episode,
            title: `第${episode.number}集`,
            season,
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
  getSites=()=>[],
  readPage,
  searchPage,
} = {}) {
  const providerList=()=>[...providers,...getSites().filter(site=>site.enabled && ['vod','page'].includes(site.type)).map(site=>({id:`custom-${site.id}`,name:`自定义 · ${site.name}`,api:site.url,custom:true,page:site.type==='page',site}))]
  const sourceUrl=(source,params)=>{const url=new URL(source.api);for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));return url.href}
  const records = new Map(),
    pending = new Map(),
    failed = new Map()
  async function pageResults(source,query,aliases,category,minHeight) {
    if(!readPage||!searchPage)throw new Error('网页影视源需要桌面版')
    const found=[],seen=new Set()
    for(const term of workSearchTerms(query,aliases).slice(0,2)){
      const search=await searchPage(source.site,term)
      const candidates=[...new Map((search.links||[]).flatMap(link=>{
        try {
          const url=new URL(link.url)
          if(source.id==='age'&&url.hostname==='www.agedm.io')url.protocol='https:'
          return url.origin===new URL(source.api).origin && resourceRelevance(pageTitle(link.title),term) ? [[url.href,{...link,url:url.href}]] : []
        }catch{return []}
      })).values()].slice(0,3)
      for(const candidate of candidates){
        if(seen.has(candidate.url))continue;seen.add(candidate.url)
        const page=await readPage(source.site,candidate.url)
        for(const road of parsePageSources(page,category).slice(0,source.id==='age'?2:8)){
          if(!matchesWork({title:road.title,type:road.category==='movie'?'电影':road.category==='tv'?'电视剧':'动漫'},query,{aliases,category}))continue
          const episode=road.episodes[0]
          try{const checked=await probeEpisode(source,road,episode);const height=resolutionHeight(checked.width,checked.height);if(height&&height<minHeight)continue
            const item={...road,id:`web-${source.id}-${idFor(`${road.pageUrl || page.url}/${road.pageSeason||1}/${road.pageNodeId}`)}`,sourceId:source.id,providerItemId:road.pageUrl || page.url,sourceName:source.name,libraryKey:`online-${idFor(`${category}/${canonicalWorkKey(road.title)}`)}`,minHeight,width:checked.width,height:checked.height,quality:qualityLabel(height),checkedAt:new Date(now()).toISOString(),checkedEpisode:episode.id}
            records.set(item.id,{item,expires:now()+20*60000});found.push(item)
          }catch(error){if(error.needsVerification)throw error}
        }
      }
      if(found.length)break
    }
    return found
  }
  async function probeEpisode(provider,item,episode) {
    if(episode.pageUrl && provider?.id==='age' && !episode.url){
      const page=await readPage(provider.site,episode.pageUrl)
      for(const url of [...(page.videos||[]),...(page.media||[])].filter(url=>/\.(?:m3u8|mp4|webm)(?:$|\?)/i.test(url))){
        try{const headers=page.mediaHeaders?.[url] || {Referer:episode.pageUrl};const checked=await probe({url,headers,web:true},{fetcher});episode.url=url;item.headers=headers;return checked}catch{}
      }
      throw new Error('AGE 本集播放地址暂不可用，请换线路')
    }
    return probe({url:episode.url,headers:item.headers,web:true},{fetcher})
  }
  async function api(url, signal) {
    if(providerList().some(source=>source.custom && new URL(url).origin===new URL(source.api).origin && new URL(url).pathname===new URL(source.api).pathname)) {
      const value=JSON.parse((await requestSite(url,{fetcher,signal})).text)
      if(!Array.isArray(value.list))throw new Error('该地址不是兼容的影视采集接口')
      return value
    }
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
      minHeight = [0, 720, 1080, 1440, 2160].includes(options.minHeight) ? options.minHeight : 1080,
      key = JSON.stringify([query, aliases, options.category, minHeight,options.cover,getSites()])
    if (pending.has(key)) return pending.get(key)
    const operation = (async () => {
      const statuses = await Promise.all(
        providerList()
          .filter((source) => !source.anime || !options.category || options.category === 'anime')
          .map(async (source) => {
            const found = [],
              deadline = AbortSignal.timeout(20000)
            let matchedCount = 0, rejectedQuality = 0, rejectedPlayback = 0
            const boundedFetch = (url, options = {}) =>
              fetcher(url, {
                ...options,
                signal: options.signal
                  ? AbortSignal.any([deadline, options.signal])
                  : deadline,
              })
            try {
              if(source.page){found.push(...await pageResults(source,query,aliases,options.category||'anime',minHeight));return{name:source.name,status:'ok',count:found.length,results:found,message:found.length?'网页片源已校验':'未发现匹配且可播放的网页片源'}}
              for (const term of workSearchTerms(query, aliases)) {
                const data = await api(
                  source.anime
                    ? `${source.api}get_list?vod_name=${encodeURIComponent(term)}&offset=0&limit=20`
                    : sourceUrl(source,{ac:'detail',wd:term}),
                  deadline,
                )
                const candidates = (source.anime ? data.info?.rows : data.list) || []
                const matches = vod => matchesWork(vod, query, { aliases, category: options.category })
                // Some catalogs put short dramas before the exact title on page two.
                // Check a bounded number of pages without relaxing title/category rules.
                if (!source.anime && !candidates.some(matches)) {
                  for (let page = 2; page <= Math.min(Number(data.pagecount) || 1, 3); page++) {
                    const next = await api(sourceUrl(source,{ac:'detail',wd:term,pg:page}), deadline)
                    candidates.push(...(Array.isArray(next.list) ? next.list : []))
                    if (candidates.some(matches)) break
                  }
                }
                const matched = candidates.filter(matches).slice(0, 4)
                matchedCount += matched.length
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
                        providerItemId: String(vod.vod_id),
                        sourceName: source.name,
                        road: road.name,
                        title: String(detail.vod_name).trim(),
                        category: options.category || 'anime',
                        libraryKey: `online-${idFor(`${options.category || 'anime'}/${canonicalWorkKey(detail.vod_name)}`)}`,
                        description: String(detail.vod_content || detail.vod_blurb || '').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim().slice(0,1500),
                        genre: String(detail.vod_class || '').slice(0,80),
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
                          const checked = await probe(
                            { url: episode.url, headers: item.headers },
                            { fetcher: boundedFetch },
                          )
                          const tier = resolutionHeight(checked.width, checked.height)
                          if (tier && tier < minHeight) { rejectedQuality++; continue }
                          item.height = checked.height || 0
                          item.width = checked.width || 0
                          item.qualityHeight = tier
                          item.quality = tier ? qualityLabel(tier) : '清晰度待确认'
                          item.resolutionSource = checked.resolutionSource || ''
                          item.minHeight = minHeight
                          item.checkedAt = new Date(now()).toISOString()
                          item.checkedEpisode = episode.id
                          verified = true
                          break
                        } catch {
                          rejectedPlayback++
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
                matchedCount,
                message: found.length ? '' : rejectedQuality ? '找到作品，但画质低于当前筛选要求' : matchedCount ? '找到作品，但线路暂无法播放' : '未收录匹配作品',
                results: found,
              }
            } catch (error) {
              return {
                name: source.name,
                status: 'error',
                count: found.length,
                matchedCount,
                message: source.custom?String(error.message).slice(0,140):'来源响应超时或暂不可用',
                needsVerification:Boolean(error.needsVerification),
                siteId:error.siteId,
                results: found,
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
            .map((item) => {
              // A trusted catalog poster also works when the source site's images
              // require its browser session. Keep saved records consistent with UI.
              if (options.cover) item.cover = options.cover
              return [item.id, publicItem(item)]
            }),
        ).values(),
      ].filter((item) => item.episodes.length).sort((a,b) => sourcePriority(a,options.category) - sourcePriority(b,options.category) || (b.qualityHeight || 0) - (a.qualityHeight || 0))
      return {
        results,
        sources: statuses.map(({ results, ...source }) => source).sort((a,b)=>sourcePriority(a,options.category)-sourcePriority(b,options.category)),
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
    try {
      const verified = await probeEpisode(providerList().find(provider=>provider.id===record.item.sourceId),record.item,episode)
      const source = { url: episode.url, headers: record.item.headers, web: true }
      const tier = resolutionHeight(verified.width, verified.height)
      if (tier && tier < record.item.minHeight)
        throw Object.assign(new Error(`本集仅提供 ${verified.height}P，低于当前超清筛选要求，请换线路或关闭超清优先后重搜`), { code: 'LOW_RESOLUTION' })
      return { ...source, ...verified }
    } catch (error) {
      if (error.code !== 'LOW_RESOLUTION') failed.set(`${resultId}/${episodeId}`, now() + 120000)
      throw error
    }
  }
  function report(resultId, episodeId) {
    if (records.get(resultId)?.item.episodes.some((ep) => ep.id === episodeId))
      failed.set(`${resultId}/${episodeId}`, now() + 120000)
  }
  async function resolveStored(item, episodeId) {
    let episode = item.episodes.find(ep => ep.id === episodeId)
    if (!episode) throw new Error('此播放线路没有对应集数，请切换其他线路')
    const attempt = async () => {
      const value = await probeEpisode(providerList().find(provider=>provider.id===item.sourceId),item,episode)
      const tier = resolutionHeight(value.width,value.height)
      if (tier && tier < item.minHeight) throw new Error('本集画质低于保存时的超清要求，请选择其他线路')
      if (tier) { item.width=value.width;item.height=value.height;item.quality=qualityLabel(tier) }
      item.checkedAt=new Date(now()).toISOString()
      return {...value,headers:item.headers || {},web:true}
    }
    try { return await attempt() }
    catch {
      const provider = providerList().find(provider=>provider.id===item.sourceId)
      if (!provider || !item.providerItemId) throw new Error('这条收藏线路暂不可用，请重新搜索并选择其他片源')
      if(provider.page){const page=await readPage(provider.site,item.pageUrl);const road=parsePageSources(page,item.category).find(road=>road.pageNodeId===item.pageNodeId && road.pageSeason===item.pageSeason);if(!road)throw new Error('网站已更换播放列表，请重新搜索');const saved=item.episodes[0]?.id.startsWith('online-ep-');item.episodes=road.episodes.map(ep=>({...ep,id:saved?onlineEpisodeId(ep):ep.id}));episode=item.episodes.find(ep=>ep.id===episodeId);if(!episode)throw new Error('网站已移除此集，请切换片源');return attempt()}
      const value = await api(provider.anime ? `${provider.api}get_detail?vod_id=${encodeURIComponent(item.providerItemId)}` : sourceUrl(provider,{ac:'detail',ids:item.providerItemId}))
      const detail = provider.anime ? value.info : value.list?.find(vod=>String(vod.vod_id)===item.providerItemId)
      if (!detail || !matchesWork(detail,item.title,{category:item.category})) throw new Error('原片源已下架或作品信息发生变化，请重新选择资源')
      const road = parsePlayRoads(detail).find(road=>road.name===item.road)
      if (!road) throw new Error('原播放线路已下架，请切换其他线路')
      item.episodes = road.episodes.map(ep=>({...ep,id:onlineEpisodeId(ep)}))
      episode = item.episodes.find(ep=>ep.id===episodeId)
      if (!episode) throw new Error('原片源已移除此集，请切换其他线路')
      item.checkedAt = new Date(now()).toISOString()
      return attempt()
    }
  }
  return {
    search,
    resolve,
    resolveStored,
    snapshot(resultId) {
      const record = records.get(resultId)
      if (!record || record.expires < now()) throw new Error('搜索记录已过期，请重新搜索后加入片库')
      return structuredClone(record.item)
    },
    relatedSnapshots(resultId) {
      const selected = records.get(resultId)
      if (!selected || selected.expires < now()) return []
      return [...records.values()].filter(record=>record.expires>now() && record.item.libraryKey===selected.item.libraryKey).slice(0,8).map(record=>structuredClone(record.item))
    },
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
