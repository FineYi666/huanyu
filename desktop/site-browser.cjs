const {app,BrowserWindow,session}=require('electron')
const {createHash}=require('node:crypto')
const path=require('node:path')
const fs=require('node:fs/promises')
const safe=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||/\.(local|internal|localhost)$/.test(u.hostname)||/^\d|:/.test(u.hostname))throw Error('网站地址不受支持');return u.href}
exports.run=async function(encoded){
  let window,timer,isolated
  const finish=value=>process.stdout.write('HUANYU_SITE_RESULT='+JSON.stringify(value)+'\n')
  try{
    const input=JSON.parse(Buffer.from(encoded,'base64url').toString())
    const base=safe(input.url)
    if(!['verify','read','search'].includes(input.mode)||typeof input.profile!=='string'||!path.isAbsolute(input.profile))throw Error('网站请求无效')
    app.setName('幻屿网站验证')
    app.setPath('userData',input.profile)
    await app.whenReady()
    isolated=session.fromPartition('persist:site')
    isolated.setPermissionRequestHandler((_w,_p,done)=>done(false));isolated.setPermissionCheckHandler(()=>false)
    isolated.on('will-download',event=>event.preventDefault())
    const media=new Set(),mediaHeaders={}
    isolated.webRequest.onBeforeSendHeaders((details,done)=>{
      if(/\.(m3u8|mp4|webm)(?:$|\?)/i.test(details.url)){
        const headers={}
        for(const [key,value] of Object.entries(details.requestHeaders))if(/^(Referer|Origin)$/i.test(key))headers[key]=value
        mediaHeaders[details.url]=headers
      }
      done({requestHeaders:details.requestHeaders})
    })
    isolated.webRequest.onBeforeRequest((details,done)=>{try{const u=new URL(details.url);if(['http:','file:','ftp:'].includes(u.protocol)||u.hostname==='localhost'||/^\d|:/.test(u.hostname)||/\.(local|internal|localhost)$/.test(u.hostname))return done({cancel:true});if(/\.(m3u8|mp4|webm)(?:$|\?)/i.test(u.href)&&!/(?:trailer|advert|\/ads?\/)/i.test(u.href))media.add(u.href);done({})}catch{done({cancel:true})}})
    window=new BrowserWindow({width:1250,height:900,show:input.mode==='verify',title:'幻屿 · 网站验证',autoHideMenuBar:true,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}})
    if(input.mode==='verify'){window.show();window.focus()}
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
    window.webContents.on('will-navigate',(event,url)=>{try{safe(url)}catch{event.preventDefault()}})
    timer=setTimeout(()=>{finish({error:'网站加载超时，请重新打开验证窗口'});if(window&&!window.isDestroyed())window.destroy();app.exit(0)},input.mode==='verify'?15*60*1000:24000)
    if(input.mode==='verify'){
      await window.loadURL(base)
      await new Promise(resolve=>window.once('closed',resolve))
      await isolated.cookies.flushStore();isolated.flushStorageData();finish({verified:true});return
    }
    await window.loadURL(base)
    const gate=async()=>window.webContents.executeJavaScript(`(()=>{const t=document.body?.innerText||'';return /游客访问|访问密码|图形验证码|人机验证|verify you are human|just a moment/i.test(t.slice(0,2200))||Array.from(document.querySelectorAll('input[type=password]')).some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')})()`)
    if(await gate()){finish({needsVerification:true,error:'网站需要登录或人工验证，请打开网站验证窗口完成后重试'});return}
    if(input.mode==='search' && typeof input.query==='string') {
      const searched=await window.webContents.executeJavaScript(`(()=>{const field=document.querySelector('input[name="s"],input[name="wd"],input[name="keyword"],input[type="search"]');if(!field||!field.form)return false;field.value=${JSON.stringify(input.query.slice(0,150))};field.form.requestSubmit();return true})()`)
      if(!searched){finish({error:'未识别到站内搜索框，请在设置中填写含 {query} 的搜索结果页地址'});return}
      await new Promise(resolve=>{const done=()=>{clearTimeout(wait);resolve()};const wait=setTimeout(done,5000);window.webContents.once('did-finish-load',done)})
    }
    await new Promise(resolve=>setTimeout(resolve,650))
    if(await gate()){finish({needsVerification:true,error:'网站需要人工验证，请打开网站验证窗口处理'});return}
    if(Number.isInteger(input.episodeIndex))await window.webContents.executeJavaScript(`(()=>{const e=document.querySelectorAll('.wp-playlist-item')[${Math.max(0,Math.min(input.episodeIndex,1000))}];e?.click()})()`)
    await window.webContents.executeJavaScript(`(()=>{for(const v of document.querySelectorAll('video')){v.muted=true;v.play().catch(()=>{})}})()`)
    if(input.mode==='read')await new Promise(resolve=>setTimeout(resolve,1500))
    const snapshot=await window.webContents.executeJavaScript(`(()=>{const root=document.querySelector('main')||document.body;return{url:location.href,title:document.querySelector('h1.entry-title,h1.title,h1')?.innerText||document.title,text:root.innerText.slice(0,4500),image:root.querySelector('article img,.entry-content img,.detail-pic img,img')?.src||'',links:Array.from(root.querySelectorAll('a[href]')).slice(0,1200).map(a=>({title:(a.getAttribute('title')||a.innerText).trim().slice(0,200),url:a.href,image:a.querySelector('img')?.src||''})),playlists:Array.from(document.querySelectorAll('script.wp-playlist-script')).slice(0,6).map(e=>e.textContent.slice(0,150000)),scripts:Array.from(document.scripts).filter(s=>!s.src&&/player_|m3u8|src0|src1|tracks/.test(s.textContent)).slice(0,12).map(s=>s.textContent.slice(0,150000)),videos:Array.from(document.querySelectorAll('video,source')).map(v=>v.currentSrc||v.src).filter(Boolean)}})()`)
    const extra=await window.webContents.executeJavaScript(`(()=>{const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return{documentTitle:document.title,visibleTitle:Array.from(document.querySelectorAll('h1,h2,h3,h4,h5')).find(e=>visible(e)&&e.innerText.trim()&&!/登录|注册|基本信息/.test(e.innerText))?.innerText||'',roadLabels:Array.from(document.querySelectorAll('[role=tab],.nav-tabs .nav-link')).map(e=>e.innerText.trim()).filter(Boolean)}})()`)
    finish({...snapshot,...extra,media:[...media].slice(0,12),mediaHeaders})
  }catch(error){finish({error:String(error.message).slice(0,200)})}
  finally{clearTimeout(timer);if(isolated)await isolated.cookies.flushStore().catch(()=>{});if(window&&!window.isDestroyed())window.destroy();app.exit(0)}
}
