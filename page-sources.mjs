import { createHash } from 'node:crypto'
import { publicVideoUrl } from './stream-probe.mjs'
import { seasonNumber } from './episode-seasons.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24)
export const pageTitle=value=>String(value||'').replace(/\s*[（(](?:更新至|全\d|已完结|完结)[\s\S]*[）)]\s*$/,'').trim()

export function parsePageSources(page,requestedCategory) {
  if(new URL(page.url).hostname==='www.agedm.io')return parseAgeSources(page)
  if(requestedCategory==='anime' && page.chapterGroups?.length)return parseChapterSources(page)
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

export function pageMediaUrls(page){
  const values=[...(page.videos||[]),...(page.media||[])]
  // The normal embedded player can expose a signed video URL without a file
  // suffix. Only accept such URLs from a real, non-advert video element.
  const observed=new Set((page.frameStates||[]).flatMap(frame=>(frame.videos||[]).filter(video=>video.duration>180&&!video.error).map(video=>video.src)))
  values.push(...observed)
  for(const script of page.scripts||[]){
    const start=script.search(/player_\w+\s*=/)
    if(start<0)continue
    const first=script.indexOf('{',start)
    let depth=0,quoted=false,escape=false
    for(let i=first;i>=0&&i<script.length;i++){
      const c=script[i]
      if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue}
      if(c==='"'){quoted=true;continue}
      if(c==='{')depth++
      if(c==='}'&&!--depth){
        try{const data=JSON.parse(script.slice(first,i+1));let url=data.url;if(data.encrypt===1||data.encrypt==='1')url=decodeURIComponent(url);if(data.encrypt===2||data.encrypt==='2')url=decodeURIComponent(Buffer.from(url,'base64').toString('utf8'));values.push(url)}catch{}
        break
      }
    }
  }
  return [...new Set(values)].flatMap(value=>{try{const url=publicVideoUrl(value,page.url);return (/\.(m3u8|mp4|webm)(?:$|\?)/i.test(url)||observed.has(url))&&!/(?:trailer|advert|\/ads?\/)/i.test(url)?[url]:[]}catch{return []}}).sort((a,b)=>Number(/\.m3u8(?:$|\?)/i.test(b))-Number(/\.m3u8(?:$|\?)/i.test(a)))
}

function parseChapterSources(page){
  const base=pageTitle(page.workTitle||page.detailTitle||page.documentTitle?.split(' - ')[0]||page.title)
  return page.chapterGroups.flatMap((group,index)=>{
    if(/会员专属|需要会员|付费|订阅|已下线/i.test(group.name||''))return []
    const season=seasonNumber(group.name)||seasonNumber(base)||1
    const title=seasonNumber(base)?base:`${base}${season>1?` 第${season}季`:''}`
    const seen=new Set()
    const entries=(group.episodes||[]).flatMap(ep=>{try{
      if(/预告|预览|PV|特典|解说/i.test(ep.title))return []
      const n=String(ep.title).match(/^(?:第\s*|EP?\s*)?(\d{1,4})\s*(?:集|话|話|完|\b)/i)?.[1]
      const pageUrl=publicVideoUrl(ep.url,page.url)
      if(!n||new URL(pageUrl).origin!==new URL(page.url).origin||seen.has(Number(n)))return []
      seen.add(Number(n));return [{raw:Number(n),pageUrl,originalTitle:ep.title}]
    }catch{return []}}).sort((a,b)=>a.raw-b.raw)
    if(!entries.length)return []
    const offset=season>1?entries[0].raw-1:0
    return [{title,category:'anime',cover:page.poster||'',description:page.text?.slice(0,1200)||'',pageUrl:page.url,pageSeason:season,pageNodeId:`chapter-${index}`,road:group.name||`线路 ${index+1}`,headers:{Referer:page.url},episodes:entries.map(ep=>({...ep,id:hash(`${page.url}/${index}/${ep.raw}`),season,number:ep.raw-offset,title:`第${ep.raw-offset}集`}))}]
  })
}

function parseAgeSources(page) {
  const work=new URL(page.url).pathname.match(/^\/(?:detail|play)\/(\d+)/)?.[1]
  if(!work)return []
  const title=String(page.documentTitle||page.visibleTitle||page.title).split(' - ')[0].replace(/\s+第\d+[集话]$/,'').trim()
  const season=seasonNumber(title)||1,groups=new Map()
  for(const link of page.links||[])try{
    const url=new URL(link.url,page.url)
    if(url.hostname!=='www.agedm.io')continue
    url.protocol='https:'
    const match=url.pathname.match(new RegExp(`^/play/${work}/(\\d+)/(\\d+)$`))
    if(!match||!/^第?\s*\d+\s*[集话話]?$/.test(link.title.trim()))continue
    const group=match[1],raw=Number(link.title.match(/\d+/)?.[0])||Number(match[2])
    if(!groups.has(group))groups.set(group,new Map())
    groups.get(group).set(raw,{pageUrl:url.href,raw,originalTitle:link.title})
  }catch{}
  return [...groups].flatMap(([group,entries])=>{
    const road=page.roadLabels?.[Number(group)-1]||`线路 ${group}`
    // A road called "VIP" may still be public; explicit paid/member access is not.
    if(/会员专属|需要会员|付费|订阅|已下线/i.test(road))return []
    const ordered=[...entries.values()].sort((a,b)=>a.raw-b.raw),offset=season>1?ordered[0].raw-1:0
    return [{title,category:'anime',cover:'',year:page.text?.match(/首播时间[:：]?\s*((?:19|20)\d{2})/)?.[1]||'',description:page.text?.split('在线播放')[0].slice(0,1200)||'',pageUrl:`https://www.agedm.io/detail/${work}`,pageSeason:season,pageNodeId:`age-${group}`,road,headers:{Referer:page.url},episodes:ordered.map(ep=>({...ep,id:hash(`${work}/${group}/${ep.raw}`),season,number:ep.raw-offset,title:`第${ep.raw-offset}集`}))}]
  })
}
