import path from 'node:path'
import os from 'node:os'
import { constants, existsSync } from 'node:fs'
import { copyFile, cp, mkdir } from 'node:fs/promises'

export function resolveAppData(root, options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  if (env.YINGYU_DATA_DIR) return path.resolve(env.YINGYU_DATA_DIR)
  const packaged = options.packaged ?? existsSync(path.join(root, 'resources', 'app.asar'))
  if (platform === 'win32' && packaged) {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Huanyu', 'data')
  }
  return path.join(root, 'data')
}

export async function prepareAppData(root, options = {}) {
  const destination = resolveAppData(root, options)
  await mkdir(destination, { recursive: true })
  const env = options.env || process.env
  const legacy = path.join(root, 'data')
  // Explicit data directories are isolated; never import a user's library into tests.
  if (env.YINGYU_DATA_DIR || destination === legacy ||
      existsSync(path.join(destination, 'library.json')) || !existsSync(path.join(legacy, 'library.json'))) return destination
  // Copy old user data once, without deleting the originals or copying stale PIDs.
  for (const name of ['covers', 'posters', 'subtitles', 'embedded-subtitles', 'deepseek.key', 'quark.key', 'recommendations.json']) {
    if (existsSync(path.join(legacy, name))) {
      await cp(path.join(legacy, name), path.join(destination, name), { recursive: true, force: false })
    }
  }
  try {
    await copyFile(path.join(legacy, 'library.json'), path.join(destination, 'library.json'), constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  return destination
}
