import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { prepareAppData, resolveAppData } from '../app-data.mjs'

test('packaged Windows apps store writable data in the user profile, independent of install drive', () => {
  const profile = path.join(os.tmpdir(), 'huanyu-profile')
  const options = { env: { LOCALAPPDATA: profile }, platform: 'win32', packaged: true }
  assert.equal(resolveAppData('D:\\Program Files\\幻屿', options), path.join(profile, 'Huanyu', 'data'))
  assert.equal(resolveAppData('E:\\Apps\\幻屿', options), path.join(profile, 'Huanyu', 'data'))
  assert.equal(resolveAppData('app', { ...options, env: { YINGYU_DATA_DIR: profile } }), path.resolve(profile))
  assert.equal(resolveAppData('dev', { ...options, packaged: false }), path.join('dev', 'data'))
})

test('legacy library, credentials and covers migrate once without overwriting existing user data or stale sessions', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'huanyu-data-test-'))
  const appRoot = path.join(base, 'application')
  const legacy = path.join(appRoot, 'data')
  await mkdir(path.join(legacy, 'covers'), { recursive: true })
  await writeFile(path.join(legacy, 'library.json'), '{"media":[{"title":"旧片库"}]}')
  await writeFile(path.join(legacy, 'quark.key'), 'encrypted-fixture')
  await writeFile(path.join(legacy, 'session.json'), '{"pid":12345}')
  await writeFile(path.join(legacy, 'covers', 'test.jpg'), 'cover-fixture')
  const options = { env: { LOCALAPPDATA: path.join(base, 'profile') }, platform: 'win32', packaged: true }
  const data = await prepareAppData(appRoot, options)
  assert.match(await readFile(path.join(data, 'library.json'), 'utf8'), /旧片库/)
  assert.equal(await readFile(path.join(data, 'quark.key'), 'utf8'), 'encrypted-fixture')
  assert.equal(await readFile(path.join(data, 'covers', 'test.jpg'), 'utf8'), 'cover-fixture')
  assert.equal(existsSync(path.join(data, 'session.json')), false)
  assert.equal(existsSync(path.join(legacy, 'library.json')), true)
  await writeFile(path.join(data, 'library.json'), '{"media":[{"title":"新片库"}]}')
  await prepareAppData(appRoot, options)
  assert.match(await readFile(path.join(data, 'library.json'), 'utf8'), /新片库/)
})

test('explicit test data directories never inherit the app user library', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'huanyu-isolated-data-'))
  await mkdir(path.join(base, 'app', 'data'), { recursive: true })
  await writeFile(path.join(base, 'app', 'data', 'library.json'), '{"private":true}')
  const data = await prepareAppData(path.join(base, 'app'), {
    env: { YINGYU_DATA_DIR: path.join(base, 'isolated') }, platform: 'win32', packaged: true,
  })
  assert.equal(existsSync(path.join(data, 'library.json')), false)
})
