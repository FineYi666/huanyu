import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { downloadPoster, isAllowedPosterUrl } from './metadata.mjs'

export const posterKey = (url) => createHash('sha256').update(url).digest('hex').slice(0, 32)

// Only URLs registered from our catalog are reachable; clients cannot supply URLs.
export async function createPosterCache({ root, data, fetcher = fetch }) {
  const directory = path.join(data, 'posters')
  await mkdir(directory, { recursive: true })
  const sources = new Map(), pending = new Map(), failures = new Map()
  let active = 0
  const waiting = []
  function localize(url) {
    if (!isAllowedPosterUrl(url)) return url
    const key = posterKey(url)
    sources.set(key, url)
    return `/posters/${key}.img`
  }
  async function load(key) {
    for (const file of [path.join(directory, key), path.join(root, 'dist', 'posters', `${key}.img`)]) {
      try { return await readFile(file) } catch {}
    }
    if (!sources.has(key)) throw new Error('海报不存在')
    if (Date.now() - (failures.get(key) || 0) < 60000) throw new Error('海报暂时无法下载')
    if (active >= 4) await new Promise(resolve => waiting.push(resolve))
    active++
    try {
      const original = sources.get(key)
      const urls = [original]
      if (new URL(original).hostname === 'lain.bgm.tv') {
        urls.push(original.replace('lain.bgm.tv', 'lain.bangumi.tv'))
      }
      let image
      for (const url of urls) {
        try { image = await downloadPoster(url, AbortSignal.timeout(7000), fetcher); break } catch {}
      }
      if (!image) throw new Error('海报暂时无法下载')
      await writeFile(path.join(directory, `${key}.tmp`), image.bytes)
      await rename(path.join(directory, `${key}.tmp`), path.join(directory, key))
      failures.delete(key)
      return image.bytes
    } catch (error) { failures.set(key, Date.now()); throw error }
    finally { active--; waiting.shift()?.() }
  }
  return {
    localize,
    catalog(value) {
      const map = item => ({ ...item, image: localize(item.image) })
      return { ...value, items: value.items?.map(map), slides: value.slides.map(map) }
    },
    async read(key) {
      if (!/^[a-f0-9]{32}$/.test(key)) throw new Error('海报不存在')
      if (!pending.has(key)) pending.set(key, load(key).finally(() => pending.delete(key)))
      return pending.get(key)
    },
  }
}
