import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  subtitleToVtt,
  sidecarScore,
  findLocalSubtitles,
  episodeNumbers,
  subtitleQuery,
  rankOnlineSubtitles,
} from '../subtitles.mjs'
import { createSubtitleService } from '../subtitle-service.mjs'
import { createQuark } from '../quark.mjs'

const srt =
  '1\n00:00:01,200 --> 00:00:03,400\n你好，世界\n\n2\n00:00:04,000 --> 00:00:05,000\n第二行\n'
test('SRT, ASS, SSA, VTT and UTF-16 become validated inert UTF-8 WebVTT cues', () => {
  const result = subtitleToVtt(Buffer.from(srt), 'sample.srt')
  assert.equal(result.cueCount, 2)
  assert.ok(result.vtt.includes('00:00:01.200 --> 00:00:03.400'))
  assert.ok(result.vtt.includes('你好，世界'))
  assert.equal(
    subtitleToVtt(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(srt, 'utf16le')]),
      'sample.srt',
    ).cueCount,
    2,
  )
  const ass =
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.20,0:00:03.40,Default,,0,0,0,,{\\an8}你好\\N世界,继续\nDialogue: 0,0:00:01.20,0:00:03.40,Default,,0,0,0,,{\\p1}m 0 0 l 1 1'
  const converted = subtitleToVtt(Buffer.from(ass), 'sample.ass')
  assert.equal(converted.cueCount, 1)
  assert.ok(converted.vtt.includes('你好\n世界,继续'))
  assert.ok(!converted.vtt.includes('\\an8'))
  assert.equal(subtitleToVtt(Buffer.from(result.vtt), 'sample.vtt').cueCount, 2)
  assert.throws(
    () => subtitleToVtt(Buffer.from('<html>登录</html>'), 'error.srt'),
    /未识别/,
  )
  assert.throws(() =>
    subtitleToVtt(
      Buffer.from('1\n00:01:99,000 --> 00:02:00,000\nwrong'),
      'bad.srt',
    ),
  )
})
test('sidecar matching keeps episodes and seasons separate and finds subtitle subdirectories', async () => {
  assert.ok(sidecarScore('Show.S02E03.mkv', 'Show.S02E03.chs.ass') > 0)
  assert.equal(sidecarScore('Show.S02E03.mkv', 'Show.S02E04.chs.ass'), 0)
  assert.equal(sidecarScore('Show.S02E03.mkv', 'Show.S01E03.chs.ass'), 0)
  assert.equal(sidecarScore('01.mp4', '第一集.ass'), 85)
  assert.deepEqual(episodeNumbers('Show.S07E05.mp4'), { season: 7, episode: 5 })
  const root = await mkdtemp(path.join(os.tmpdir(), 'yingyu-subs-'))
  await mkdir(path.join(root, 'Subs'))
  await writeFile(path.join(root, 'Subs', 'Show.S02E03.chs.ass'), 'placeholder')
  await writeFile(path.join(root, 'Subs', 'Show.S02E04.chs.ass'), 'placeholder')
  const values = await findLocalSubtitles({
    path: path.join(root, 'Show.S02E03.mkv'),
    name: 'Show.S02E03.mkv',
  })
  assert.equal(values.length, 1)
  assert.equal(values[0].language, 'zh-CN')
})
test('online matching uses public title and episode only and rejects unrelated or wrong-episode hits', () => {
  const episode = {
    id: 'ep',
    name: 'D:\\PRIVATE_USER\\private_identifier_S02E03.mp4',
  }
  const query = subtitleQuery(
    { title: '测试动画 第二季', episodes: [episode] },
    episode,
  )
  assert.equal(query.query, '测试动画 S02E03')
  assert.ok(!query.query.includes('private_identifier'))
  const rows = [
    {
      name: 'Show.S02E03.chs.ass',
      simple_name: '测试动画S02E03',
      ext: 'ass',
      url: 'https://subtitle.v.geilijiasu.com/a.ass',
    },
    {
      name: 'Show.S02E04.chs.ass',
      simple_name: '测试动画S02E04',
      ext: 'ass',
      url: 'https://subtitle.v.geilijiasu.com/b.ass',
    },
    {
      name: '不相关课程.srt',
      simple_name: '课程',
      ext: 'srt',
      url: 'https://subtitle.v.geilijiasu.com/c.srt',
    },
  ]
  assert.equal(rankOnlineSubtitles(rows, query).length, 1)
})
test('subtitle discovery, conversion, preference and cache survive new service instances', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'yingyu-substore-'))
  await writeFile(path.join(data, 'Show 01.chs.srt'), srt)
  const episode = {
      id: 'episode',
      name: 'Show 01.mp4',
      path: path.join(data, 'Show 01.mp4'),
    },
    media = {
      id: 'local-test',
      source: 'local',
      title: '测试动画',
      episodes: [episode],
    }
  const service = await createSubtitleService({ data, quark: {} })
  const result = await service.discover(media, episode)
  assert.equal(result.tracks.length, 1)
  assert.equal(result.tracks[0].origin, 'local')
  assert.ok(!JSON.stringify(result).includes(data))
  await service.preference(media, episode, { selected: 'off', delay: 1.5 })
  const restored = await createSubtitleService({ data, quark: {} })
  const next = await restored.discover(media, episode)
  assert.equal(next.selectedId, 'off')
  assert.equal(next.delay, 1.5)
  await assert.rejects(
    restored.preference(media, episode, { selected: 'not-this-episode' }),
  )
  await assert.rejects(restored.preference(media, episode, { delay: 999 }))
  const uploaded = await restored.upload(
    media,
    episode,
    'manual.srt',
    Buffer.from(srt.replace('你好', '手动')).toString('base64'),
  )
  assert.equal(uploaded.tracks[0].origin, 'manual')
  assert.equal(uploaded.selectedId, uploaded.tracks[0].id)
})
test('online search downloads matching Chinese text, caches it, and never sends private names or cookies', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'yingyu-subsearch-')),
    calls = []
  const episode = { id: 'ep', name: 'private-name-S01E01.mp4' },
    media = {
      id: 'test',
      source: 'local',
      title: '公开动画',
      episodes: [episode],
    }
  const service = await createSubtitleService({
    data,
    quark: {},
    fetcher: async (url, options) => {
      calls.push({ url: String(url), options })
      if (String(url).startsWith('https://api-shoulei-ssl.xunlei.com/'))
        return new Response(
          JSON.stringify({
            code: 0,
            data: [
              {
                name: 'Public.S01E01.chs.srt',
                simple_name: '公开动画S01E01',
                ext: 'srt',
                languages: ['简体'],
                url: 'https://subtitle.v.geilijiasu.com/test.srt',
              },
            ],
          }),
        )
      assert.equal(String(url), 'https://subtitle.v.geilijiasu.com/test.srt')
      return new Response(srt)
    },
  })
  const result = await service.search(media, episode)
  assert.equal(result.tracks.length, 1)
  assert.equal(result.tracks[0].origin, 'online')
  assert.ok(
    (await readFile(service.file(result.selectedId), 'utf8')).startsWith(
      'WEBVTT',
    ),
  )
  assert.ok(!JSON.stringify(calls).includes('private-name'))
  assert.ok(!JSON.stringify(calls).includes('Cookie'))
  await service.search(media, episode)
  assert.equal(calls.length, 2)
})
test('cloud import retains sidecars privately and reads them without any save operation', async () => {
  const original = globalThis.fetch,
    calls = []
  globalThis.fetch = async (url, options) => {
    const p = new URL(url).pathname
    calls.push(p)
    if (p.endsWith('/share/sharepage/token'))
      return new Response(
        JSON.stringify({ code: 0, data: { stoken: 'test-token' } }),
      )
    if (p.endsWith('/share/sharepage/detail'))
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              { fid: 'v', file_name: 'Show 01.mp4', file_type: 1 },
              {
                fid: 's',
                file_name: 'Show 01.chs.srt',
                file_type: 1,
                share_fid_token: 'private-sidecar-token',
              },
            ],
          },
        }),
      )
    if (p.endsWith('/share/sharepage/download'))
      return new Response(
        JSON.stringify({
          code: 0,
          data: [{ download_url: 'https://example.quark.cn/sub.srt' }],
        }),
      )
    throw new Error('unexpected write or endpoint')
  }
  try {
    const quark = createQuark(() => ''),
      media = await quark.importShare('https://pan.quark.cn/s/publicTest')
    assert.equal(media.episodes.length, 1)
    assert.equal(media.subtitleFiles.length, 1)
    const source = await quark.subtitleSource(media, media.subtitleFiles[0])
    assert.equal(source.url, 'https://example.quark.cn/sub.srt')
    assert.ok(!calls.some((p) => p.endsWith('/save')))
  } finally {
    globalThis.fetch = original
  }
})
