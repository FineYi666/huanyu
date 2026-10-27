import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesWork } from '../media-match.mjs'
import { episodeLayout, seasonNumber } from '../episode-seasons.mjs'
import { probeStream, publicVideoUrl } from '../stream-probe.mjs'
import { createWebSources, parsePlayRoads } from '../web-sources.mjs'
import { rankLevels, qualityLabel } from '../stream-quality.mjs'

test('online work matching rejects unrelated titles, wrong seasons, commentary and wrong media categories', () => {
  const check = (name, query = '葬送的芙莉莲 第二季', type = '日韩动漫') =>
    matchesWork({ vod_name: name, type_name: type }, query, {
      category: 'anime',
    })
  assert.equal(check('葬送的芙莉莲 第二季'), true)
  assert.equal(check('葬送的芙莉莲'), false)
  assert.equal(check('葬送的芙莉莲 第三季'), false)
  assert.equal(check('葬送的芙莉莲 第二季解说'), false)
  assert.equal(check('另一部动漫 第二季'), false)
  assert.equal(check('葬送的芙莉莲 第二季', undefined, '动作片'), false)
  assert.equal(
    matchesWork({ title: 'The Shawshank Redemption' }, '肖申克的救赎', {
      category: 'movie',
      aliases: ['The Shawshank Redemption'],
    }),
    true,
  )
  assert.equal(
    matchesWork({ title: '肖申克的救赎[电影解说]' }, '肖申克的救赎', {
      category: 'movie',
    }),
    false,
  )
})
test('season episode numbering restarts for explicit paths and a standalone second season while IDs stay intact', () => {
  const episodes = Array.from({ length: 24 }, (_, i) => ({
    id: `episode-${i}`,
    name: `第${i < 12 ? '一' : '二'}季/${String(i + 1).padStart(2, '0')}.mkv`,
  }))
  const list = episodeLayout(episodes, '测试动漫')
  assert.equal(list[11].number, 12)
  assert.equal(list[12].number, 1)
  assert.equal(list[12].season, 2)
  assert.equal(list[23].number, 12)
  assert.equal(episodes[12].id, 'episode-12')
  assert.equal(
    episodeLayout([
      { name: 'S02E01.mkv' },
      { name: 'S02E02.mkv' },
      { name: 'SP.mkv' },
    ])[1].number,
    2,
  )
  assert.equal(
    episodeLayout([{ name: '13.mp4' }, { name: '14.mp4' }], '测试 第二季')[0]
      .number,
    1,
  )
  assert.equal(
    episodeLayout([{ name: 'x.mp4', path: 'D:\\动漫\\Season 2\\x.mp4' }])[0]
      .season,
    2,
  )
  assert.equal(seasonNumber('第十二季'), 12)
})
const ts = () =>
  new Response(Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187)]), {
    headers: { 'content-type': 'video/mp2t' },
  })
