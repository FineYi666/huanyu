import {normalizeSearchSites} from './resource-sites.mjs'

const page=(id,name,url,extra={})=>({id,name,api:new URL(url).origin+'/',anime:true,page:true,...extra,site:normalizeSearchSites([{name,type:'page',url}],true)[0]})
export const AGE_SOURCE=page('age','AGE动漫','https://www.agedm.io/search?query={query}')
export const ANIME_PAGE_SOURCES=[
  page('ddys','DDYS · 低端影视','https://ddys.app/'),
  page('mgn','MG动漫','https://www.mgnacg.com/media/',{suggest:'/index.php/ajax/suggest',detail:'/media/{id}/'}),
  page('mute','Mute动漫','https://www.mutedm.com/',{suggest:'/index.php/ajax/suggest',detail:'/voddetail/{id}.html'}),
  page('lmm','路漫漫','https://www.lmm85.com/',{suggest:'/index.php/ajax/suggest',detail:'/detail/{id}.html'}),
  AGE_SOURCE,
]
const hosts=new Set(['m3u8.girigirilove.com','ddys.app','www.mgnacg.com','www.mutedm.com','www.lmm85.com','www.agedm.io'])
export function isAnimeSource(source){try{return source.id==='giri'||ANIME_PAGE_SOURCES.some(item=>item.id===source.id)||hosts.has(new URL(source.site?.url||source.api).hostname)}catch{return false}}
