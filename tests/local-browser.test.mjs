import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createLocalBrowser } from '../local-browser.mjs'

test('local picker browses folders and videos in natural order without modifying source files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yingyu-browse-'))
  await mkdir(path.join(directory, '第二季'))
  await mkdir(path.join(directory, '.hidden'))
  for (const name of [
    'Episode 10.MKV',
    'Episode 2.mp4',
    'Episode 1.mp4',
    'notes.txt',
  ])
    await writeFile(path.join(directory, name), 'unchanged')
  const browser = createLocalBrowser({ home: directory })
  const listing = await browser.browse({ path: directory })
  assert.equal(listing.current, directory)
  assert.equal(listing.parent, path.dirname(directory))
  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ['第二季', 'Episode 1.mp4', 'Episode 2.mp4', 'Episode 10.MKV'],
  )
  assert.equal(listing.entries[0].directory, true)
  assert.ok(
    listing.entries
      .slice(1)
      .every((entry) => !entry.directory && path.isAbsolute(entry.path)),
  )
  const nested = await browser.browse({ path: listing.entries[0].path })
  assert.deepEqual(nested.entries, [])
  assert.equal(nested.parent, directory)
  const root = await browser.browse()
  assert.equal(root.current, '')
  assert.ok(root.entries.every((entry) => entry.directory))
  await assert.rejects(browser.browse({ path: 'relative/path' }), {
    status: 400,
  })
  await assert.rejects(browser.browse({ path: 12 }), { status: 400 })
  await assert.rejects(
    browser.browse({ path: path.join(directory, 'missing') }),
    { status: 404 },
  )
  await assert.rejects(
    browser.browse({ path: path.join(directory, 'Episode 1.mp4') }),
    /不是文件夹/,
  )
})
