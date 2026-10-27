import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { readFile, writeFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { scanVideos, fileId, parseRange } from './media-utils.mjs'
import { createQuark } from './quark.mjs'
import { SKIN_IDS, normalizeSettings } from './appearance.mjs'
import { normalizeSubtitleStyle } from './subtitle-style.mjs'
import { createSecretStore } from './secret-store.mjs'
import { createMetadataClient } from './metadata.mjs'
import { createMetadataQueue } from './metadata-jobs.mjs'
import { createSeasonalService } from './seasonal.mjs'
import { createPosterCache } from './poster-cache.mjs'
import { createLocalBrowser } from './local-browser.mjs'
import { createQuarkLogin } from './quark-login.mjs'
import { fetchVideoSource, rewritePlaylist } from './video-stream.mjs'
import { mediaCategory } from './media-category.mjs'
import { createResourceSearch } from './resource-search.mjs'
import { createGameResourceSearch } from './game-resources.mjs'
import { createMovieCatalog } from './movie-catalog.mjs'
import { createRenderedSearch } from './rendered-search.mjs'
import { createWebSources } from './web-sources.mjs'
import { qualityLabel } from './stream-quality.mjs'
import { publicVideoUrl } from './stream-probe.mjs'
import { episodeLayout } from './episode-seasons.mjs'
import { attachSeasonalMetadata } from './seasonal-metadata.mjs'
import { createSubtitleService } from './subtitle-service.mjs'
import { replaceMediaSource } from './replace-source.mjs'
import { createEmbeddedSubtitles, subtitleContainer } from './embedded-subtitles.mjs'
import { createGameEntry, fetchGameMetadata, downloadGameCover, launchGame, parseLaunchArgs, searchSteamApps, fetchSteamAppDetail } from './games.mjs'
import { prepareAppData } from './app-data.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const movieCatalog = await createMovieCatalog(ROOT)
const gameResources = createGameResourceSearch()
const importSubject = (id) => typeof id === 'string' && id.startsWith('douban-')
  ? movieCatalog.findSubject(id) : recommendations.findSubject(id)
const DATA = await prepareAppData(ROOT)
const PORT = Number(process.env.YINGYU_PORT || 4317)
const DEV = process.argv.includes('--dev')
const localBrowser = createLocalBrowser()
const resourceSearch = createResourceSearch({
  renderSearch: createRenderedSearch(ROOT),
})
const webSources = createWebSources()
await mkdir(DATA, { recursive: true })
await mkdir(path.join(DATA, 'covers'), { recursive: true })
const recommendations = await createSeasonalService({ root: ROOT, data: DATA })
const posters = await createPosterCache({ root: ROOT, data: DATA })
let state
try {
  state = JSON.parse(await readFile(path.join(DATA, 'library.json'), 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT')
    throw new Error(
      '媒体库数据读取失败。请先备份 data/library.json 再修复 JSON，程序不会覆盖原数据。',
    )
  const catalog = JSON.parse(
    await readFile(path.join(ROOT, 'catalog.json'), 'utf8'),
  )
  state = {
    media: catalog,
    settings: { showSamples: true, autoNext: true, theme: 'light' },
  }
}
state.settings = normalizeSettings(state.settings)
if (!Array.isArray(state.games)) state.games = []
let cookie = ''
let quarkStorageError = ''
const quarkStore = createSecretStore(DATA, 'quark.key')
try {
  cookie = await quarkStore.read()
} catch {
  quarkStorageError = '当前 Windows 账号无法读取保存的夸克登录，请重新扫码'
}
async function rememberQuark(value) {
  if (value) await quarkStore.write(value)
  else await quarkStore.remove()
  cookie = value
  quarkStorageError = ''
}
const quark = createQuark(() => cookie, { onCookie: rememberQuark })
const subtitles = await createSubtitleService({ data: DATA, quark })
const embeddedSubtitles = await createEmbeddedSubtitles({root:ROOT,data:DATA})
const secretStore = createSecretStore(DATA)
let deepseekKey = ''
let deepseekStorageError = ''
try {
  deepseekKey = await secretStore.read()
} catch {
  deepseekStorageError =
    '此 Windows 账号无法读取保存的 Key，请重新绑定 DeepSeek'
}
const metadataClient = createMetadataClient({
  getKey: () => deepseekKey,
  getModel: () => state.settings.deepseekModel,
})
const streamCache = new Map()
const quarkLogin = createQuarkLogin({
  async onConnected(value) {
    await rememberQuark(value)
    streamCache.clear()
  },
})
let saveQueue = Promise.resolve()
function save() {
  const json = JSON.stringify(state, null, 2)
  const operation = saveQueue
    .catch(() => {})
    .then(async () => {
      await writeFile(path.join(DATA, 'library.tmp'), json)
      await rename(
        path.join(DATA, 'library.tmp'),
        path.join(DATA, 'library.json'),
      )
    })
  saveQueue = operation
  return operation
}
const metadataQueue = createMetadataQueue({
  client: metadataClient,
  getMedia: (id) => state.media.find((media) => media.id === id),
  getKey: () => deepseekKey,
  save,
  async saveCover(id, image) {
    const name = `${fileId(id + '-metadata')}.${image.extension}`
    await writeFile(path.join(DATA, 'covers', name), image.bytes)
    return `/covers/${name}`
  },
})
for (const media of state.media)
  if (['queued', 'loading'].includes(media.metadataStatus))
    media.metadataStatus = 'idle'
function autoMetadata(ids) {
  return deepseekKey && state.settings.deepseekAuto
    ? metadataQueue.enqueue(ids)
    : 0
}
function publicMedia(media) {
  const { stoken, passcode, metadataInfo, subtitleFiles, ...clean } = media
  const layout = episodeLayout(media.episodes, media.title)
  return {
    ...clean,
    cover: posters.localize(clean.cover),
    category: mediaCategory(media),
    episodes: media.episodes.map(
      ({
        path: filePath,
        url,
        fid,
        shareToken,
        savedFid,
        parentFid,
        ...episode
      }, index) => ({...episode,season:layout[index].season,seasonGroup:layout[index].group,episodeNumber:layout[index].number}),
    ),
  }
}
function publicState() {
  return {
    media: state.media.map(publicMedia),
    games: state.games.map((game) => ({ ...game })),
    settings: {
      ...state.settings,
      quarkConnected: Boolean(cookie),
      quarkStorageError,
      deepseekConnected: Boolean(deepseekKey),
      deepseekStorageError,
    },
  }
}
const gameMetadataBusy = new Set()
async function enrichGame(id) {
  const game = state.games.find((item) => item.id === id)
  if (!game || gameMetadataBusy.has(id)) return null
  gameMetadataBusy.add(id)
  game.metadataStatus = 'loading'
  await save()
  try {
    const info = await fetchGameMetadata(game.title)
    if (!info || !state.games.includes(game)) {
      if (state.games.includes(game)) {
        game.metadataStatus = 'error'
        game.metadataError = '没有在 Steam 找到这款游戏的资料，可手动填写或上传封面'
        await save()
      }
      return null
    }
    const manual = game.manual || {}
    if (!manual.title && info.title) game.title = info.title
    if (!manual.description && info.description) game.description = info.description
    if (!manual.genre && info.genre) game.genre = info.genre
    if (!manual.cover && !game.cover) {
      try {
        const image = await downloadGameCover(info.appId, {
          headerImage: info.headerImage,
        })
        const name = `${fileId(`game-steam-${info.appId}`)}.${image.extension}`
        await writeFile(path.join(DATA, 'covers', name), image.bytes)
        game.cover = `/covers/${name}`
      } catch {}
    }
    game.metadataStatus = game.cover || game.description ? 'ready' : 'partial'
    delete game.metadataError
    await save()
    return info
  } catch {
    if (state.games.includes(game)) {
      game.metadataStatus = 'error'
      game.metadataError = '暂时连接不上 Steam，可稍后在详情页重试'
      await save()
    }
    return null
  } finally {
    gameMetadataBusy.delete(id)
  }
}
async function saveCoverImage(id, input) {
  const image = /^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(
    input?.image || '',
  )
  if (!image) {
    const error = new Error('请上传 JPG、PNG 或 WebP 图片')
    error.status = 400
    throw error
  }
  const name = `${fileId(id)}.${image[1] === 'jpeg' ? 'jpg' : image[1]}`
  await writeFile(path.join(DATA, 'covers', name), Buffer.from(image[2], 'base64'))
  return `/covers/${name}`
}
function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(data))
}
async function body(req, max = 6 * 1024 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > max) {
      const error = new Error('提交内容过大')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    const error = new Error('请求格式不正确')
    error.status = 400
    throw error
  }
}
function findEpisode(mediaId, episodeId) {
  const media = state.media.find((item) => item.id === mediaId)
  const episode = media?.episodes.find((item) => item.id === episodeId)
  if (!media || !episode) {
    const error = new Error('没有找到此视频')
    error.status = 404
    throw error
  }
  return { media, episode }
}
const MIME = {
  '.vtt': 'text/vtt; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
}
async function serveFile(req, res, file, media = false) {
  let info
  try {
    info = await stat(file)
  } catch {
    json(
      res,
      { error: media ? '源文件已移动或磁盘未连接，请重新导入' : '文件不存在' },
      404,
    )
    return
  }
  if (!info.isFile()) return json(res, { error: '文件不存在' }, 404)
  const headers = {
    'Content-Type':
      MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': media
      ? 'private, no-store'
      : path.extname(file) === '.html'
        ? 'no-store'
        : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  }
  let range
  try {
    range = parseRange(req.headers.range, info.size)
  } catch {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` })
    res.end()
    return
  }
  const start = range?.start ?? 0
  const end = range?.end ?? info.size - 1
  res.writeHead(range ? 206 : 200, {
    ...headers,
    'Content-Length': Math.max(0, end - start + 1),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
  })
  if (req.method === 'HEAD' || info.size === 0) {
    res.end()
    return
  }
  const stream = fs.createReadStream(file, { start, end })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

async function proxyVideo(req, res, source, localOrigin) {
  const abort = new AbortController()
  req.on('close', () => {
    if (!req.complete) abort.abort()
  })
  res.on('close', () => abort.abort())
  const upstream = await fetchVideoSource(source, {
    range: req.headers.range,
    signal: abort.signal,
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
  })
  if (!upstream.ok && upstream.status !== 206)
    throw new Error(
      `视频源返回 ${upstream.status}，请重新打开播放或使用官方网页`,
    )
  const type = upstream.headers.get('content-type') || 'video/mp4'
  if (
    source.format === 'hls' ||
    /mpegurl/i.test(type) ||
    new URL(source.url).pathname.endsWith('.m3u8')
  ) {
    const playlist = await upstream.text()
    function proxyUrl(url) {
      if(source.web)publicVideoUrl(url)
      const token = randomUUID()
      streamCache.set(token, {
        url,
        headers: source.headers,
        web: source.web,
        expires: Date.now() + 4 * 3600000,
      })
      return `${localOrigin}/api/stream/${token}`
    }
    const content = rewritePlaylist(
      playlist,
      upstream.url || source.url,
      proxyUrl,
    )
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
    })
    res.end(content)
    return
  }
  const responseHeaders = {
    'Cache-Control': 'no-store',
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
  }
  for (const name of ['content-length', 'content-range', 'accept-ranges'])
    if (upstream.headers.has(name))
      responseHeaders[name] = upstream.headers.get(name)
  res.writeHead(upstream.status, responseHeaders)
  if (req.method === 'HEAD' || !upstream.body) {
    res.end()
    return
  }
  const stream = Readable.fromWeb(upstream.body)
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

let vite
if (DEV) {
  const { createServer } = await import('vite')
  vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'spa',
  })
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || ''
    if (!new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]).has(host))
      return json(res, { error: '仅允许本机访问' }, 403)
    const origin = `http://${host}`
    if (req.headers.origin && req.headers.origin !== origin)
      return json(res, { error: '不允许跨站访问' }, 403)
    const url = new URL(req.url, origin)
    const route = url.pathname
    if (
      route.startsWith('/api/') &&
      !['GET', 'HEAD'].includes(req.method) &&
      !req.headers['content-type']?.startsWith('application/json')
    )
      return json(res, { error: '请求格式不正确' }, 415)
    if (route === '/api/state' && req.method === 'GET')
      return json(res, publicState())
    if (route === '/api/health')
      return json(res, { ok: true, app: 'yingyu', version: '1.3.0' })
    if (route === '/api/recommendations' && req.method === 'GET')
      return json(res, posters.catalog(recommendations.get()))
    if (route === '/api/seasonal' && req.method === 'GET')
      return json(res, posters.catalog(recommendations.get()))
    if (route === '/api/skin-background' && req.method === 'POST') {
      const input = await body(req, 12 * 1024 * 1024)
      const image =
        /^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(
          input?.image || '',
        )
      if (!image)
        return json(res, { error: '请上传 JPG、PNG 或 WebP 图片' }, 400)
      const bytes = Buffer.from(image[2], 'base64')
      if (bytes.length > 8 * 1024 * 1024)
        return json(res, { error: '背景图片过大，请压缩后重试' }, 413)
      const extension = image[1] === 'jpeg' ? 'jpg' : image[1]
      await writeFile(
        path.join(DATA, `skin-background.${extension}`),
        bytes,
      )
      for (const stale of ['skin-background.jpg', 'skin-background.png', 'skin-background.webp'])
        if (stale !== `skin-background.${extension}`)
          await unlink(path.join(DATA, stale)).catch(() => {})
      const version = randomUUID()
      state.settings.customBackgroundVersion = version
      await save()
      return json(res, { ok: true, version, url: `/skin-background?v=${version}` })
    }
    if (route === '/api/movie-seed' && req.method === 'GET') {
      return json(res, movieCatalog.get({ query: url.searchParams.get('q') || '', genre: url.searchParams.get('genre') || '全部', sort: url.searchParams.get('sort') || 'rank' }))
    }
    if (route === '/api/seasonal/seasons' && req.method === 'GET')
      return json(res, { seasons: recommendations.seasons() })
    if (route === '/api/seasonal/search' && req.method === 'GET') {
      try {
        return json(res, await recommendations.search(url.searchParams.get('q') || ''))
      } catch (error) {
        return json(
          res,
          { error: error.message || '跨季度搜索暂时不可用' },
          error.status || 502,
        )
      }
    }
    if (route === '/api/seasonal/view' && req.method === 'GET') {
      try {
        return json(
          res,
          posters.catalog(await recommendations.view(url.searchParams.get('key') || '')),
        )
      } catch (error) {
        return json(
          res,
          { error: error.message || '该季度的片单暂时无法获取' },
          error.status || 502,
        )
      }
    }
    if (route === '/api/seasonal/refresh' && req.method === 'POST') {
      await body(req)
      return json(res, posters.catalog(await recommendations.update()))
    }
    if (route === '/api/resources/search' && req.method === 'POST') {
      const input = await body(req)
      const subject = await Promise.resolve(importSubject(input.subjectId)).catch(() => undefined)
      const useAliases =
        subject &&
        [subject.title, subject.subtitle].includes(input.query?.trim())
      return json(
        res,
        await resourceSearch.search(
          input.query,
          useAliases ? [subject.title, subject.subtitle] : [],
        ),
      )
    }
    if (route === '/api/shutdown' && req.method === 'POST') {
      const input = await body(req)
      if (
        !process.env.YINGYU_STOP_TOKEN ||
        input.token !== process.env.YINGYU_STOP_TOKEN
      )
        return json(
          res,
          { error: '无法验证启动器，请从启动幻屿.cmd 启动' },
          403,
        )
      json(res, { ok: true })
      setTimeout(shutdown, 100)
      return
    }
    if (route === '/api/files/browse' && req.method === 'POST') {
      return json(res, await localBrowser.browse(await body(req)))
    }
    if (route === '/api/pick' && req.method === 'POST') {
      await body(req)
      return json(res, { error: '文件选择器已更新，请刷新页面后重新选择' }, 410)
    }
    const replaceRoute=/^\/api\/media\/([^/]+)\/source$/.exec(route)
    if(replaceRoute && req.method==='POST') {
      const input=await body(req), id=replaceRoute[1]
      const current=state.media.find(item=>item.id===id)
      if(!current)return json(res,{error:'作品不存在'},404)
      const revision=current.sourceRevision || 0
      let incoming
      if(input.mode==='quark')incoming=await quark.importShare(input.url,input.code || '',current.title)
      else if(input.mode==='local') {
        const paths=Array.isArray(input.paths)?input.paths:[]
        if(!paths.length || paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))return json(res,{error:'请选择新视频或完整文件夹路径，原资源已保留'},400)
        const {files}=await scanVideos(paths)
        incoming={source:'local',episodes:files.map(file=>({id:fileId(file.path),name:file.name,path:file.path,size:file.size}))}
      }else return json(res,{error:'请选择本地视频或夸克资源'},400)
      const index=state.media.indexOf(current)
      if(!incoming.episodes?.length)return json(res,{error:'新资源中没有可用视频，原资源已保留'},400)
      if(index<0 || (current.sourceRevision || 0)!==revision)return json(res,{error:'资源已发生变化，请重新打开作品后再试'},409)
      const replacement=replaceMediaSource(current,incoming)
      state.media[index]=replacement
      try {await save()}catch(error){if(state.media[index]===replacement)state.media[index]=current;throw error}
      return json(res,{ids:[current.id],count:replacement.episodes.length,replaced:true,...publicState()})
    }
    if (route === '/api/import/local' && req.method === 'POST') {
      const input = await body(req)
      const subject = await importSubject(input.subjectId)
      if (input.subjectId && !subject)
        return json(res, { error: '无法识别这部作品的资料，请重新打开作品后重试' }, 400)
      if (subject && input.splitByFolder)
        return json(res, { error: '关联单部新番时请选择该作品的文件夹' }, 400)
      const paths = Array.isArray(input.paths) ? input.paths : []
      if (
        !paths.length ||
        paths.some((p) => typeof p !== 'string' || !path.isAbsolute(p))
      )
        return json(res, { error: '请选择视频或填写完整的绝对文件夹路径' }, 400)
      const { files, warnings } = await scanVideos(paths)
      if (!files.length)
        return json(
          res,
          { error: '此文件夹没有找到视频，支持 MP4、WebM、MKV、MOV 等格式' },
          400,
        )
      const groups = new Map()
      const singleFolder =
        paths.length === 1 && (await stat(paths[0])).isDirectory()
          ? path.resolve(paths[0])
          : null
      for (const file of files) {
        const parent = path.dirname(file.path)
        const key = input.splitByFolder
          ? parent
          : singleFolder || path.dirname(files[0].path)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(file)
      }
      const ids = []
      for (const [folder, episodes] of groups) {
        const id = `local-${fileId(folder)}`
        const existing = state.media.find((media) => media.id === id)
        const items = episodes.map((file) => ({
          id: fileId(file.path),
          name: file.name,
          path: file.path,
          size: file.size,
        }))
        if (existing) {
          const merged = new Map(
            existing.episodes.map((episode) => [episode.id, episode]),
          )
          for (const episode of items) merged.set(episode.id, episode)
          existing.episodes = [...merged.values()].sort((a, b) =>
            a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
          )
          if (input.title?.trim()) {
            existing.title = input.title.trim().slice(0, 150)
            existing.manual = { ...existing.manual, title: true }
          }
          if (['anime', 'movie'].includes(input.category)) {
            existing.category = input.category
            existing.manual = { ...existing.manual, category: true }
          }
        } else {
          const title =
            input.title?.trim().slice(0, 150) || path.basename(folder)
          const match = state.media.find(
            (item) =>
              item.source === 'sample' &&
              title.replace(/[\s！!。△]/g, '') ===
                item.title.replace(/[\s！!。△]/g, ''),
          )
          state.media.unshift({
            id,
            title,
            cover: match?.cover,
            description: match?.description,
            subtitle: match?.subtitle,
            year: match?.year,
            episodes: items,
            source: 'local',
            category: ['anime', 'movie'].includes(input.category)
              ? input.category
              : mediaCategory(match || {}),
            genre: input.genre || match?.genre || '未分类',
            addedAt: Date.now(),
            manual: {
              title: Boolean(input.title?.trim()),
              category: ['anime', 'movie'].includes(input.category),
            },
          })
        }
        attachSeasonalMetadata(
          state.media.find((item) => item.id === id),
          subject,
        )
        ids.push(id)
      }
      const metadataQueued = subject ? 0 : autoMetadata(ids)
      await save()
      return json(res, {
        ids,
        count: files.length,
        warnings,
        metadataQueued,
        ...publicState(),
      })
    }
    if (route === '/api/import/quark' && req.method === 'POST') {
      const input = await body(req)
      const subject = await importSubject(input.subjectId)
      if (input.subjectId && !subject)
        return json(res, { error: '无法识别这部作品的资料，请重新打开作品后重试' }, 400)
      const media = await quark.importShare(
        input.url,
        input.code || '',
        input.title,
      )
      const match = state.media.find(
        (item) => item.source === 'sample' && media.title === item.title,
      )
      attachSeasonalMetadata(media, subject)
      if (match)
        Object.assign(media, {
          cover: match.cover,
          description: match.description,
          genre: match.genre,
          subtitle: match.subtitle,
          year: match.year,
        })
      const existing = state.media.find((item) => item.id === media.id)
      if (['anime', 'movie'].includes(input.category))
        media.category = input.category
      if (existing) {
        const oldEpisodes = new Map(
          existing.episodes.map((episode) => [episode.id, episode]),
        )
        media.episodes = media.episodes.map((episode) => ({
          ...oldEpisodes.get(episode.id),
          ...episode,
        }))
        Object.assign(existing, media, {
          favorite: existing.favorite,
          progress: existing.progress,
          cover: existing.cover,
          title: input.title?.trim() ? media.title : existing.title,
          description: existing.description || media.description,
          genre: existing.genre || media.genre,
          subtitle: existing.subtitle || media.subtitle,
          year: existing.year || media.year,
          category: media.category || mediaCategory(existing),
          manual: {
            ...existing.manual,
            ...(input.title?.trim() ? { title: true } : {}),
            ...(['anime', 'movie'].includes(input.category)
              ? { category: true }
              : {}),
          },
        })
      } else {
        media.manual = {
          title: Boolean(input.title?.trim()),
          category: ['anime', 'movie'].includes(input.category),
          ...(subject
            ? { title: true, description: true, cover: true, category: true }
            : {}),
        }
        state.media.unshift(media)
      }
      attachSeasonalMetadata(existing || media, subject)
      const metadataQueued = subject ? 0 : autoMetadata([media.id])
      await save()
      return json(res, {
        ids: [media.id],
        count: media.episodes.length,
        metadataQueued,
        ...publicState(),
      })
    }
    if (route === '/api/settings' && req.method === 'POST') {
      const input = await body(req)
      for (const key of ['showSamples', 'autoNext', 'glass', 'ambientMotion', 'deepseekAuto', 'subtitlesEnabled', 'closeAsk'])
        if (typeof input[key] === 'boolean') state.settings[key] = input[key]
      if (['tray', 'exit'].includes(input.closeAction)) state.settings.closeAction = input.closeAction
      if (
        typeof input.customAccent === 'string' &&
        /^#[0-9a-fA-F]{6}$/.test(input.customAccent)
      )
        state.settings.customAccent = input.customAccent
      if (
        typeof input.customBase === 'string' &&
        /^#[0-9a-fA-F]{6}$/.test(input.customBase)
      )
        state.settings.customBase = input.customBase
      if (typeof input.customDark === 'boolean')
        state.settings.customDark = input.customDark
      if (['light', 'dark'].includes(input.theme))
        state.settings.theme = input.theme
      if (SKIN_IDS.includes(input.skin)) state.settings.skin = input.skin
      if (input.subtitleStyle && typeof input.subtitleStyle === 'object') state.settings.subtitleStyle = normalizeSubtitleStyle({...state.settings.subtitleStyle,...input.subtitleStyle})
      if (state.settings.deepseekModels.includes(input.deepseekModel))
        state.settings.deepseekModel = input.deepseekModel
      await save()
      return json(res, publicState())
    }
    if (route === '/api/deepseek/connect' && req.method === 'POST') {
      const input = await body(req)
      const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
      if (key.length < 12 || key.length > 500 || !/^[a-zA-Z0-9._-]+$/.test(key))
        return json(res, { error: '请输入有效的 DeepSeek API Key' }, 400)
      const models = await metadataClient.models(key)
      await secretStore.write(key)
      metadataQueue.cancel()
      deepseekKey = key
      deepseekStorageError = ''
      state.settings.deepseekModels = models
      if (!models.includes(state.settings.deepseekModel))
        state.settings.deepseekModel = models[0]
      await save()
      return json(res, publicState())
    }
    if (route === '/api/deepseek/disconnect' && req.method === 'POST') {
      await body(req)
      metadataQueue.cancel()
      deepseekKey = ''
      deepseekStorageError = ''
      await secretStore.remove()
      await save()
      return json(res, publicState())
    }
    if (route === '/api/metadata/enrich' && req.method === 'POST') {
      const input = await body(req)
      if (!deepseekKey)
        return json(res, { error: '请先在设置中绑定 DeepSeek API Key' }, 401)
      const ids =
        input.all === true
          ? state.media
              .filter((media) => media.source !== 'sample')
              .map((media) => media.id)
          : [input.id]
      if (!input.all && !state.media.some((media) => media.id === input.id))
        return json(res, { error: '作品不存在' }, 404)
      const queued = metadataQueue.enqueue(ids)
      await save()
      return json(res, { queued, ...publicState() })
    }
    if (route === '/api/quark/qr/start' && req.method === 'POST') {
      await body(req)
      return json(res, await quarkLogin.start())
    }
    if (route === '/api/quark/qr/status' && req.method === 'POST') {
      const input = await body(req)
      const result = await quarkLogin.poll(input.sessionId)
      return json(
        res,
        result.status === 'connected'
          ? { ...result, ...publicState() }
          : result,
      )
    }
    if (route === '/api/quark/qr/cancel' && req.method === 'POST') {
      const input = await body(req)
      quarkLogin.cancel(input.sessionId)
      return json(res, { ok: true })
    }
    if (route === '/api/quark/connect' && req.method === 'POST') {
      const input = await body(req)
      if (
        typeof input.cookie !== 'string' ||
        input.cookie.length > 15000 ||
        /[\r\n]/.test(input.cookie)
      )
        return json(res, { error: '请输入有效的 Cookie（不要包含换行）' }, 400)
      if (!input.cookie) {
        quarkLogin.cancelAll()
        await rememberQuark('')
        streamCache.clear()
        return json(res, publicState())
      }
      const previous = cookie
      cookie = input.cookie.trim()
      try {
        await quark.checkAccount()
        await rememberQuark(cookie)
      } catch (error) {
        cookie = previous
        throw error
      }
      return json(res, publicState())
    }
    const mediaRoute = /^\/api\/media\/([^/]+)$/.exec(route)
    if (mediaRoute) {
      const media = state.media.find((item) => item.id === mediaRoute[1])
      if (!media) return json(res, { error: '作品不存在' }, 404)
      if (req.method === 'PATCH') {
        const input = await body(req)
        if (['anime', 'movie'].includes(input.category)) {
          media.category = input.category
          media.manual = { ...media.manual, category: true }
        }
        if (typeof input.favorite === 'boolean') media.favorite = input.favorite
        for (const key of ['title', 'description', 'genre'])
          if (typeof input[key] === 'string' && input[key].trim()) {
            media[key] = input[key]
              .trim()
              .slice(0, key === 'description' ? 1500 : 150)
            media.manual ||= {}
            media.manual[key] = true
            if (key === 'title') delete media.metadataInfo
          }
        await save()
        return json(res, publicState())
      }
      if (req.method === 'DELETE') {
        state.media = state.media.filter((item) => item.id !== media.id)
        await save()
        return json(res, publicState())
      }
    }
    const coverRoute = /^\/api\/cover\/([^/]+)$/.exec(route)
    if (coverRoute && req.method === 'POST') {
      const media = state.media.find((item) => item.id === coverRoute[1])
      if (!media) return json(res, { error: '作品不存在' }, 404)
      const input = await body(req)
      media.cover = await saveCoverImage(media.id, input)
      media.manual ||= {}
      media.manual.cover = true
      await save()
      return json(res, publicState())
    }
    if (route === '/api/games/import' && req.method === 'POST') {
      const input = await body(req)
      const paths = Array.isArray(input.paths) ? input.paths : []
      if (
        !paths.length ||
        paths.length > 50 ||
        paths.some((item) => typeof item !== 'string')
      )
        return json(res, { error: '请选择要导入的游戏（一次最多 50 个）' }, 400)
      const results = []
      const imported = []
      for (const filePath of paths) {
        try {
          const entry = await createGameEntry({ path: filePath })
          if (
            paths.length === 1 &&
            typeof input.title === 'string' &&
            input.title.trim()
          ) {
            entry.title = input.title.trim().slice(0, 120)
            entry.manual = { title: true }
          }
          const existing = state.games.find((game) => game.id === entry.id)
          if (existing) {
            existing.exePath = entry.exePath
            existing.source = entry.source
            existing.workDir = existing.workDir || entry.workDir
            results.push({ id: existing.id, title: existing.title, existed: true })
          } else {
            state.games.unshift(entry)
            results.push({ id: entry.id, title: entry.title })
          }
          imported.push(results[results.length - 1].id)
        } catch (error) {
          results.push({ path: filePath, error: error.message || '无法导入' })
        }
      }
      await save()
      if (input.autoMetadata !== false)
        for (const id of imported) void enrichGame(id)
      return json(res, { results, imported: imported.length, ...publicState() })
    }
    if (route === '/api/web-sources/search' && req.method === 'POST') {
      const input = await body(req)
      const keyword = String(input?.keyword || '').trim()
      if (keyword.length < 2)
        return json(res, { error: '请输入 2 个字以上的名称' }, 400)
      const subject = await Promise.resolve(importSubject(input.subjectId)).catch(() => null)
      const aliases = subject && [subject.title, subject.subtitle].includes(keyword) ? [subject.title, subject.subtitle] : []
      return json(res, await webSources.search(keyword, { aliases, category: subject?.category || input.category || 'anime' }))
    }
    if (route === '/api/web-sources/report' && req.method === 'POST') {
      const input = await body(req)
      webSources.report(input.resultId, input.episodeId)
      return json(res, { ok: true })
    }
    // 网页源在线播放代理：m3u8/mp4 直链经幻屿转发（支持 Range 与 HLS）。
    if (route === '/api/web-stream' && req.method === 'POST') {
      const input = await body(req)
      if(typeof input.resultId!=='string'||typeof input.episodeId!=='string')return json(res,{error:'请从已校验的搜索结果中选择剧集'},400)
      const source = await webSources.resolve(input.resultId, input.episodeId)
      const token = randomUUID()
      streamCache.set(token, {
        ...source,
        expires: Date.now() + 4 * 3600000,
      })
      const qualities=(source.variants||[]).map((variant,index)=>{const variantToken=index===0?token:randomUUID();if(index!==0)streamCache.set(variantToken,{...variant,headers:source.headers,web:true,expires:Date.now()+4*3600000});return{id:`quality-${index}`,label:qualityLabel(variant.height),url:`/api/stream/${variantToken}`,format:variant.format}})
      return json(res, { url: `/api/stream/${token}`, format: source.format,qualities })
    }
    if (route === '/api/games/resource-search' && req.method === 'GET') {
      try {
        return json(res, await gameResources.search(url.searchParams.get('q') || ''))
      } catch (error) {
        return json(res, { error: error.message || '游戏资源搜索暂时不可用' }, error.status || 502)
      }
    }
    if (route === '/api/games/search' && req.method === 'GET') {
      try {
        return json(res, {
          results: await searchSteamApps(url.searchParams.get('q') || ''),
        })
      } catch (error) {
        return json(res, { error: error.message || 'Steam 搜索暂时不可用' }, 502)
      }
    }
    const gameApplyRoute = /^\/api\/games\/([^/]+)\/apply$/.exec(route)
    if (gameApplyRoute && req.method === 'POST') {
      const game = state.games.find((item) => item.id === gameApplyRoute[1])
      if (!game) return json(res, { error: '游戏不存在' }, 404)
      const input = await body(req)
      try {
        const detail = await fetchSteamAppDetail(Number(input?.appId))
        game.title = detail.title || game.title
        if (detail.description) game.description = detail.description
        if (detail.genre) game.genre = detail.genre
        try {
          const cover = await downloadGameCover(detail.appId, {
            headerImage: detail.headerImage,
          })
          const name = `${fileId(`game-steam-${detail.appId}`)}.${cover.extension}`
          await writeFile(path.join(DATA, 'covers', name), cover.bytes)
          game.cover = `/covers/${name}`
        } catch {}
        game.manual = { ...(game.manual || {}), title: true, description: true, genre: true, cover: true }
        game.metadataStatus = 'ready'
        delete game.metadataError
        await save()
        return json(res, publicState())
      } catch (error) {
        return json(res, { error: error.message || '资料应用失败' }, 502)
      }
    }
    const gameLaunchRoute = /^\/api\/games\/([^/]+)\/launch$/.exec(route)
    if (gameLaunchRoute && req.method === 'POST') {
      await body(req)
      const game = state.games.find((item) => item.id === gameLaunchRoute[1])
      if (!game) return json(res, { error: '游戏不存在' }, 404)
      let info
      try {
        info = await stat(game.exePath)
      } catch {
        return json(
          res,
          { error: '游戏文件不存在，可能已移动或被删除，请删除后重新导入' },
          404,
        )
      }
      if (!info.isFile()) return json(res, { error: '此路径不是游戏程序文件' }, 400)
      launchGame(game)
      game.lastPlayedAt = Date.now()
      game.playCount = (game.playCount || 0) + 1
      await save()
      return json(res, { ok: true, ...publicState() })
    }
    const gameMetaRoute = /^\/api\/games\/([^/]+)\/metadata$/.exec(route)
    if (gameMetaRoute && req.method === 'POST') {
      await body(req)
      const game = state.games.find((item) => item.id === gameMetaRoute[1])
      if (!game) return json(res, { error: '游戏不存在' }, 404)
      const info = await enrichGame(game.id)
      return json(res, { found: Boolean(info), ...publicState() })
    }
    const gameCoverRoute = /^\/api\/games\/([^/]+)\/cover$/.exec(route)
    if (gameCoverRoute && req.method === 'POST') {
      const game = state.games.find((item) => item.id === gameCoverRoute[1])
      if (!game) return json(res, { error: '游戏不存在' }, 404)
      const input = await body(req)
      game.cover = await saveCoverImage(game.id, input)
      game.manual ||= {}
      game.manual.cover = true
      await save()
      return json(res, publicState())
    }
    const gameRoute = /^\/api\/games\/([^/]+)$/.exec(route)
    if (gameRoute) {
      const game = state.games.find((item) => item.id === gameRoute[1])
      if (!game) return json(res, { error: '游戏不存在' }, 404)
      if (req.method === 'PATCH') {
        const input = await body(req)
        if (typeof input.favorite === 'boolean') game.favorite = input.favorite
        for (const key of ['title', 'genre'])
          if (typeof input[key] === 'string' && input[key].trim()) {
            game[key] = input[key].trim().slice(0, key === 'genre' ? 60 : 120)
            game.manual ||= {}
            game.manual[key] = true
          }
        if (typeof input.description === 'string' && input.description.trim()) {
          game.description = input.description.trim().slice(0, 2000)
          game.manual ||= {}
          game.manual.description = true
        }
        if (typeof input.launchArgs === 'string') {
          parseLaunchArgs(input.launchArgs)
          game.launchArgs = input.launchArgs.trim()
        }
        if (typeof input.workDir === 'string') {
          const dir = input.workDir.trim().replace(/^"|"$/g, '')
          if (dir && !path.isAbsolute(dir))
            return json(res, { error: '工作目录需要是完整的绝对路径' }, 400)
          if (/[\r\n\0]/.test(dir))
            return json(res, { error: '工作目录不能包含换行' }, 400)
          game.workDir = dir
        }
        await save()
        return json(res, publicState())
      }
      if (req.method === 'DELETE') {
        state.games = state.games.filter((item) => item.id !== game.id)
        await save()
        return json(res, publicState())
      }
    }
    if (route === '/api/progress' && req.method === 'POST') {
      const input = await body(req)
      const { media, episode } = findEpisode(input.mediaId, input.episodeId)
      if (
        ![input.time, input.duration].every(
          (n) => Number.isFinite(n) && n >= 0,
        ) ||
        input.time > input.duration
      )
        return json(res, { error: '进度数据不正确' }, 400)
      media.progress ||= {}
      media.progress[episode.id] = {
        time: input.time,
        duration: input.duration,
        at: Date.now(),
      }
      await save()
      return json(res, { ok: true })
    }
    if (route === '/api/play' && req.method === 'POST') {
      const input = await body(req)
      const { media, episode } = findEpisode(input.mediaId, input.episodeId)
      if (media.source === 'local')
        return json(res, { url: `/api/video/${media.id}/${episode.id}`, subtitleContext: 'local' })
      if (media.source !== 'quark')
        return json(res, { error: '请先导入此作品的视频' }, 400)
      let source
      try { source = await quark.getStream(
        media,
        episode,
        input.authorizeSave === true,
        {restore: input.resave === true},
      )
      }catch(error){await save();throw error}
      await save()
      for (const [token, cached] of streamCache)
        if (cached.expires < Date.now() || (input.resave === true && cached.mediaId === media.id && cached.episodeId === episode.id)) streamCache.delete(token)
      const token = randomUUID()
      streamCache.set(token, { ...source, mediaId:media.id, episodeId:episode.id, expires: Date.now() + 4 * 3600000 })
      const qualities=(source.variants || []).map((variant,index)=>{
        const variantToken=index===0?token:randomUUID()
        if(index!==0)streamCache.set(variantToken,{...variant,mediaId:media.id,episodeId:episode.id,expires:Date.now()+4*3600000})
        return {id:variant.id,label:variant.label,url:`/api/stream/${variantToken}`,format:variant.format,context:variantToken}
      })
      return json(res, { url: `/api/stream/${token}`, format: source.format, subtitleContext:token,qualities })
    }
    const embeddedFile=/^\/api\/subtitles\/embedded\/([a-f0-9]{32})\.vtt$/.exec(route)
    if(embeddedFile && req.method==='GET') {
      const bytes=await embeddedSubtitles.file(embeddedFile[1]);res.writeHead(200,{'Content-Type':'text/vtt; charset=utf-8','Cache-Control':'private, max-age=3600'});return res.end(bytes)
    }
    if(route==='/api/subtitles/embedded' && req.method==='POST') {
      const input=await body(req), {media,episode}=findEpisode(input.mediaId,input.episodeId)
      let source
      if(media.source==='local') {
        const info=await stat(episode.path)
        source={key:`${media.id}/${episode.id}/${info.size}/${info.mtimeMs}`,url:episode.path,container:subtitleContainer(path.extname(episode.path).slice(1))}
      }else if(media.source==='quark') {
        const playback=streamCache.get(input.context)
        if(!playback || playback.mediaId!==media.id || playback.episodeId!==episode.id || playback.expires<Date.now())return json(res,{error:'播放源已失效，请重新打开此集'},409)
        source={key:`${media.id}/${episode.id}/${media.sourceRevision||0}/${episode.savedFid}/${playback.variant||'original'}`,url:`http://127.0.0.1:${PORT}/api/stream/${input.context}`,container:playback.format==='hls'?'':subtitleContainer(playback.container || path.extname(episode.name).slice(1))}
      }else return json(res,{error:'请先导入视频'},400)
      if(input.trackId!==undefined) {
        if(!Number.isFinite(input.time)||input.time<0||input.time>86400*7)return json(res,{error:'字幕时间无效'},400)
        return json(res,await embeddedSubtitles.extract(source,input.trackId,input.time))
      }
      return json(res,await embeddedSubtitles.probe(source))
    }
    if (
      [
        '/api/subtitles/discover',
        '/api/subtitles/search',
        '/api/subtitles/upload',
        '/api/subtitles/preferences',
      ].includes(route) &&
      req.method === 'POST'
    ) {
      const input = await body(req, 9 * 1024 * 1024)
      const { media, episode } = findEpisode(input.mediaId, input.episodeId)
      if (!['local', 'quark'].includes(media.source))
        return json(res, { error: '请先导入视频再加载字幕' }, 400)
      if(state.settings.subtitlesEnabled===false && (route.endsWith('/discover') || route.endsWith('/search')))return json(res,{tracks:[],selectedId:'off',delay:0,message:'已关闭外挂字幕与自动搜索，视频原有字幕保留',disabled:true})
      if (route.endsWith('/discover')) {
        const result = await subtitles.discover(
          media,
          episode,
          input.refresh === true,
        )
        if (media.source === 'quark') await save()
        return json(res, result)
      }
      if (route.endsWith('/search'))
        return json(
          res,
          await subtitles.search(media, episode, input.force === true),
        )
      if (route.endsWith('/upload'))
        return json(
          res,
          await subtitles.upload(media, episode, input.name, input.content),
        )
      return json(res, await subtitles.preference(media, episode, input))
    }
    const subtitleRoute = /^\/api\/subtitles\/file\/([a-f0-9]{32})\.vtt$/.exec(
      route,
    )
    if (subtitleRoute && ['GET', 'HEAD'].includes(req.method)) {
      const file = subtitles.file(subtitleRoute[1])
      if (!file) return json(res, { error: '字幕不存在，请重新加载' }, 404)
      return await serveFile(req, res, file, true)
    }
    const videoRoute = /^\/api\/video\/([^/]+)\/([^/]+)$/.exec(route)
    if (videoRoute && ['GET', 'HEAD'].includes(req.method)) {
      const { episode, media } = findEpisode(videoRoute[1], videoRoute[2])
      if (media.source !== 'local' || !episode.path)
        return json(res, { error: '本地视频不存在' }, 404)
      return await serveFile(req, res, episode.path, true)
    }
    const streamRoute = /^\/api\/stream\/([a-z0-9-]+)$/.exec(route)
    if (streamRoute && ['GET', 'HEAD'].includes(req.method)) {
      const source = streamCache.get(streamRoute[1])
      if (!source || source.expires < Date.now())
        return json(res, { error: '播放地址已过期，请重新点击播放' }, 410)
      return await proxyVideo(req, res, source, origin)
    }
    if (route === '/api/open-local' && req.method === 'POST') {
      const input = await body(req)
      const { media, episode } = findEpisode(input.mediaId, input.episodeId)
      if (media.source !== 'local' || !episode.path)
        return json(res, { error: '只支持打开已导入的本地视频' }, 400)
      await stat(episode.path)
      if (process.platform !== 'win32')
        return json(res, { error: '此功能仅支持 Windows' }, 400)
      // Send the selected path via stdin to avoid shell interpolation of filenames.
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          '$p=[Console]::In.ReadToEnd(); Start-Process -FilePath $p',
        ],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
      )
      child.stdin.end(episode.path)
      child.on('error', () => {})
      return json(res, { ok: true })
    }
    if (route === '/api/export' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="yingyu-library.json"',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(state, null, 2))
      return
    }
    if (/^\/posters\/[a-f0-9]{32}\.img$/.test(route) && ['GET', 'HEAD'].includes(req.method)) {
      try {
        const bytes = await posters.read(route.slice(9, -4))
        const mime = bytes[0] === 0xff ? 'image/jpeg' : bytes[1] === 0x50 ? 'image/png' : 'image/webp'
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' })
        res.end(req.method === 'HEAD' ? undefined : bytes)
      } catch { res.writeHead(503, { 'Cache-Control': 'no-store', 'Retry-After': '60' }); res.end() }
      return
    }
    if (route.startsWith('/api/'))
      return json(res, { error: '接口不存在' }, 404)
    if (!['GET', 'HEAD'].includes(req.method))
      return json(res, { error: '不支持的请求方法' }, 405)
    if (route === '/skin-background' && ['GET', 'HEAD'].includes(req.method)) {
      for (const extension of ['jpg', 'png', 'webp']) {
        const file = path.join(DATA, `skin-background.${extension}`)
        try {
          const info = await stat(file)
          if (!info.isFile()) continue
          res.writeHead(200, {
            'Content-Type':
              extension === 'jpg'
                ? 'image/jpeg'
                : extension === 'png'
                  ? 'image/png'
                  : 'image/webp',
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
          })
          if (req.method === 'HEAD') return res.end()
          const stream = fs.createReadStream(file)
          stream.on('error', () => res.destroy())
          res.on('close', () => stream.destroy())
          return stream.pipe(res)
        } catch {}
      }
      return json(res, { error: '尚未导入皮肤背景图' }, 404)
    }
    if (route.startsWith('/covers/')) {
      if (
        !/^\/covers\/(?:[a-f0-9]{24}|seasonal-\d{1,12})\.(jpg|png|webp)$/.test(
          route,
        )
      )
        return json(res, { error: '图片不存在' }, 404)
      return await serveFile(req, res, path.join(DATA, route))
    }
    if (vite)
      return vite.middlewares(req, res, () => {
        res.writeHead(404)
        res.end()
      })
    const staticRoot = path.join(ROOT, 'dist')
    const file = path.resolve(staticRoot, '.' + decodeURIComponent(route))
    if (!file.startsWith(staticRoot + path.sep) && file !== staticRoot)
      return json(res, { error: '路径不正确' }, 400)
    if (path.extname(route)) return await serveFile(req, res, file)
    return await serveFile(req, res, path.join(staticRoot, 'index.html'))
  } catch (error) {
    if (res.headersSent) {
      res.destroy()
      return
    }
    const message =
      error.code === 'ENOENT'
        ? '文件或目录不存在，请检查路径'
        : error.message || '操作失败，请重试'
    json(
      res,
      { error: message, needsSave: error.needsSave || false, needsRestore: error.needsRestore || false },
      error.status || 400,
    )
  }
})
server.listen(PORT, '127.0.0.1', () =>
  console.log(
    `幻屿已启动 · http://127.0.0.1:${PORT}${DEV ? ' (开发模式)' : ''}\n按 Ctrl+C 停止服务。`,
  ),
)
async function shutdown() {
  quarkLogin.cancelAll()
  cookie = ''
  metadataQueue.cancel()
  await metadataQueue.wait()
  deepseekKey = ''
  await save()
  await saveQueue.catch(() => {})
  await vite?.close()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
