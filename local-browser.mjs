import path from 'node:path'
import os from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import { isVideo, isGameFile, naturalSort } from './media-utils.mjs'

const hidden = (name) =>
  name.startsWith('.') ||
  name.startsWith('$') ||
  name === 'System Volume Information'
const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status })

export function createLocalBrowser({
  home = os.homedir(),
  platform = process.platform,
} = {}) {
  let cachedLocations,
    expires = 0
  async function locations() {
    if (cachedLocations && Date.now() < expires) return cachedLocations
    const drivePaths =
      platform === 'win32'
        ? [...'CDEFGHIJKLMNOPQRSTUVWXYZAB'].map((letter) => `${letter}:\\`)
        : ['/']
    const candidates = [
      ...drivePaths.map((directory) => ({
        name:
          platform === 'win32'
            ? `本地磁盘 (${directory.slice(0, 2)})`
            : '文件系统',
        path: directory,
        kind: 'drive',
      })),
      ...[
        ['Videos', '视频'],
        ['Downloads', '下载'],
        ['Desktop', '桌面'],
      ].map(([directory, name]) => ({
        name,
        path: path.join(home, directory),
        kind: 'shortcut',
      })),
    ]
    const checked = await Promise.all(
      candidates.map(async (location) => {
        try {
          return (await stat(location.path)).isDirectory() ? location : null
        } catch {
          return null
        }
      }),
    )
    cachedLocations = checked.filter(Boolean)
    expires = Date.now() + 30000
    return cachedLocations
  }
  return {
    async browse(input = {}) {
      if (typeof input.path !== 'undefined' && typeof input.path !== 'string')
        throw failure('请输入完整的文件夹路径')
      const requested = (input.path || '').trim().replace(/^"|"$/g, '')
      const roots = await locations()
      if (!requested)
        return {
          current: '',
          parent: null,
          locations: roots,
          entries: roots.map((root) => ({ ...root, directory: true })),
          total: roots.length,
          truncated: false,
        }
      if (
        requested.length > 32767 ||
        requested.includes('\0') ||
        !path.isAbsolute(requested)
      )
        throw failure('请输入完整的绝对文件夹路径，例如 D:\\我的视频')
      const current = path.resolve(requested)
      const gameMode = input.kind === 'game'
      let entries
      try {
        if (!(await stat(current)).isDirectory())
          throw failure(
            gameMode
              ? '此路径不是文件夹，请选择游戏所在的文件夹'
              : '此路径不是文件夹，请选择视频所在的文件夹',
          )
        entries = await readdir(current, { withFileTypes: true })
      } catch (error) {
        if (['EACCES', 'EPERM'].includes(error.code))
          throw failure(
            '没有权限打开这个文件夹，请选择有访问权限的文件夹',
            403,
          )
        if (['ENOENT', 'ENOTDIR'].includes(error.code))
          throw failure('文件夹不存在，可能已经移动或磁盘未连接', 404)
        throw error
      }
      const visible = entries
        .filter(
          (entry) =>
            !hidden(entry.name) &&
            !entry.isSymbolicLink() &&
            (entry.isDirectory() ||
              (entry.isFile() &&
                (gameMode ? isGameFile(entry.name) : isVideo(entry.name)))),
        )
        .sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) ||
            naturalSort(a.name, b.name),
        )
      const parent = path.dirname(current)
      return {
        current,
        parent: parent === current ? '' : parent,
        locations: roots,
        entries: visible
          .slice(0, 3000)
          .map((entry) => ({
            name: entry.name,
            path: path.join(current, entry.name),
            directory: entry.isDirectory(),
            kind: entry.isDirectory()
              ? 'folder'
              : gameMode
                ? 'game'
                : 'video',
          })),
        total: visible.length,
        truncated: visible.length > 3000,
      }
    },
  }
}
