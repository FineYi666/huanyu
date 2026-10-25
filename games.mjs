import path from 'node:path'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { fileId, isGameFile } from './media-utils.mjs'

const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status })
const USER_AGENT = 'YingyuGameShelf/1.0 (personal local media server)'
const STEAM_STORE = 'https://store.steampowered.com'
const IMAGE_HOSTS = ['steamstatic.com', 'steamcdn-a.akamaihd.net']

export const gameTitleFromPath = (filePath) => {
  const name = path.basename(filePath).replace(/\.(exe|lnk)$/i, '')
  return (name.trim() || '未命名游戏').slice(0, 120)
}

export function parseLaunchArgs(input) {
  const text = String(input || '')
  if (/[\r\n\0]/.test(text)) throw failure('启动参数不能包含换行或空字符')
  if (text.length > 300) throw failure('启动参数请控制在 300 字以内')
  const args = []
  for (const match of text.matchAll(/"([^"]*)"|(\S+)/g))
    args.push(match[1] ?? match[2])
  return args
}

export async function createGameEntry(input, deps = {}) {
  const check = deps.stat || stat
  const filePath = String(input?.path || '').trim().replace(/^"|"$/g, '')
  if (!filePath || !path.isAbsolute(filePath))
    throw failure('请提供游戏的完整路径，例如 D:\\Games\\Hades.exe')
  if (!isGameFile(filePath))
    throw failure('目前只支持导入 .exe 或 .lnk 游戏文件')
  let info
  try {
    info = await check(filePath)
  } catch (error) {
    if (error.code === 'ENOENT')
      throw failure('文件不存在，可能已经移动或删除', 404)
    if (['EACCES', 'EPERM'].includes(error.code))
      throw failure('没有权限访问这个文件', 403)
    throw error
  }
  if (!info.isFile()) throw failure('请选择游戏程序文件，而不是文件夹')
  const extension = path.extname(filePath).toLowerCase()
  return {
    id: `game-${fileId(filePath.toLowerCase())}`,
    title: gameTitleFromPath(filePath),
    exePath: filePath,
    workDir: extension === '.exe' ? path.dirname(filePath) : '',
    launchArgs: '',
    source: extension.slice(1),
    favorite: false,
    addedAt: Date.now(),
    playCount: 0,
    manual: {},
  }
}

export function launchGame(game, deps = {}) {
  const spawnFn = deps.spawn || spawn
  const platform = deps.platform || process.platform
  if (platform !== 'win32') throw failure('游戏启动目前仅支持 Windows')
  if (game.source === 'exe') {
    const child = spawnFn(game.exePath, parseLaunchArgs(game.launchArgs), {
      cwd: game.workDir || path.dirname(game.exePath),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.on?.('error', () => {})
    child.unref?.()
    return child
  }
  // 快捷方式交给系统解析目标、参数与工作目录；路径经 stdin 传递，避免命令行注入。
  const child = spawnFn(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      '$p=[Console]::In.ReadToEnd(); Start-Process -FilePath $p',
    ],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
  )
  child.stdin?.end(game.exePath)
  child.on?.('error', () => {})
  child.unref?.()
  return child
}

export function isAllowedGameImageUrl(input) {
  try {
    const url = new URL(input)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      IMAGE_HOSTS.some(
        (host) =>
          url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
  } catch {
    return false
  }
}

async function requestJson(url, fetcher) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  })
  if (!response.ok) throw failure('Steam 资料暂时无法获取')
  return await response.json()
}

export async function searchSteamGame(title, fetcher = fetch) {
  const query = String(title || '').trim().slice(0, 100)
  if (!query) return null
  const data = await requestJson(
    `${STEAM_STORE}/api/storesearch/?term=${encodeURIComponent(query)}&cc=CN&l=schinese`,
    fetcher,
  )
  const items = Array.isArray(data?.items) ? data.items : []
  const exact = items.find(
    (item) =>
      typeof item?.name === 'string' &&
      item.name.toLowerCase() === query.toLowerCase(),
  )
  return exact || items[0] || null
}

