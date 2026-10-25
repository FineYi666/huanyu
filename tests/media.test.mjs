import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { parseRange, parseQuarkShare, scanVideos } from '../media-utils.mjs'

test('byte ranges: bounded, open, suffix, clamping and malformed requests', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 })
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 })
  assert.equal(parseRange(undefined, 100), null)
  for (const value of [
    'bytes=100-',
    'bytes=-0',
    'bytes=10-5',
    'bytes=0-1,5-8',
    'bytes=-',
    'not-a-range',
    'bytes=9007199254740999-',
  ])
    assert.throws(() => parseRange(value, 100))
  assert.throws(() => parseRange('bytes=0-', 0))
})

test('Quark share parsing handles pasted prose, encoded codes and rejects unrelated domains', () => {
  assert.deepEqual(
    parseQuarkShare(
      '我分享了影片：https://pan.quark.cn/s/abcd1234 提取码：x1y2',
    ),
    {
      shareId: 'abcd1234',
      passcode: 'x1y2',
      shareUrl: 'https://pan.quark.cn/s/abcd1234?pwd=x1y2',
    },
  )
  assert.equal(
    parseQuarkShare('https://pan.quark.cn/s/abcd?pwd=word#/list/share')
      .passcode,
    'word',
  )
  assert.equal(
    parseQuarkShare('https://pan.quark.cn/s/abcd?pwd=word', 'new1').passcode,
    'new1',
  )
  assert.throws(() => parseQuarkShare('https://pan.quark.cn.evil.test/s/abcd'))
  assert.throws(() => parseQuarkShare('http://127.0.0.1/admin'))
})

