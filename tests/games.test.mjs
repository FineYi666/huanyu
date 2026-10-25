import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createGameEntry,
  launchGame,
  parseLaunchArgs,
  searchSteamGame,
  fetchGameMetadata,
  downloadGameCover,
  isAllowedGameImageUrl,
} from '../games.mjs'
import { createLocalBrowser } from '../local-browser.mjs'

const PNG_BYTES = Buffer.concat([
  Buffer.from([0, 0x50, 0x4e, 0x47]),
  Buffer.alloc(12),
])
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(12),
])

const spawnStub = (log) => {
  const children = []
  const spawn = (command, args, options) => {
    const child = {
      command,
      args,
      options,
      stdinData: '',
      on() {},
      unref() {
        child.unreffed = true
      },
      stdin: {
        end(value) {
          child.stdinData = value
        },
      },
    }
    log.push(child)
    children.push(child)
    return child
  }
  return { spawn, children }
}

test('game entries validate paths and read the title from the file name', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yingyu-games-'))
  const exe = path.join(directory, 'Hades.exe')
  const shortcut = path.join(directory, '星露谷物语.lnk')
  await writeFile(exe, 'binary')
  await writeFile(shortcut, 'binary')
  await mkdir(path.join(directory, 'folder'))
  await t.test('rejects relative, missing and non-game paths', async () => {
    await assert.rejects(createGameEntry({ path: 'Games/Hades.exe' }), {
      status: 400,
    })
    await assert.rejects(
      createGameEntry({ path: path.join(directory, 'missing.exe') }),
      { status: 404 },
    )
    await assert.rejects(createGameEntry({ path: path.join(directory, 'notes.txt') }), {
      status: 400,
    })
    await assert.rejects(createGameEntry({ path: directory }), /只支持导入/)
  })
  await t.test('creates an exe entry with a working directory', async () => {
    const game = await createGameEntry({ path: exe })
    assert.equal(game.title, 'Hades')
    assert.equal(game.source, 'exe')
    assert.equal(game.workDir, directory)
    assert.match(game.id, /^game-[a-f0-9]{24}$/)
    assert.equal(game.favorite, false)
    assert.equal(game.playCount, 0)
  })
  await t.test('creates a shortcut entry without a working directory', async () => {
    const game = await createGameEntry({ path: shortcut })
    assert.equal(game.title, '星露谷物语')
    assert.equal(game.source, 'lnk')
    assert.equal(game.workDir, '')
  })
  await t.test('re-importing the same path keeps a stable id', async () => {
    const first = await createGameEntry({ path: exe })
    const second = await createGameEntry({
      path: exe.slice(0, -4) + '.EXE',
    })
    assert.equal(first.id, second.id)
  })
})

test('launch args split on spaces but keep quoted values intact', () => {
  assert.deepEqual(parseLaunchArgs(' -windowed  --lang=zh '), [
    '-windowed',
    '--lang=zh',
  ])
  assert.deepEqual(parseLaunchArgs('"C:\\my mods\\pack.cfg" -debug'), [
    'C:\\my mods\\pack.cfg',
    '-debug',
  ])
  assert.deepEqual(parseLaunchArgs(''), [])
  assert.throws(() => parseLaunchArgs('a\nb'), /换行/)
})

test('launching spawns detached with a safe command line', () => {
  const game = {
    title: 'Hades',
    exePath: 'D:\\Games\\Hades\\Hades.exe',
    workDir: '',
    launchArgs: '-windowed "C:\\mods\\a b.cfg"',
    source: 'exe',
  }
  const nonWindows = spawnStub([])
  assert.throws(
    () => launchGame(game, { spawn: nonWindows.spawn, platform: 'linux' }),
    /Windows/,
  )
  const { spawn, children } = spawnStub([])
  launchGame(game, { spawn, platform: 'win32' })
  assert.equal(children.length, 1)
  const [child] = children
  assert.equal(child.command, 'D:\\Games\\Hades\\Hades.exe')
  assert.deepEqual(child.args, ['-windowed', 'C:\\mods\\a b.cfg'])
  assert.equal(child.options.cwd, 'D:\\Games\\Hades')
  assert.equal(child.options.detached, true)
  assert.equal(child.unreffed, true)
  const shortcut = spawnStub([])
  launchGame(
    {
      title: '星露谷物语',
      exePath: 'D:\\Links\\星露谷物语.lnk',
      workDir: '',
      launchArgs: '',
      source: 'lnk',
    },
    { spawn: shortcut.spawn, platform: 'win32' },
  )
  const [launcher] = shortcut.children
  assert.equal(launcher.command, 'powershell.exe')
  assert.equal(launcher.stdinData, 'D:\\Links\\星露谷物语.lnk')
  assert.equal(launcher.unreffed, true)
})

const steamFetch = (payloads) => {
  const calls = []
  const fetch = async (url) => {
    calls.push(String(url))
    const payload = payloads(calls.length, String(url))
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => payload,
    }
  }
  return { fetch, calls }
}