export async function fetchGameMetadata(title, fetcher = fetch) {
  const match = await searchSteamGame(title, fetcher)
  const appId = Number(match?.id)
  if (!Number.isSafeInteger(appId) || appId <= 0 || appId > 2147483647)
    return null
  const payload = await requestJson(
    `${STEAM_STORE}/api/appdetails?appids=${appId}&cc=CN&l=schinese`,
    fetcher,
  )
  const details = payload?.[String(appId)]
  if (!details?.success || !details.data) return null
  const data = details.data
  return {
    appId,
    title:
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : String(match.name || ''),
    description:
      typeof data.short_description === 'string'
        ? data.short_description.slice(0, 2000)
        : '',
    genre:
      typeof data.genres?.[0]?.description === 'string'
        ? data.genres[0].description
        : '',
    headerImage:
      typeof data.header_image === 'string' ? data.header_image : '',
  }
}

async function downloadImage(input, fetcher) {
  let url = input
  for (let redirect = 0; redirect < 4; redirect++) {
    if (!isAllowedGameImageUrl(url)) throw failure('封面地址不受支持')
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get('location') || '', url).href
      continue
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0]
    if (
      !response.ok ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(mime)
    )
      throw failure('封面不是有效的图片')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 6 * 1024 * 1024) throw failure('封面图片超过 6 MB')
      chunks.push(chunk)
    }
    const bytes = Buffer.concat(chunks)
    if (
      bytes.length < 8 ||
      !(
        (bytes[0] === 0xff && bytes[1] === 0xd8) ||
        bytes.subarray(1, 4).toString() === 'PNG' ||
        bytes.subarray(0, 4).toString() === 'RIFF'
      )
    )
      throw failure('封面不是有效的图片文件')
    return {
      bytes,
      extension:
        mime === 'image/jpeg'
          ? 'jpg'
          : mime === 'image/png'
            ? 'png'
            : 'webp',
    }
  }
  throw failure('封面地址重定向次数过多')
}

export async function downloadGameCover(appId, deps = {}) {
  const fetcher = deps.fetch || fetch
  const candidates = [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
  ]
  if (deps.headerImage && isAllowedGameImageUrl(deps.headerImage))
    candidates.push(deps.headerImage)
  let lastError
  for (const url of candidates) {
    try {
      return await downloadImage(url, fetcher)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || failure('封面暂时无法下载')
}

// 按名称搜索 Steam 候选（供手动纠错：exe 简称搜不到正确游戏时使用）。
export async function searchSteamApps(keyword, fetcher = fetch) {
  const query = String(keyword || '').trim().slice(0, 80)
  if (!query) return []
  const request = (url) =>
    fetcher(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Yingyu/1.3 (personal media library)' },
    })
  const response = await request(
    `${STEAM_STORE}/api/storesearch/?term=${encodeURIComponent(query)}&cc=CN&l=schinese`,
  )
  if (!response.ok) throw failure('Steam 搜索暂时不可用')
  const data = await response.json()
  return (Array.isArray(data?.items) ? data.items : [])
    .slice(0, 10)
    .map((item) => ({
      appId: Number(item.id),
      name: String(item.name || ''),
      image: String(item.tiny_image || ''),
    }))
    .filter(
      (item) =>
        Number.isSafeInteger(item.appId) &&
        item.appId > 0 &&
        item.name &&
        isAllowedGameImageUrl(item.image),
    )
}

// 拉取指定 Steam 应用的资料并下载封面（与应用到某个游戏前先取好）。
export async function fetchSteamAppDetail(appId, fetcher = fetch) {
  const id = Number(appId)
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647)
    throw failure('Steam 应用编号不正确')
  const payload = await (async () => {
    const response = await fetcher(
      `${STEAM_STORE}/api/appdetails?appids=${id}&cc=CN&l=schinese`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Yingyu/1.3 (personal media library)' },
      },
    )
    if (!response.ok) throw failure('Steam 资料暂时无法获取')
    return response.json()
  })()
  const details = payload?.[String(id)]
  if (!details?.success || !details.data) throw failure('没有找到这款游戏的 Steam 资料')
  const data = details.data
  return {
    appId: id,
    title: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '',
    description:
      typeof data.short_description === 'string'
        ? data.short_description.slice(0, 2000)
        : '',
    genre:
      typeof data.genres?.[0]?.description === 'string'
        ? data.genres[0].description
        : '',
    headerImage:
      typeof data.header_image === 'string' ? data.header_image : '',
  }
}
