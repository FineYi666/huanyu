import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { createSeasonalService, seasonAt } from '../seasonal.mjs'

const now = () => new Date('2026-10-26T00:00:00Z')
const archived = {
  id: 'seasonal-123456', title: '往届动画 第二季', subtitle: 'Archived Season 2',
  description: '往届作品简介', image: 'https://lain.bgm.tv/pic/cover/l/archive.jpg',
  airDate: '2026-04-10', platform: 'TV', score: 8.2, votes: 100,
  sourceUrl: 'https://bgm.tv/subject/123456',
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'huanyu-archive-test-'))
  const data = path.join(root, 'data')
  await mkdir(data)
  return { root, data }
}

test('viewed historical quarters persist and can be resolved after restart without a network request', async () => {
  const { root, data } = await fixture()
  let calls = 0
  const fetcher = async (url) => {
    calls++
    assert.match(String(url), /search\/subjects/)
    return Response.json({ total: 1, data: [{ id: 123456, type: 2, name_cn: archived.title,
      name: archived.subtitle, summary: archived.description, date: archived.airDate,
      platform: 'TV', rating: { score: 6, total: 10 }, images: { common: archived.image } }] })
  }
  const service = await createSeasonalService({ root, data, now, fetcher })
  const quarter = await service.view('2026-Q2')
  assert.equal(quarter.items[0].id, archived.id)
  assert.equal((await service.findSubject(archived.id)).title, archived.title)
  assert.equal(calls, 1)
  assert.equal(JSON.parse(await readFile(path.join(data, 'seasonal-archive', '2026-Q2.json'))).season.id, '2026-Q2')
  const restarted = await createSeasonalService({ root, data, now, fetcher: async () => { throw new Error('must use disk cache') } })
  assert.equal((await restarted.findSubject(archived.id)).title, archived.title)
  assert.equal((await restarted.view('2026-Q2')).items[0].id, archived.id)
})

test('cross-quarter search results remain resolvable without querying the current list', async () => {
  const { root, data } = await fixture()
  let calls = 0
  const service = await createSeasonalService({ root, data, now, fetcher: async (url) => {
    calls++
    assert.match(String(url), /search\/subjects/)
    return Response.json({ data: [{ id: 123456, name_cn: archived.title, platform: 'TV', date: archived.airDate }] })
  } })
  assert.equal((await service.search('往届')).results[0].id, archived.id)
  assert.equal((await service.findSubject(archived.id)).title, archived.title)
  assert.equal(calls, 1)
  assert.equal(await service.findSubject('../../private'), undefined)
  assert.equal(calls, 1)
})

test('uncached subjects use verified Bangumi details and reject mismatched or non-anime responses', async () => {
  const { root, data } = await fixture()
  const service = await createSeasonalService({ root, data, now, fetcher: async (url) => {
    const id = Number(String(url).split('/').pop())
    return Response.json({ id, type: id === 987654 ? 2 : 1, platform: 'TV', name_cn: '资料源作品', date: '2026-04-10' })
  } })
  assert.equal((await service.findSubject('seasonal-987654')).title, '资料源作品')
  assert.equal(await service.findSubject('seasonal-111111'), undefined)
})