test('steam metadata search prefers the exact title and returns nothing offline', async () => {
  const { fetch, calls } = steamFetch(() => ({
    items: [
      { id: 111, name: 'Elden Ring Legend' },
      { id: 222, name: 'elden ring' },
    ],
  }))
  const match = await searchSteamGame('elden ring', fetch)
  assert.equal(match.id, 222)
  assert.match(calls[0], /term=elden%20ring/)
  assert.match(calls[0], /l=schinese/)
  assert.equal(await searchSteamGame('   ', fetch), null)
  const empty = steamFetch(() => ({ total: 0, items: [] }))
  assert.equal(await searchSteamGame('不存在的游戏', empty.fetch), null)
})

test('game metadata pulls name, description and genre from app details', async () => {
  const { fetch } = steamFetch((_count, url) =>
    url.includes('/api/appdetails')
      ? {
          '460930': {
            success: true,
            data: {
              name: 'Hades',
              short_description: 'Defy the god of the dead.',
              genres: [{ description: '动作' }, { description: '独立' }],
              header_image:
                'https://cdn.cloudflare.steamstatic.com/steam/apps/460930/header.jpg',
            },
          },
        }
      : { total: 1, items: [{ id: 460930, name: 'Hades' }] },
  )
  const info = await fetchGameMetadata('Hades', fetch)
  assert.equal(info.appId, 460930)
  assert.equal(info.title, 'Hades')
  assert.equal(info.description, 'Defy the god of the dead.')
  assert.equal(info.genre, '动作')
  const unavailable = steamFetch((_count, url) =>
    url.includes('/api/appdetails')
      ? { '460930': { success: false } }
      : { total: 1, items: [{ id: 460930, name: 'Hades' }] },
  )
  assert.equal(await fetchGameMetadata('Hades', unavailable.fetch), null)
})

const imageFetch = (handler) => {
  const calls = []
  const fetch = async (url) => {
    calls.push(String(url))
    return handler(String(url))
  }
  return { fetch, calls }
}

test('game covers prefer the portrait library image and fall back to the header', async () => {
  const notFound = () => ({
    ok: false,
    status: 404,
    headers: { get: () => 'text/html' },
  })
  const { fetch, calls } = imageFetch((url) =>
    url.endsWith('library_600x900_2x.jpg') || url.endsWith('library_600x900.jpg')
      ? notFound()
      : imageResponse(JPEG_BYTES),
  )
  const cover = await downloadGameCover(460930, {
    fetch,
    headerImage:
      'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/460930/header.jpg',
  })
  assert.equal(cover.extension, 'jpg')
  assert.ok(calls[0].endsWith('library_600x900_2x.jpg'))
  assert.ok(calls[calls.length - 1].endsWith('header.jpg'))
  const blocked = imageFetch(notFound)
  await assert.rejects(
    downloadGameCover(460930, {
      fetch: blocked.fetch,
      headerImage: 'https://evil.example.com/header.jpg',
    }),
    /受支持|图片/,
  )
  await assert.rejects(
    downloadGameCover(460930, {
      fetch: imageFetch((url) =>
        url.endsWith('library_600x900_2x.jpg')
          ? imageResponse(PNG_BYTES, 'text/html')
          : notFound(),
      ).fetch,
    }),
    /图片/,
  )
})

function imageResponse(bytes, mime = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name === 'content-type' ? mime : null) },
    body: (async function* () {
      yield bytes
    })(),
  }
}

test('cover URLs only allow https Steam CDN hosts', () => {
  assert.equal(
    isAllowedGameImageUrl(
      'https://cdn.cloudflare.steamstatic.com/steam/apps/460930/header.jpg',
    ),
    true,
  )
  assert.equal(
    isAllowedGameImageUrl(
      'https://cdn.akamai.steamstatic.com/steam/apps/460930/library_600x900.jpg',
    ),
    true,
  )
  assert.equal(
    isAllowedGameImageUrl('http://cdn.cloudflare.steamstatic.com/header.jpg'),
    false,
  )
  assert.equal(
    isAllowedGameImageUrl('https://evil.example.com/header.jpg'),
    false,
  )
})

test('game browsing lists executables and shortcuts instead of videos', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yingyu-gamebrowse-'))
  await mkdir(path.join(directory, '资料'))
  for (const name of ['game.exe', '星露谷.lnk', 'readme.txt', 'movie.mp4'])
    await writeFile(path.join(directory, name), 'unchanged')
  const browser = createLocalBrowser({ home: directory })
  const games = await browser.browse({ path: directory, kind: 'game' })
  assert.equal(games.entries.length, 3)
  assert.deepEqual(
    Object.fromEntries(games.entries.map((entry) => [entry.name, entry.kind])),
    {
      资料: 'folder',
      'game.exe': 'game',
      '星露谷.lnk': 'game',
    },
  )
  const videos = await browser.browse({ path: directory })
  assert.deepEqual(
    videos.entries.map((entry) => entry.name),
    ['资料', 'movie.mp4'],
  )
})
