import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.webm',
  '.mkv',
  '.mov',
  '.avi',
  '.ogv',
  '.mpeg',
  '.mpg',
  '.ts',
  '.m2ts',
  '.flv',
])
export const GAME_EXTENSIONS = new Set(['.exe', '.lnk'])
export const naturalSort = (a, b) =>
  a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' })
export const fileId = (file) =>
  createHash('sha256').update(file).digest('hex').slice(0, 24)
export const isVideo = (name) =>
  VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())
export const isGameFile = (name) =>
  GAME_EXTENSIONS.has(path.extname(name).toLowerCase())

export function parseRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size === 0)
    throw new Error('INVALID_RANGE')
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  let end = match[1] && match[2] ? Number(match[2]) : size - 1
  end = Math.min(end, size - 1)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new Error('INVALID_RANGE')
  return { start, end }
}

export async function scanVideos(input, limit = 12000) {
  const files = []
  const seen = new Set()
  const warnings = []
  async function walk(file, depth = 0) {
    if (depth > 24 || files.length >= limit)
      throw new Error(
        '目录过大，请选择更具体的视频文件夹（最多 12000 个视频、24 层目录）',
      )
    const info = await stat(file)
    if (info.isFile()) {
      if (isVideo(file) && !seen.has(file)) {
        seen.add(file)
        files.push({ path: file, name: path.basename(file), size: info.size })
      }
      return
    }
    if (!info.isDirectory()) return
    const entries = await readdir(file, { withFileTypes: true })
    for (const entry of entries) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith('.') ||
        entry.name === '$RECYCLE.BIN' ||
        entry.name === 'System Volume Information'
      )
        continue
      try {
        await walk(path.join(file, entry.name), depth + 1)
      } catch (error) {
        if (
          error.code === 'EACCES' ||
          error.code === 'EPERM' ||
          error.code === 'ENOENT'
        )
          warnings.push(entry.name)
        else throw error
      }
    }
  }
  for (const file of input) await walk(path.resolve(file))
  files.sort((a, b) => naturalSort(a.path, b.path))
  return { files, warnings }
}

export function parseQuarkShare(text, code = '') {
  const match = String(text || '').match(
    /https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:\?([^\s#，。]+))?/,
  )
  if (!match)
    throw new Error('请粘贴有效的夸克网盘分享链接：https://pan.quark.cn/s/…')
  const params = new URLSearchParams(match[2] || '')
  const passcode =
    code.trim() ||
    params.get('pwd') ||
    String(text).match(
      /(?:提取码|提取碼|密码|密碼)[:：\s]*([a-zA-Z0-9]{4,8})/,
    )?.[1] ||
    ''
  return {
    shareId: match[1],
    passcode,
    shareUrl: `https://pan.quark.cn/s/${match[1]}${passcode ? `?pwd=${encodeURIComponent(passcode)}` : ''}`,
  }
}
