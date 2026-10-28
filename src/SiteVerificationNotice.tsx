import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from './api'

export type VerificationSource = { needsVerification?: boolean; siteId?: string }
type Verification = { siteId:string; name:string; status:string; version:string }
export default function SiteVerificationNotice({sources,onVerified}:{sources:VerificationSource[];onVerified:()=>void}) {
  const ids=sources.filter(source=>source.needsVerification&&source.siteId).map(source=>source.siteId!).sort().join(',')
  const [message,setMessage]=useState('')
  const handled=useRef(new Set<string>()),retry=useRef(onVerified)
  retry.current=onVerified
  useEffect(()=>{
    if(!ids){setMessage('');return}
    let active=true,timer:ReturnType<typeof setTimeout>
    async function poll(){
      try{
        const value=await api<{sites:Verification[]}>('/search-sites/verification')
        if(!active)return
        const current=value.sites.filter(site=>ids.split(',').includes(site.siteId))
        const waiting=current.filter(site=>site.status==='pending')
        if(waiting.length)setMessage(`${waiting.map(site=>site.name).join('、')}的验证窗口已打开，请完成验证并关闭窗口，随后自动继续搜索。`)
        else {
          const complete=current.filter(site=>site.status==='complete'&&!handled.current.has(site.version))
          if(complete.length){complete.forEach(site=>handled.current.add(site.version));setMessage('验证窗口已关闭，正在继续搜索…');retry.current();return}
          setMessage('网站验证尚未完成，可在“搜索网站”中重新打开验证窗口，或稍后重试。')
        }
      }catch{if(active)setMessage('正在等待网站验证，请完成窗口中的验证后重试搜索。')}
      if(active)timer=setTimeout(()=>void poll(),1500)
    }
    void poll()
    return()=>{active=false;clearTimeout(timer)}
  },[ids])
  return message?<div className="site-verification-notice" role="status"><ShieldCheck size={17}/><span>{message}</span></div>:null
}
