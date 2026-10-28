import { onlineEpisodeId } from './web-sources.mjs'
import { fetchPublicVideo } from './stream-probe.mjs'

export function syncOnlineEpisodes(media) {
  const episodes = new Map()
  const preferred = media.webSources.find(source=>source.id===media.online.preferredId)
  for (const source of [preferred,...media.webSources].filter(Boolean))
    for (const episode of source.episodes) if (!episodes.has(episode.id))
      episodes.set(episode.id,{id:episode.id,name:episode.originalTitle || episode.title,season:episode.season,episodeNumber:episode.number})
  media.episodes = [...episodes.values()].sort((a,b)=>(a.season || 1)-(b.season || 1) || a.episodeNumber-b.episodeNumber)
}

export function saveOnlineMedia(selected, related = [], existing, favorite) {
  if (!selected.libraryKey || !selected.episodes?.length) throw new Error('没有可保存的在线剧集')
  const sources = new Map((existing?.webSources || []).map(source=>[source.id,source]))
  for (const source of [selected,...related]) if (source.libraryKey===selected.libraryKey)
    sources.set(source.id,{...source,episodes:source.episodes.map(episode=>({...episode,id:onlineEpisodeId(episode)}))})
  const media = {
    ...existing,
    id:selected.libraryKey,source:'url',category:selected.category,
    title:existing?.title || selected.title,cover:existing?.cover || selected.cover,
    description:existing?.description || selected.description || '',
    year:existing?.year || selected.year,genre:existing?.genre || selected.genre || '未分类',
    addedAt:existing?.addedAt || Date.now(),favorite:typeof favorite==='boolean'?favorite:Boolean(existing?.favorite),
    progress:existing?.progress || {},
    online:{preferredId:selected.id,sourceName:selected.sourceName,road:selected.road,quality:selected.quality},
    webSources:[...sources.values()].slice(0,12),
    manual:existing?.manual || {category:true},
  }
  syncOnlineEpisodes(media)
  return media
}

export function publicOnlineSources(media) {
  return media.webSources.map(({headers,providerItemId,...source})=>({...source,mediaId:media.id,episodes:source.episodes.map(({url,...episode})=>episode)}))
}

export async function fetchOnlineCover(url, fetcher = fetch) {
  if (!url) return null
  try {
    const value = new URL(url)
    if (value.protocol==='http:') value.protocol='https:'
    const {response} = await fetchPublicVideo(value.href,{fetcher,timeout:5000})
    const reader=response.body.getReader(),chunks=[]
    let size=0
    try {
      while (true) {
        const {done,value}=await reader.read()
        if(done)break
        if((size+=value.length)>4*1024*1024)throw new Error('image too large')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(()=>{}) }
    const bytes=Buffer.concat(chunks)
    const extension=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'webp':null
    return extension?{bytes,extension}:null
  } catch { return null }
}
