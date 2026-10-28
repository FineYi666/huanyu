import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export async function runtimeVersion(root) {
  const hash = createHash('sha256')
  for (const file of ['server.mjs', 'web-sources.mjs', 'resource-search.mjs', 'stream-probe.mjs', 'media-match.mjs', 'dist/index.html'])
    hash.update(file).update((await readFile(path.join(root, file), 'utf8')).replace(/\r\n/g, '\n'))
  return hash.digest('hex').slice(0, 20)
}
