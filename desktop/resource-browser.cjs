const { app, BrowserWindow, session } = require('electron')
const path = require('node:path')

// Public search pages have their own temporary, unauthenticated browser session.
// They never share the library window's profile or the Quark account Cookie.
exports.run = async function run(encoded) {
  app.setPath(
    'userData',
    path.join(app.getPath('temp'), 'yingyu-public-search'),
  )
  let window
  const timer = setTimeout(() => app.exit(1), 55000)
  try {
    const queries = JSON.parse(Buffer.from(encoded, 'base64url').toString())
    if (
      !Array.isArray(queries) ||
      queries.length > 3 ||
      queries.some(
        (q) => typeof q !== 'string' || q.length < 2 || q.length > 150,
      )
    )
      throw new Error('搜索名称无效')
    await app.whenReady()
    const isolated = session.fromPartition('yingyu-public-search')
    isolated.setPermissionRequestHandler((_w, _p, done) => done(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', (event) => event.preventDefault())
    // The public search site shows a one-time popup before its redirect page
    // releases the Quark share. In a hidden window that popup is never clicked,
    // so no share is resolved. Remember the "already shown" preference to get
    // the plain redirect, without touching the site's security check.
    await isolated.cookies
      .set({
        url: 'https://www.zhongchuangwl.com/',
        name: 'popupShownToday',
        value: '1',
        path: '/',
      })
      .catch(() => {})
    let resolvedShare = '',
      resolving = false
    isolated.webRequest.onBeforeRequest((details, done) => {
      try {
        const u = new URL(details.url)
        if (
          resolving &&
          details.resourceType === 'mainFrame' &&
          u.protocol === 'https:' &&
          u.hostname === 'pan.quark.cn' &&
          /^\/s\/[a-zA-Z0-9]+$/.test(u.pathname)
        )
          resolvedShare = u.href
        done({
          cancel:
            u.protocol !== 'https:' ||
            ![
              'www.zhongchuangwl.com',
              'zhongchuangwl.com',
              's.699333.xyz',
              'api.699337.xyz',
            ].includes(u.hostname),
        })
      } catch {
        done({ cancel: true })
      }
    })
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Search pages are read-only helpers; never let a site preview play audio.
    window.webContents.setAudioMuted(true)
    const rows = [],
      failures = []
    const started = Date.now()
    for (const query of queries) {
      const sourceUrl = `https://www.zhongchuangwl.com/s/${encodeURIComponent(query)}/`
      try {
        // Let the site's normal JavaScript verification and search widgets load.
        // Human verification is reported; it is never solved or bypassed.
        void window.loadURL(sourceUrl).catch(() => {})
        const start = Date.now()
        let snapshot,
          loaded = false
        while (Date.now() - start < 20000) {
          await new Promise((resolve) => setTimeout(resolve, 400))
          try {
            snapshot = await window.webContents.executeJavaScript(
              `(() => ({url:location.href,title:document.title,ready:document.readyState,text:document.body?.innerText.slice(0,3000)||'',rows:Array.from(document.querySelectorAll('.pss')).slice(0,30).map(e=>({title:e.querySelector('h2')?.innerText||'',url:e.querySelector('h2 a')?.href||'',description:e.innerText.slice(0,1000)}))}))()`,
            )
          } catch {
            continue
          }
          if (snapshot.url !== sourceUrl) continue
          if (/验证码|人机验证|captcha/i.test(snapshot.title))
            throw new Error('来源需要人工验证，请在来源网站继续查找')
          if (
            snapshot.ready === 'complete' &&
            !/安全检查中/.test(snapshot.title)
          ) {
            // Dynamically supplied direct links can arrive after DOM load.
            await new Promise((resolve) => setTimeout(resolve, 900))
            snapshot = await window.webContents.executeJavaScript(
              `(() => ({rows:Array.from(document.querySelectorAll('.pss')).slice(0,30).map(e=>({title:e.querySelector('h2')?.innerText||'',url:e.querySelector('h2 a')?.href||'',description:e.innerText.slice(0,1000)}))}))()`,
            )
            loaded = true
            break
          }
        }
        if (!loaded || !snapshot?.rows)
          throw new Error('来源网页验证超时，请在来源网站继续查找')
        const publicRows = snapshot.rows.map((row) => ({ ...row, sourceUrl }))
        rows.push(
          ...publicRows.filter((row) =>
            row.url.startsWith('https://pan.quark.cn/s/'),
          ),
        )
        const details = publicRows
          .filter((row) =>
            /^https:\/\/www\.zhongchuangwl\.com\/n\/[a-zA-Z0-9]+\.html$/.test(
              row.url,
            ),
          )
          .filter(row => row.title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase().includes(query.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()))
          .filter(row => !/课程|教程|网课|数学|电子书/.test(row.title))
          .sort((a,b) => {
            const score = row => Number(/4k|2160|1080|蓝光/i.test(row.title))*4 + Number(/全\d+集|合集|全集/.test(row.title))*2 + Number(/4k|2160|1080|蓝光/i.test(row.description))
            return score(b) - score(a)
          })
          .slice(0, 6)
        for (const row of details) {
          if (Date.now() - started > 34000) break
          try {
            void window.loadURL(row.url).catch(() => {})
            let redirect = ''
            for (let attempt = 0; attempt < 12; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 250))
              const detail = await window.webContents
                .executeJavaScript(
                  `({url:location.href,link:document.querySelector('#pana')?.href||''})`,
                )
                .catch(() => null)
              if (
                detail?.url === row.url &&
                /^https:\/\/www\.zhongchuangwl\.com\/go\//.test(detail.link)
              ) {
                redirect = detail.link
                break
              }
            }
            if (!redirect) continue
            resolvedShare = ''
            resolving = true
            void window.loadURL(redirect).catch(() => {})
            for (let attempt = 0; attempt < 24 && !resolvedShare; attempt++)
              await new Promise((resolve) => setTimeout(resolve, 250))
            resolving = false
            if (resolvedShare) rows.push({ ...row, url: resolvedShare })
          } catch {
            resolving = false
          }
        }
      } catch (error) {
        failures.push(String(error.message).slice(0, 120))
      }
    }
    process.stdout.write(
      'YINGYU_SEARCH_RESULT=' +
        JSON.stringify({ rows, error: failures[0] || '' }) +
        '\n',
    )
  } catch {
    process.stdout.write(
      'YINGYU_SEARCH_RESULT={"rows":[],"error":"网页搜索暂时不可用"}\n',
    )
  } finally {
    clearTimeout(timer)
    window?.destroy()
    app.exit(0)
  }
}
