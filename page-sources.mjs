import { createHash } from 'node:crypto'
import { publicVideoUrl } from './stream-probe.mjs'
import { seasonNumber } from './episode-seasons.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24)
export const pageTitle=value=>String(value||'').replace(/\s*[（(](?:更新至|全\d|已完结|完结)[\s\S]*[）)]\s*$/,'').trim()

export function parsePageSources(page,requestedCategory) {
  let playlist
  for(const script of [...(page.playlists||[]),...(page.scripts||[])])try{const value=JSON.parse(script);if(value.seasons?.length&&value.nodes?.length){playlist=value;break}}catch{}
  const category=playlist?.playlistType==='movie'?'movie':(page.links||[]).some(link=>/\/category\/anime\//.test(link.url))?'anime':(page.links||[]).some(link=>/\/category\/movie\//.test(link.url))?'movie':playlist?.playlistType?'tv':requestedCategory
  const base=pageTitle(page.title)
  const common={cover:page.image||'',description:page.text?.split(/\n\s*(?:视频下载|由 |VIP线路)/)[0].slice(0,1500)||'',year:page.text?.match(/(?:年份|首播|上映日期)[:：]?\s*((?:19|20)\d{2})/)?.[1]||'',category,pageUrl:page.url,headers:{Referer:page.url}}
  if(playlist){
    const roads=[]
    for(const season of playlist.seasons){
      const number=Number(season.season)||seasonNumber(season.title)||1
      for(const node of playlist.nodes.filter(node=>node.access==='public')){
        const episodes=(season.tracks||[]).flatMap((track,index)=>{try{const url=publicVideoUrl(track.nodeSources?.[node.id]);if(!/\.(?:m3u8|mp4|webm)(?:$|\?)/i.test(url))return [];const n=Number(track.episode)||index+1;return [{id:hash(`${page.url}/${number}/${n}`),number:n,season:category==='movie'?null:number,title:`第${n}集`,originalTitle:track.title||`第${n}集`,url}]}catch{return []}})
        if(episodes.length)roads.push({...common,title:category==='movie'?base:`${base} 第${number}季`,pageSeason:number,pageNodeId:node.id,road:node.label||node.id,episodes})
      }
    }
    return roads
  }
  const media=[...new Set([...(page.media||[]),...(page.videos||[])])].flatMap(value=>{try{const url=publicVideoUrl(value);return /\.(?:m3u8|mp4|webm)(?:$|\?)/i.test(url)?[url]:[]}catch{return []}})
  if(media.length && category==='movie')return media.slice(0,3).map((url,index)=>({...common,title:base,road:`网页线路 ${index+1}`,pageNodeId:String(index),episodes:[{id:hash(`${page.url}/1/1`),number:1,season:null,title:'第1集',originalTitle:base,url}]}))
  return []
}