test('archived titles import local and Quark episodes with trusted metadata while the current season stays unchanged', async (t) => {
  const { root: temp, data } = await fixture()
  const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const current = seasonAt()
  await writeFile(path.join(data, 'recommendations.json'), JSON.stringify({ season: current, updatedAt: new Date().toISOString(), items: [], slides: [] }))
  await writeFile(path.join(data, 'library.json'), JSON.stringify({ media: [], settings: { deepseekAuto: false } }))
  await mkdir(path.join(data, 'seasonal-archive'))
  await writeFile(path.join(data, 'seasonal-archive', '2026-Q2.json'), JSON.stringify({ season: { id: '2026-Q2' }, items: [archived], slides: [] }))
  const videoFolder = path.join(temp, 'local-video')
  await mkdir(videoFolder)
  await writeFile(path.join(videoFolder, '01.mp4'), 'fixture')
  const preload = path.join(temp, 'mock-fetch.mjs')
  await writeFile(preload, `globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'drive-pc.quark.cn' && url.pathname.endsWith('/share/sharepage/token')) return Response.json({code:0,data:{stoken:'fixture-token'}});
    if (url.hostname === 'drive-pc.quark.cn' && url.pathname.endsWith('/share/sharepage/detail')) return Response.json({code:0,data:{list:[{fid:'fixture-fid',file_name:'Episode 01.mp4',file_type:1,share_fid_token:'fixture-share-token',size:100}]}});
    if (url.href === 'https://api.bgm.tv/v0/subjects/987654') return Response.json({id:987654,type:2,platform:'TV',name_cn:'跨季度搜索作品',summary:'可信简介',date:'2026-01-10'});
    throw new Error('Unexpected external request in isolated test: ' + url.hostname + url.pathname);
  };`)
  const port = await new Promise((resolve) => {
    const socket = net.createServer()
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)) })
  })
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'server.mjs'], {
    cwd: appRoot, env: { ...process.env, YINGYU_DATA_DIR: data, YINGYU_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Startup timeout: ' + output)), 10000)
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('已启动')) { clearTimeout(timer); resolve() } })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
  })
  const origin = `http://127.0.0.1:${port}`
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
  const local = await post('/api/import/local', { paths: [videoFolder], subjectId: archived.id, title: '文件夹的非标准名称' })
  assert.equal(local.status, 200, await local.clone().text())
  const localState = await local.json()
  const localMedia = localState.media.find((item) => item.id === localState.ids[0])
  assert.equal(localMedia.title, archived.title)
  assert.equal(localMedia.subjectId, archived.id)
  assert.equal(localMedia.description, archived.description)
  assert.equal(localMedia.rating, '8.2')
  assert.equal(localMedia.episodes.length, 1)
  const quark = await post('/api/import/quark', { url: 'https://pan.quark.cn/s/archivetest123', subjectId: archived.id, title: archived.title })
  assert.equal(quark.status, 200, await quark.clone().text())
  const quarkState = await quark.json()
  const cloudMedia = quarkState.media.find((item) => item.id === quarkState.ids[0])
  assert.equal(cloudMedia.title, archived.title)
  assert.equal(cloudMedia.description, archived.description)
  assert.equal(cloudMedia.subjectId, archived.id)
  assert.equal(cloudMedia.source, 'quark')
  assert.equal(cloudMedia.episodes.length, 1)
  const cross = await post('/api/import/local', { paths: [videoFolder], subjectId: 'seasonal-987654', title: '不能信任此标题' })
  assert.equal(cross.status, 200, await cross.clone().text())
  assert.equal((await cross.json()).media.find((item) => item.id === localMedia.id).title, '跨季度搜索作品')
  const catalog = await (await fetch(origin + '/api/seasonal')).json()
  assert.equal(catalog.season.id, current.id)
  assert.deepEqual(catalog.items, [])
  const persisted = JSON.parse(await readFile(path.join(data, 'library.json'), 'utf8'))
  assert.equal(persisted.media.find((item) => item.id === cloudMedia.id).cover, archived.image)
  const recommended = JSON.parse(await readFile(path.join(appRoot, 'movie-seed.json'), 'utf8')).movies.find((movie) => movie.title === '星际穿越')
  const movieSearch = await (await fetch(origin + '/api/movie-seed?q=Interstellar&genre=' + encodeURIComponent('科幻'))).json()
  assert.equal(movieSearch.movies[0].id, recommended.id)
  const movieImport = await post('/api/import/quark', { url: 'https://pan.quark.cn/s/movietest123', subjectId: recommended.id, category: 'movie', title: '不可信电影名称' })
  assert.equal(movieImport.status, 200, await movieImport.clone().text())
  const movieState = await movieImport.json()
  const importedMovie = movieState.media.find((item) => item.id === movieState.ids[0])
  assert.equal(importedMovie.category, 'movie')
  assert.equal(importedMovie.title, recommended.title)
  assert.equal(importedMovie.year, recommended.year)
  assert.equal(importedMovie.cover, recommended.cover)
})