test('local library lifecycle, playback ranges, natural episode order, persistence and cross-site protection', async (t) => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const temp = await mkdtemp(path.join(os.tmpdir(), 'yingyu-test-'))
  const videoFolder = path.join(temp, '测试剧集')
  await mkdir(videoFolder)
  const bytes = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256))
  for (const name of ['Episode 10.mp4', 'Episode 2.mp4', 'Episode 1.mp4'])
    await writeFile(path.join(videoFolder, name), bytes)
  await writeFile(path.join(videoFolder, 'ignore.txt'), 'not a video')
  const scanned = await scanVideos([
    videoFolder,
    path.join(videoFolder, 'Episode 1.mp4'),
  ])
  assert.equal(scanned.files.length, 3)
  assert.deepEqual(
    scanned.files.map((f) => f.name),
    ['Episode 1.mp4', 'Episode 2.mp4', 'Episode 10.mp4'],
  )
  const port = await new Promise((resolve) => {
    const socket = net.createServer()
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port
      socket.close(() => resolve(port))
    })
  })
  const dataDir = path.join(temp, 'data')
  await mkdir(dataDir)
  // Start with a real v1.0 library: the upgrade must preserve its preferences and catalog.
  await writeFile(
    path.join(dataDir, 'library.json'),
    JSON.stringify({
      media: JSON.parse(
        await readFile(path.join(root, 'catalog.json'), 'utf8'),
      ),
      settings: { showSamples: true, autoNext: false, theme: 'dark' },
    }),
  )
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      YINGYU_PORT: String(port),
      YINGYU_DATA_DIR: dataDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => {
    child.kill()
  })
  let output = ''
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('server startup timeout: ' + output)),
      10000,
    )
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (output.includes('已启动')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
  })
  const origin = `http://127.0.0.1:${port}`
  async function call(route, data, method) {
    return fetch(origin + '/api' + route, {
      method: method || (data ? 'POST' : 'GET'),
      headers: data
        ? { 'Content-Type': 'application/json', Origin: origin }
        : {},
      body: data ? JSON.stringify(data) : undefined,
    })
  }
  assert.equal((await (await call('/health')).json()).ok, true)
  const folderListing = await (
    await call('/files/browse', { path: videoFolder })
  ).json()
  assert.equal(folderListing.current, videoFolder)
  assert.deepEqual(
    folderListing.entries.map((entry) => entry.name),
    ['Episode 1.mp4', 'Episode 2.mp4', 'Episode 10.mp4'],
  )
  assert.equal(
    (await call('/files/browse', { path: 'relative-folder' })).status,
    400,
  )
  assert.equal((await call('/pick', { mode: 'folder' })).status, 410)
  const initialState = await (await call('/state')).json()
  assert.equal(initialState.media.length, 12)
  assert.equal(initialState.settings.theme, 'dark')
  assert.equal(initialState.settings.autoNext, false)
  assert.equal(initialState.settings.skin, 'grove')
  assert.equal(initialState.settings.glass, true)
  assert.equal(initialState.settings.ambientMotion, true)
  assert.equal(initialState.settings.deepseekConnected, false)
  assert.equal(initialState.settings.deepseekAuto, true)
  assert.equal((await call('/metadata/enrich', { all: true })).status, 401)
  assert.equal((await call('/deepseek/connect', { apiKey: 'bad' })).status, 400)
  assert.equal(
    (await (await call('/export')).json()).settings.deepseekKey,
    undefined,
  )
  for (const skin of ['grove', 'aurora', 'ember', 'lunar', 'synth', 'gilded', 'glacier']) {
    const appearance = await (
      await call('/settings', { skin, glass: false, ambientMotion: false, theme: 'light' })
    ).json()
    assert.equal(appearance.settings.skin, skin)
    assert.equal(appearance.settings.glass, false)
    assert.equal(appearance.settings.autoNext, false)
    assert.equal(appearance.media.length, 12)
    const disk = JSON.parse(
      await readFile(path.join(dataDir, 'library.json'), 'utf8'),
    )
    assert.equal(disk.settings.skin, skin)
    assert.equal(disk.settings.glass, false)
    assert.equal(disk.settings.ambientMotion, false)
  }
  const invalidAppearance = await (
    await call('/settings', {
      skin: '../bad',
      glass: 'false',
      ambientMotion: 'true',
      theme: 'unknown',
    })
  ).json()
  assert.equal(invalidAppearance.settings.skin, 'glacier')
  assert.equal(invalidAppearance.settings.ambientMotion, false)
  assert.equal(invalidAppearance.settings.glass, false)
  assert.equal(invalidAppearance.settings.theme, 'light')
  assert.equal(
    (await (await call('/settings', { glass: true })).json()).settings.glass,
    true,
  )
  const importResponse = await call('/import/local', {
    paths: [videoFolder],
    title: '播放验证片段',
  })
  assert.equal(importResponse.status, 200)
  const imported = await importResponse.json()
  assert.equal(imported.count, 3)
  const media = imported.media.find((m) => m.source === 'local')
  assert.deepEqual(
    media.episodes.map((e) => e.name),
    ['Episode 1.mp4', 'Episode 2.mp4', 'Episode 10.mp4'],
  )
  assert.ok(
    !JSON.stringify(media).includes(temp),
    'API state must not leak local filesystem paths',
  )
  const repeated = await (
    await call('/import/local', { paths: [videoFolder] })
  ).json()
  assert.equal(repeated.media.filter((m) => m.source === 'local').length, 1)
  assert.equal(repeated.media.find((m) => m.id === media.id).episodes.length, 3)
  const play = await (
    await call('/play', { mediaId: media.id, episodeId: media.episodes[0].id })
  ).json()
  assert.equal(play.subtitleContext,'local')
  assert.equal((await call('/subtitles/embedded',{mediaId:media.id,episodeId:media.episodes[0].id,context:'local',url:'https://evil.test/video'})).status,400)
  const full = await fetch(origin + play.url)
  assert.equal(full.status, 200)
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes)
  for (const [range, start, end] of [
    ['bytes=50-99', 50, 99],
    ['bytes=500-', 500, 511],
    ['bytes=-5', 507, 511],
  ]) {
    const response = await fetch(origin + play.url, {
      headers: { Range: range },
    })
    assert.equal(response.status, 206)
    assert.equal(
      response.headers.get('content-range'),
      `bytes ${start}-${end}/512`,
    )
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      bytes.subarray(start, end + 1),
    )
  }
  assert.equal(
    (await fetch(origin + play.url, { headers: { Range: 'bytes=512-' } }))
      .status,
    416,
  )
  const head = await fetch(origin + play.url, { method: 'HEAD' })
  assert.equal(head.headers.get('content-length'), '512')
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  assert.equal(
    (
      await call('/progress', {
        mediaId: media.id,
        episodeId: media.episodes[0].id,
        time: 37,
        duration: 120,
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await call('/progress', {
        mediaId: media.id,
        episodeId: media.episodes[0].id,
        time: -1,
        duration: 120,
      })
    ).status,
    400,
  )
  await call(`/media/${media.id}`, { favorite: true, title: '新标题' }, 'PATCH')
  const persisted = JSON.parse(
    await readFile(path.join(dataDir, 'library.json'), 'utf8'),
  )
  const saved = persisted.media.find((m) => m.id === media.id)
  assert.equal(saved.title, '新标题')
  assert.equal(saved.favorite, true)
  assert.equal(saved.manual.title, true)
  assert.equal(saved.progress[media.episodes[0].id].time, 37)
  assert.equal(initialState.settings.subtitlesEnabled,true)
  assert.deepEqual(initialState.settings.subtitleStyle,{scale:100,x:50,y:90})
  const styled=await (await call('/settings',{subtitleStyle:{scale:150,x:60,y:15}})).json()
  assert.deepEqual(styled.settings.subtitleStyle,{scale:150,x:60,y:15})
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir,'library.json'),'utf8')).settings.subtitleStyle,styled.settings.subtitleStyle)
  const partialStyle=await (await call('/settings',{subtitleStyle:{scale:120}})).json()
  assert.deepEqual(partialStyle.settings.subtitleStyle,{scale:120,x:60,y:15})
  assert.equal((await (await call('/settings',{subtitlesEnabled:false})).json()).settings.subtitlesEnabled,false)
  for(const action of ['discover','search']) {
    const disabled=await (await call('/subtitles/'+action,{mediaId:media.id,episodeId:media.episodes[0].id})).json()
    assert.equal(disabled.disabled,true);assert.deepEqual(disabled.tracks,[])
  }
  assert.equal(JSON.parse(await readFile(path.join(dataDir,'library.json'),'utf8')).settings.subtitlesEnabled,false)
  await call('/settings',{subtitlesEnabled:true})
  const empty=path.join(temp,'empty');await mkdir(empty)
  assert.equal((await call(`/media/${media.id}/source`,{mode:'local',paths:[empty]})).status,400)
  assert.equal((await (await call('/state')).json()).media.find(m=>m.id===media.id).episodes.length,3)
  const fresh=path.join(temp,'Replacement.mp4');await writeFile(fresh,bytes)
  const replaced=await (await call(`/media/${media.id}/source`,{mode:'local',paths:[fresh]})).json()
  const updated=replaced.media.find(m=>m.id===media.id)
  assert.equal(replaced.replaced,true);assert.equal(replaced.media.length,imported.media.length)
  assert.equal(updated.title,'新标题');assert.equal(updated.favorite,true)
  assert.equal(updated.episodes.length,1);assert.deepEqual(updated.progress,{})
  assert.equal(persisted.settings.cookie, undefined)
  const attack = await fetch(origin + '/api/settings', {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  assert.equal(attack.status, 403)
  assert.equal(
    (
      await fetch(origin + '/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      })
    ).status,
    415,
  )
  const badHost = await new Promise((resolve, reject) => {
    const request = http.get(
      origin + '/api/state',
      { headers: { Host: 'untrusted.example' } },
      (response) => {
        response.resume()
        resolve(response.statusCode)
      },
    )
    request.on('error', reject)
  })
  assert.equal(badHost, 403)
  assert.equal(
    (await call('/import/quark', { url: 'not-a-share' })).status,
    400,
  )
  assert.equal(
    (await call('/play', { mediaId: media.id, episodeId: 'wrong' })).status,
    404,
  )
  const removed = await (await call(`/media/${media.id}`, {}, 'DELETE')).json()
  assert.equal(removed.media.filter((m) => m.source === 'local').length, 0)
  assert.equal(
    (await readFile(path.join(videoFolder, 'Episode 1.mp4'))).length,
    512,
  )
})
