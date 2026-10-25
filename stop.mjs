import { readFile, unlink } from 'node:fs/promises'
const file = new URL('./data/session.json', import.meta.url)
try {
  const session = JSON.parse(await readFile(file, 'utf8'))
  if (
    !Number.isInteger(session.port) ||
    session.port < 1024 ||
    session.port > 65535 ||
    typeof session.token !== 'string'
  )
    throw new Error('启动记录不正确')
  const response = await fetch(
    `http://127.0.0.1:${session.port}/api/shutdown`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.token }),
      signal: AbortSignal.timeout(3000),
    },
  )
  if (!response.ok)
    throw new Error((await response.json()).error || '结束服务失败')
  let stopped = false
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await fetch(`http://127.0.0.1:${session.port}/api/health`, {
        signal: AbortSignal.timeout(350),
      })
    } catch {
      stopped = true
      break
    }
  }
  if (!stopped) throw new Error('后台仍在关闭，请稍后重试，启动记录已保留')
  await unlink(file)
  console.log('幻屿后台已关闭，媒体库和观看进度已保留。')
} catch (error) {
  console.log(
    error.code === 'ENOENT'
      ? '没有找到启动记录，幻屿可能已经关闭。'
      : `无法关闭后台：${error.message}`,
  )
  process.exitCode = error.code === 'ENOENT' ? 0 : 1
}
