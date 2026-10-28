import path from 'node:path'
import { stat, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { siteSearchUrl } from './resource-sites.mjs'

export function createSiteRenderer(root,data) {
  const queues=new Map(),verifying=new Set()
  async function launch(site,mode,url,options={}) {
    const profile=path.join(data,'site-sessions',site.id)
    await mkdir(profile,{recursive:true})
    const input=Buffer.from(JSON.stringify({mode,url,profile,...options})).toString('base64url')
    let executable=path.join(root,'幻屿.exe'),args=['--custom-site',input]
    if(!(await stat(executable).catch(()=>null))){executable=path.join(root,'node_modules','electron','dist','electron.exe');args=[path.join(root,'desktop','site-entry.cjs'),input]}
    if(!(await stat(executable).catch(()=>null)))throw new Error('网站读取和验证需要幻屿桌面版')
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const child=spawn(executable,args,{cwd:root,windowsHide:mode!=='verify',env,stdio:['ignore','pipe','pipe']})
    return new Promise((resolve,reject)=>{let output='';child.stdout.on('data',part=>{output+=part;if(output.length>4*1024*1024)child.kill()});child.stderr.resume();child.on('error',reject);child.on('exit',()=>{const line=output.split(/\r?\n/).find(line=>line.startsWith('HUANYU_SITE_RESULT='));if(!line)return reject(new Error('网站读取未完成，请关闭网站验证窗口后重试'));try{resolve(JSON.parse(line.slice(19)))}catch{reject(new Error('网站返回数据无法读取'))}})})
  }
  return {
    async verify(site){if(verifying.has(site.id))return; if(queues.has(site.id))await queues.get(site.id).catch(()=>{});verifying.add(site.id);void launch(site,'verify',new URL(site.url).origin).catch(()=>{}).finally(()=>verifying.delete(site.id))},
    async read(site,url,options={}){if(verifying.has(site.id))throw new Error('请先完成网站验证并关闭验证窗口，再重新搜索');const task=(queues.get(site.id)||Promise.resolve()).catch(()=>{}).then(()=>launch(site,options.search?'search':'read',url,options));queues.set(site.id,task);try{const value=await task;if(value.error){const error=new Error(value.error);error.needsVerification=value.needsVerification;throw error}return value}finally{if(queues.get(site.id)===task)queues.delete(site.id)}},
    search(site,query){const templated=site.url.includes('{query}');return this.read(site,siteSearchUrl(site,query),templated?{}:{search:true,query})},
  }
}
