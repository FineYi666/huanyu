import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises'
import { openSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { prepareAppData } from './app-data.mjs'
import { runtimeVersion } from './runtime-version.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.YINGYU_PORT || 4317)
const url = `http://127.0.0.1:${port}`
const expectedBuild = await runtimeVersion(root)
let stale = false
async function running() {
  try {
    const response = await fetch(url + '/api/health', {
      signal: AbortSignal.timeout(700),
    })
    const json = await response.json()
    if (json.app !== 'yingyu')
      throw new Error('端口已被其他软件占用，请设置 YINGYU_PORT 后重试')
    if (json.buildId !== expectedBuild) { stale = true; return false }
    return true
  } catch (error) {
    if (error.message.includes('端口')) throw error
    return false
  }
}
try {
  if (!process.argv.includes('--no-open')) {
    const nativeCandidates = [
      path.join(root, '幻屿.exe'),
      path.join(root, 'release', '幻屿-1.3.0-Windows-x64', '幻屿.exe'),
      path.join(root, '..', '映屿-1.3.0-Windows-x64', '幻屿.exe'),
    ]
    let executable
    for (const candidate of nativeCandidates) {
      try {
        await stat(candidate)
        executable = candidate
        break
      } catch {}
    }
    if (!executable)
      throw new Error('未找到幻屿桌面程序，请使用完整的 Windows 桌面版目录。')
    const window = spawn(executable, [], {
      cwd: path.dirname(executable),
      detached: true,
      stdio: 'ignore',
    })
    window.on('error', () =>
      console.error('幻屿桌面程序无法启动，请重新解压完整软件。'),
    )
    window.unref()
    console.log('已打开幻屿独立桌面窗口。')
    process.exit(0)
  }
  await stat(path.join(root, 'dist', 'index.html'))
  if (!(await running())) {
    const data = await prepareAppData(root)
    if (stale) {
      // Update only our own backend through its authenticated, graceful shutdown.
      // Never kill an arbitrary process merely because it owns the port.
      let stopped = false
      try {
        const session = JSON.parse(await readFile(path.join(data, 'session.json'), 'utf8'))
        if (session.port !== port || typeof session.token !== 'string') throw new Error('invalid launcher record')
        const response = await fetch(url + '/api/shutdown', { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify({token:session.token}), signal:AbortSignal.timeout(3000) })
        if (!response.ok) throw new Error('shutdown rejected')
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 200))
          try { await fetch(url + '/api/health', {signal:AbortSignal.timeout(500)}) }
          catch { stopped = true; break }
        }
      } catch {}
      if (!stopped) throw new Error('检测到旧版后台仍在运行，请完全退出幻屿（包括托盘）后重新打开。片库和登录信息已保留。')
      stale = false
    }
    await mkdir(data, { recursive: true })
    const log = openSync(path.join(data, 'server.log'), 'a')
    const errors = openSync(path.join(data, 'error.log'), 'a')
    const token = randomUUID()
    const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, errors],
      env: { ...process.env, YINGYU_STOP_TOKEN: token },
    })
    child.unref()
    await writeFile(
      path.join(data, 'session.json'),
      JSON.stringify({ port, token, pid: child.pid }),
    )
    let ready = false
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await running()) {
        ready = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!ready)
      throw new Error(
        `启动失败，请查看 ${path.join(data, 'error.log')}。`,
      )
  }
  console.log('幻屿后台已就绪。')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
