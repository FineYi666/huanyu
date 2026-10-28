import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runtimeVersion } from '../runtime-version.mjs'
test('runtime identity detects changed search code but is stable across Windows line endings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'huanyu-version-'))
  await mkdir(path.join(root, 'dist'))
  const files = ['server.mjs', 'web-sources.mjs', 'resource-search.mjs', 'stream-probe.mjs', 'media-match.mjs', 'dist/index.html']
  for (const name of files) await writeFile(path.join(root, name), 'same\ncode\n')
  const initial = await runtimeVersion(root)
  for (const name of files) await writeFile(path.join(root, name), 'same\r\ncode\r\n')
  assert.equal(await runtimeVersion(root), initial)
  await writeFile(path.join(root, 'web-sources.mjs'), 'new search code')
  assert.notEqual(await runtimeVersion(root), initial)
})
