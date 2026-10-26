const {
  app,
  BrowserWindow,
  Menu,
  shell,
  session,
  dialog,
  ipcMain,
  Tray,
  nativeImage,
} = require('electron')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { readFile, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { promisify } = require('node:util')
const { allowFullscreen } = require('./permissions.cjs')

app.setName('幻屿')
app.setAppUserModelId('cn.yingyu.cinema')
let window
let tray
let quitting = false
const closePrefs = { ask: true, action: 'tray' }
const isMac = process.platform === 'darwin'
const root = app.isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..')
const runtimeNode = path.join(
  root,
  'runtime',
  process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
)
const port = Number(process.env.YINGYU_PORT || 4317)
const origin = `http://127.0.0.1:${port}`
function external(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') void shell.openExternal(url.href)
  } catch {}
}
if (process.argv.includes('--public-resource-search')) {
  require('./resource-browser.cjs').run(
    process.argv[process.argv.indexOf('--public-resource-search') + 1],
  )
} else if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
  })
  app.whenReady().then(async () => {
    try {
      const { prepareAppData } = await import(pathToFileURL(path.join(root, 'app-data.mjs')).href)
      const userDataDirectory = await prepareAppData(root)
      if (isMac) {
        // 便携 zip 不保留可执行位，首次启动自动补齐。
        for (const target of [
          runtimeNode,
          path.join(root, 'runtime', 'ffmpeg'),
          path.join(root, 'runtime', 'ffprobe'),
        ])
          await promisify(execFile)('chmod', ['+x', target]).catch(() => {})
      }
      await promisify(execFile)(
        runtimeNode,
        [path.join(root, 'launch.mjs'), '--no-open'],
        {
          cwd: root,
          timeout: 30000,
          ...(process.platform === 'win32' ? { windowsHide: true } : {}),
        },
      )
      Menu.setApplicationMenu(null)
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback, details) => callback(contents === window?.webContents && details.isMainFrame !== false && allowFullscreen(permission, details.requestingUrl || contents.getURL(), origin)),
      )
      session.defaultSession.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>contents===window?.webContents && details.isMainFrame!==false && allowFullscreen(permission,requestingOrigin,origin))
      // 无系统标题栏：窗口按钮由页面顶栏自绘，随页面滚动，不遮挡任何内容。
      // macOS 保留系统红绿灯（hiddenInset），页面按平台避让。
      window = new BrowserWindow({
        width: 1500,
        height: 1000,
        minWidth: 1000,
        minHeight: 700,
        title: '幻屿',
        show: false,
        maximizable: true,
        fullscreenable: true,
        backgroundColor: '#13221f',
        icon: isMac ? undefined : path.join(root, 'dist', 'yingyu.ico'),
        titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          preload: path.join(__dirname, 'preload.cjs'),
        },
      })
      ipcMain.handle('window:minimize', () => window?.minimize())
      ipcMain.handle('window:toggleMaximize', () => {
        if (!window) return false
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        return window.isMaximized()
      })
      ipcMain.handle('window:close', () => window?.close())
      ipcMain.handle('window:hide', () => window?.hide())
      ipcMain.handle('app:quit', () => {
        quitting = true
        app.quit()
      })
      ipcMain.on('close-behavior:set', (_event, prefs) => {
        closePrefs.ask = prefs?.ask !== false
        closePrefs.action = prefs?.action === 'exit' ? 'exit' : 'tray'
      })
      // 用户点窗口 ×：按设置询问、最小化到托盘或直接退出。
      window.on('close', (event) => {
        if (quitting || isMac) return
        if (closePrefs.ask) {
          event.preventDefault()
          window.show()
          window.webContents.send('close:ask')
          return
        }
        if (closePrefs.action === 'tray') {
          event.preventDefault()
          window.hide()
        }
      })
      app.on('before-quit', () => {
        quitting = true
      })
      // 任务栏托盘：最小化到托盘后从这里找回窗口或退出。
      const trayImage = nativeImage.createFromPath(
        path.join(root, 'dist', 'yingyu-192.png'),
      )
      tray = new Tray(trayImage.isEmpty() ? path.join(root, 'dist', 'yingyu.ico') : trayImage)
      tray.setToolTip('幻屿')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: '打开幻屿',
            click: () => {
              if (window) {
                window.show()
                window.focus()
              }
            },
          },
          {
            label: '退出',
            click: () => {
              quitting = true
              app.quit()
            },
          },
        ]),
      )
      tray.on('click', () => {
        if (window) {
          window.show()
          window.focus()
        }
      })
      ipcMain.handle('window:isMaximized', () => Boolean(window?.isMaximized()))
      const sendMaximized = () =>
        window?.webContents.send('window:maximized', window.isMaximized())
      window.on('maximize', sendMaximized)
      window.on('unmaximize', sendMaximized)
      window.once('ready-to-show', () => window.show())
      window.webContents.setWindowOpenHandler(({ url }) => {
        external(url)
        return { action: 'deny' }
      })
      window.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== origin) {
          event.preventDefault()
          external(url)
        }
      })
      window.webContents.on('page-title-updated', (event) => {
        event.preventDefault()
        window.setTitle('幻屿')
      })
      window.webContents.on('did-finish-load', () => {
        void (async () => {
          let preloadBridge = false
          try {
            preloadBridge = await window.webContents.executeJavaScript(
              'Boolean(window.yingyuDesktop)',
              true,
            )
          } catch {}
          void writeFile(
            path.join(userDataDirectory, 'desktop-session.json'),
            JSON.stringify({
              pid: process.pid,
              name: app.name,
              version: app.getVersion(),
              electron: process.versions.electron,
              url: window.webContents.getURL(),
              sandbox: true,
              nodeIntegration: false,
              preloadBridge,
            }),
          ).catch(() => {})
        })()
      })
      const html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
      const build = html.match(/\/assets\/index-([\w-]+)\.js/)?.[1] || 'desktop'
      await window.loadURL(`${origin}/?v=${build}`)
    } catch (error) {
      dialog.showErrorBox('幻屿启动失败', String(error.message))
      app.quit()
    }
  })
  app.on('window-all-closed', () => app.quit())
}
