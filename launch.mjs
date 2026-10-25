import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises'
import { openSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const root = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.YINGYU_PORT || 4317)
const url = `http://127.0.0.1:${port}`
async function running() {
  try {
    const response = await fetch(url + '/api/health', {
      signal: AbortSignal.timeout(700),
    })
    const json = await response.json()
    if (json.app !== 'yingyu')
      throw new Error('端口已被其他软件占用，请设置 YINGYU_PORT 后重试')
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
    const data = path.join(root, 'data')
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
        '启动失败，请查看 data/error.log。也可以在终端运行 node server.mjs 了解原因。',
      )
  }
  console.log('幻屿后台已就绪。')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
