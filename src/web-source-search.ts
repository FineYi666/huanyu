import type { WebSourceResult } from './OnlinePlayer'
import type { VerificationSource } from './SiteVerificationNotice'

export type OnlineSourceStatus=VerificationSource&{name:string;status:string;count:number;message?:string}
export type OnlineSearchSnapshot={results:WebSourceResult[];sources:OnlineSourceStatus[];pending?:boolean;partial?:boolean;error?:string}
export async function searchOnlineSources(input:{keyword:string;subjectId?:string;category?:string;minHeight?:number;refresh?:boolean},signal:AbortSignal,update:(value:OnlineSearchSnapshot)=>void){
  const started=Date.now()
  let first=true
  while(!signal.aborted){
    const response=await fetch('/api/web-sources/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,progressive:true,refresh:first&&input.refresh}),signal})
    const value=await response.json() as OnlineSearchSnapshot
    if(signal.aborted)return
    if(!response.ok||value.error)throw Error(value.error||'在线搜索暂时不可用，请稍后重试')
    update(value)
    if(!value.pending)return
    if(Date.now()-started>90000){update({...value,pending:false,partial:true,sources:value.sources.map(source=>source.status==='loading'?{...source,status:'error',message:'网站响应较慢，稍后可重新查询'}:source)});return}
    first=false
    await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()}
      const timer=setTimeout(done,800)
      signal.addEventListener('abort',done,{once:true})
    })
  }
}