test('stream probe validates HLS content and a media segment, rejects HTML, broken keys, dead segments and private redirects', async () => {
  const fetcher = async (url) =>
    url.endsWith('.m3u8')
      ? new Response('#EXTM3U\n#EXTINF:5,\nvideo.ts\n#EXT-X-ENDLIST')
      : ts()
  assert.equal(
    (await probeStream({ url: 'https://cdn.example/v.m3u8' }, { fetcher }))
      .format,
    'hls',
  )
  await assert.rejects(
    probeStream(
      { url: 'https://cdn.example/v.m3u8' },
      { fetcher: async () => new Response('<html>not video</html>') },
    ),
    /网页/,
  )
  await assert.rejects(
    probeStream(
      { url: 'https://cdn.example/v.m3u8' },
      {
        fetcher: async (url) =>
          url.endsWith('.m3u8')
            ? new Response('#EXTM3U\n#EXTINF:5,\nbroken.ts')
            : new Response('', { status: 403 }),
      },
    ),
    /403/,
  )
  await assert.rejects(
    probeStream(
      { url: 'https://cdn.example/v.m3u8' },
      {
        fetcher: async (url) =>
          url.endsWith('.m3u8')
            ? new Response(
                '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:5,\na.ts',
              )
            : url.endsWith('key')
              ? new Response('bad key')
              : ts(),
      },
    ),
    /密钥/,
  )
  await assert.rejects(
    probeStream(
      { url: 'https://cdn.example/v.m3u8' },
      {
        fetcher: async () =>
          new Response('', {
            status: 302,
            headers: { location: 'https://127.0.0.1/private' },
          }),
      },
    ),
    /不支持/,
  )
  assert.throws(() => publicVideoUrl('https://user:pass@example.com/video.mp4'))
})
test('master playlists expose only verified variants in highest-first order and detect mp4 from actual bytes', async () => {
  const master =
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400,RESOLUTION=3840x2160\n4k.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080\n1080.m3u8'
  const fetcher = async (url) =>
    url.endsWith('master.m3u8')
      ? new Response(master)
      : url.endsWith('4k.m3u8')
        ? new Response('', { status: 404 })
        : url.endsWith('.m3u8')
          ? new Response('#EXTM3U\n#EXTINF:5,\nvideo.ts')
          : ts()
  const result = await probeStream(
    { url: 'https://cdn.example/master.m3u8' },
    { fetcher },
  )
  assert.equal(result.url, 'https://cdn.example/1080.m3u8')
  assert.deepEqual(
    result.variants.map((item) => item.height),
    [1080, 720],
  )
  const file = await probeStream(
    { url: 'https://cdn.example/opaque' },
    {
      fetcher: async () =>
        new Response(
          Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
        ),
    },
  )
  assert.equal(file.format, 'file')
  assert.equal(
    rankLevels([{ height: 720 }, { height: 2160 }, { height: 1080 }])[0].id,
    'hls:1',
  )
  assert.match(qualityLabel(1080), /超清/)
  assert.match(qualityLabel(720), /高清/)
  assert.match(qualityLabel(480), /标清/)
})
test('web search requires title and playable content, separates roads and revalidates every selected episode', async () => {
  let dead = false,
    probes = 0
  const vod = {
    vod_id: 1,
    vod_name: '测试动漫 第二季',
    type_name: '日韩动漫',
    vod_play_from: 'm3u8$$$web',
    vod_play_url:
      '第13集$https://cdn.example/1.m3u8#第14集$https://cdn.example/2.m3u8$$$观看$https://site.example/play.html',
  }
  const service = createWebSources({
    providers: [
      { id: 'test', name: '测试来源', api: 'https://source.example/api' },
    ],
    fetcher: async () =>
      Response.json({
        list: [vod, { ...vod, vod_id: 2, vod_name: '毫不相关的动漫 第二季' }],
      }),
    probe: async (source) => {
      probes++
      if (dead || source.url.endsWith('2.m3u8')) throw new Error('404')
      return { url: source.url, format: 'hls' }
    },
  })
  const value = await service.search('测试动漫 第二季', { category: 'anime' })
  assert.equal(value.results.length, 1)
  assert.equal(value.results[0].episodes[0].title, '第1集')
  assert.equal(value.results[0].episodes[0].season, 2)
  assert.equal(parsePlayRoads(vod).length, 1)
  assert.ok(!JSON.stringify(value).includes('cdn.example'))
  const item = value.results[0]
  await service.resolve(item.id, item.episodes[0].id)
  assert.equal(probes, 2)
  await assert.rejects(service.resolve(item.id, item.episodes[1].id), /404/)
  dead = true
  await assert.rejects(service.resolve(item.id, item.episodes[0].id), /404/)
  assert.equal(
    (await service.search('测试动漫 第二季', { category: 'anime' })).results
      .length,
    0,
  )
  await assert.rejects(service.resolve('unknown', 'episode'), /过期/)
})
