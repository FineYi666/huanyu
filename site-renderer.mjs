import path from 'node:path'
import { stat, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { siteSearchUrl } from './resource-sites.mjs'

export function createSiteRenderer(root,data,{runner,now=Date.now}={}) {
  const queues=new Map(),verifications=new Map()
  async function nativeLaunch(site,mode,url,options={}) {
    const profile=path.join(data,'site-sessions',site.id)
    await mkdir(profile,{recursive:true})
    const input=Buffer.from(JSON.stringify({mode,url,profile,...options})).toString('base64url')
    let executable=path.join(root,'幻屿.exe'),args=['--mute-audio','--custom-site',input]
    if(!(await stat(executable).catch(()=>null))){executable=path.join(root,'node_modules','electron','dist','electron.exe');args=[path.join(root,'desktop','site-entry.cjs'),input]}
    if(!(await stat(executable).catch(()=>null)))throw new Error('网站读取和验证需要幻屿桌面版')
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const child=spawn(executable,args,{cwd:root,windowsHide:mode!=='verify',env,stdio:['ignore','pipe','pipe']})
    return new Promise((resolve,reject)=>{
      const chunks=[];let size=0
      child.stdout.on('data',part=>{size+=part.length;if(size>4*1024*1024)child.kill();else chunks.push(part)})
      child.stderr.resume()
      child.on('error',reject)
      child.on('close',()=>{
        // Decode once after collecting Buffers: concatenating each chunk as a
        // string can split a multi-byte Chinese character across chunk borders
        // and corrupt the JSON snapshot of a large DDYS episode playlist.
        const output=Buffer.concat(chunks).toString('utf8')
        const line=output.split(/\r?\n/).find(line=>line.startsWith('HUANYU_SITE_RESULT='))
        if(!line)return reject(new Error('网站读取未完成，请关闭网站验证窗口后重试'))
        try{resolve(JSON.parse(line.slice(19)))}catch{reject(new Error('网站返回数据无法读取'))}
      })
    })
  }
  const launch=runner || nativeLaunch
  function startVerification(site,automatic=false,target) {
    const previous=verifications.get(site.id)
    if(previous?.status==='pending' || (automatic && previous && now()-previous.openedAt<60000))return previous
    const entry={siteId:site.id,name:site.name,status:'pending',openedAt:now(),version:`${now()}-${Math.random()}`}
    verifications.set(site.id,entry)
    const location=target&&new URL(target).origin===new URL(site.url).origin?target:new URL(site.url).origin
    void Promise.resolve().then(()=>launch(site,'verify',location)).then(value=>{
      entry.status=value.verified?'complete':'cancelled'
      entry.message=value.error || ''
    }).catch(()=>{entry.status='cancelled';entry.message='验证窗口未完成，请重新打开'}).finally(()=>{entry.closedAt=now()})
    return entry
  }
  return {
    verificationStatus(){return [...verifications.values()].map(item=>({...item}))},
    async verify(site){if(queues.has(site.id))await queues.get(site.id).catch(()=>{});return startVerification(site)},
    async read(site,url,options={}) {
      if(verifications.get(site.id)?.status==='pending')throw Object.assign(new Error('请完成已打开的网站验证窗口，关闭后会自动继续搜索'),{needsVerification:true,siteId:site.id})
      const task=(queues.get(site.id)||Promise.resolve()).catch(()=>{}).then(()=>{
        if(verifications.get(site.id)?.status==='pending')return {needsVerification:true,error:'请先完成已打开的网站验证窗口'}
        return launch(site,options.apiUrl?'api':options.search?'search':'read',url,options)
      })
      queues.set(site.id,task)
      let value
      try{value=await task}finally{if(queues.get(site.id)===task)queues.delete(site.id)}
      if(value.error){
        if(value.needsVerification)startVerification(site,true,url)
        throw Object.assign(new Error(value.error),{needsVerification:value.needsVerification,siteId:site.id})
      }
      return value
    },
    search(site,query){const templated=site.url.includes('{query}');return this.read(site,siteSearchUrl(site,query),templated?{}:{search:true,query})},
    api(site,url){return this.read(site,new URL(site.url).origin,{apiUrl:url})},
  }
}
