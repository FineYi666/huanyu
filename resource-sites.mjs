import { createHash } from 'node:crypto'
import { publicVideoUrl, fetchPublicVideo } from './stream-probe.mjs'
import { extractQuarkResults, resourceRelevance } from './resource-search.mjs'
import { request } from 'node:https'
import { lookup } from 'node:dns'
import { isIP } from 'node:net'

// TUN software maps public names to 198.18/15; TLS still validates the public
// hostname. Direct benchmark IP URLs and actual LAN destinations remain blocked.
const publicAddress=(address,tunnel=false)=>address.includes(':')?/^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:db8:/i.test(address):(()=>{const [a,b,c]=address.split('.').map(Number);return !([0,10,127].includes(a)||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,2,168].includes(b))||(a===198&&((!tunnel&&[18,19].includes(b))||(b===51&&c===100)))||(a===203&&b===0&&c===113))})()
async function readPublicSite(value,signal,redirects=0) {
  const url=publicVideoUrl(value)
  if(isIP(new URL(url).hostname)&&!publicAddress(new URL(url).hostname))throw new Error('搜索网站必须使用公开网络地址')
  if(redirects>4)throw new Error('网站跳转过多')
  const result=await new Promise((resolve,reject)=>{
    const req=request(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{'User-Agent':'Mozilla/5.0 Huanyu/1.3','Accept':'text/html,application/json'},lookup:(hostname,options,callback)=>lookup(hostname,{all:true},(error,addresses)=>{
      if(error)return callback(error)
      if(!addresses.length||addresses.some(item=>!publicAddress(item.address,true)))return callback(new Error('搜索网站必须使用公开网络地址'))
      if(options.all)callback(null,addresses)
      else callback(null,addresses[0].address,addresses[0].family)
    })},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){response.resume();resolve({redirect:response.headers.location});return}
      if(response.statusCode<200||response.statusCode>=300){response.resume();reject(new Error(`网站暂不可用（${response.statusCode}）`));return}
      const chunks=[];let size=0
      response.on('data',chunk=>{if((size+=chunk.length)>4*1024*1024){response.destroy(new Error('网站返回内容过大'));return}chunks.push(chunk)})
      response.on('end',()=>resolve({text:Buffer.concat(chunks).toString('utf8'),url}))
      response.on('error',reject)
    })
    req.on('error',reject);req.end()
  })
  if('redirect' in result){if(!result.redirect)throw new Error('网站跳转无效');return readPublicSite(publicVideoUrl(result.redirect,url),signal,redirects+1)}
  return result
}

export function normalizeSearchSites(value, strict=false) {
  if(!Array.isArray(value)){if(strict)throw new Error('搜索网站配置格式不正确');return []}
  if(value.length>12&&strict)throw new Error('最多添加 12 个搜索网站')
  const sites=new Map()
  for(const item of value.slice(0,12))try {
    const name=String(item.name||'').trim().slice(0,40), type=item.type
    let url=String(item.url||'').trim()
    if(!name || !['quark','vod','web','page'].includes(type) || url.length>1500)throw new Error('请填写网站名称、类型和有效地址')
    if(['quark','web'].includes(type)&&!url.includes('{query}'))throw new Error('网页搜索地址需要包含 {query}，用于替换搜索关键词')
    publicVideoUrl(url.replaceAll('{query}','test'))
    const host=new URL(url.replaceAll('{query}','test')).hostname
    if(isIP(host)&&!publicAddress(host))throw new Error('地址不能指向私有网络')
    const id=createHash('sha256').update(`${type}/${url}`).digest('hex').slice(0,16)
    sites.set(id,{id,name,type,url,enabled:item.enabled!==false})
  }catch(error){if(strict)throw new Error(error.message.includes('{query}')?error.message:'请使用公开的 HTTPS 搜索地址，填写完整的网站名称和类型')}
  return [...sites.values()]
}
export const siteSearchUrl=(site,query)=>site.url.replaceAll('{query}',encodeURIComponent(query))

export async function requestSite(url,{fetcher=fetch,signal}={}) {
  if(fetcher===fetch)return readPublicSite(url,signal)
  const {response,url:finalUrl}=await fetchPublicVideo(url,{timeout:10000,fetcher:(target,options)=>fetcher(target,{...options,signal:signal?AbortSignal.any([signal,options.signal]):options.signal})})
  const reader=response.body?.getReader(),chunks=[]
  if(!reader)throw new Error('网站返回了空内容')
  let length=0
  try{while(true){const part=await reader.read();if(part.done)break;if((length+=part.value.length)>4*1024*1024)throw new Error('网站返回内容过大');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{})}
  return {text:Buffer.concat(chunks).toString('utf8'),url:finalUrl}
}
const textOnly=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()
export async function searchQuarkSite(site,query,{fetcher=fetch}={}) {
  const deadline=AbortSignal.timeout(12000)
  const first=await requestSite(siteSearchUrl(site,query),{fetcher,signal:deadline})
  const links=[...first.text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  const results=[]
  for(const [,href,label] of links) {
    const title=textOnly(label)
    if(!resourceRelevance(title,query))continue
    try{
      const url=publicVideoUrl(href.replaceAll('&amp;','&'),first.url)
      if(new URL(url).hostname==='pan.quark.cn')results.push(...extractQuarkResults([{title,content:url,source:site.name}],first.url))
    }catch{}
  }
  const details=new Map()
  for(const [,href,label] of links){const title=textOnly(label);if(!resourceRelevance(title,query))continue;try{const url=publicVideoUrl(href.replaceAll('&amp;','&'),first.url);if(new URL(url).origin===new URL(first.url).origin && url!==first.url)details.set(url,title)}catch{};if(details.size===3)break}
  await Promise.allSettled([...details].map(async([url,title])=>{
    const page=await requestSite(url,{fetcher,signal:deadline})
    const article=page.text.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] || page.text
    results.push(...extractQuarkResults([{title,content:article,source:site.name,sourceUrl:page.url}],first.url))
  }))
  return results
}
