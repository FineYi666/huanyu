import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mediaCategory } from '../media-category.mjs'
import { applyMetadata } from '../metadata.mjs'
import { mergeQuarkCookies, createQuark } from '../quark.mjs'
import { createSecretStore } from '../secret-store.mjs'
import { selectSeasonalCatalog, seasonAt } from '../seasonal.mjs'
import {
  extractQuarkResults,
  createResourceSearch,
} from '../resource-search.mjs'

test('separate anime and movie areas infer legacy films and retain manually chosen categories', () => {
  assert.equal(mediaCategory({ genre: '电影' }), 'movie')
  assert.equal(mediaCategory({ metadataInfo: { kind: 'movie' } }), 'movie')
  assert.equal(mediaCategory({ category: 'anime', genre: '电影' }), 'anime')
  const media = { manual: { category: true }, category: 'movie' }
  applyMetadata(media, { kind: 'anime', title: '手动分类' }, null)
  assert.equal(media.category, 'movie')
  const automatic = { manual: {} }
  applyMetadata(automatic, { kind: 'movie', title: '电影' }, null)
  assert.equal(automatic.category, 'movie')
})

test('TV metadata and legacy series enter their own area while manual categories remain authoritative', () => {
  assert.equal(mediaCategory({ category: 'tv' }), 'tv')
  assert.equal(mediaCategory({ category: 'anime', metadataInfo: { kind: 'series' } }), 'tv')
  assert.equal(mediaCategory({ genre: '电视剧' }), 'tv')
  assert.equal(mediaCategory({ category: 'anime', manual: { category: true }, metadataInfo: { kind: 'series' } }), 'anime')
  const media = { manual: {} }
  applyMetadata(media, { kind: 'series', title: '电视剧' }, null)
  assert.equal(media.category, 'tv')
  media.manual.category = true
  applyMetadata(media, { kind: 'anime', title: '新的识别结果' }, null)
  assert.equal(media.category, 'tv')
})

test('quarter catalog includes unscored and upcoming TV/WEB while excluding films and other quarters', () => {
  const season = seasonAt(new Date('2026-10-24T08:00:00Z'))
  const item = {
    id: 1,
    date: '2026-10-01',
    platform: 'TV',
    rating: { score: 0, total: 0 },
  }
  const items = selectSeasonalCatalog(
    [
      item,
      item,
      { ...item, id: 2, date: '2026-11-02' },
      { ...item, id: 3, date: '2026-07-01' },
      { ...item, id: 4, platform: '剧场版' },
      { ...item, id: 5, nsfw: true },
    ],
    season,
  )
  assert.deepEqual(
    items.map((x) => x.id),
    [1, 2],
  )
  assert.equal(season.monthLabel, '2026年10月新番')
})

test('Quark cookie rotation updates encrypted persistence input without exposing it as an API result', async () => {
  assert.equal(
    mergeQuarkCookies('__pus=a; __puus=old; removed=value', [
      '__puus=new=token; Path=/; HttpOnly',
      'removed=; Max-Age=0',
    ]),
    '__pus=a; __puus=new=token',
  )
  const original = globalThis.fetch
  let cookie = '__pus=test; __puus=old',
    saved = ''
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: 0, data: { list: [] } }), {
      headers: { 'Set-Cookie': '__puus=new; Path=/; HttpOnly' },
    })
  try {
    const client = createQuark(() => cookie, {
      onCookie: async (value) => {
        saved = value
        cookie = value
      },
    })
    assert.equal(await client.checkAccount(), true)
    assert.equal(saved, '__pus=test; __puus=new')
  } finally {
    globalThis.fetch = original
  }
})

test(
  'Windows remembers Quark across store instances, encrypts on disk and forgets it without deleting DeepSeek',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yingyu-remember-'))
    const quark = createSecretStore(directory, 'quark.key'),
      deepseek = createSecretStore(directory)
    await Promise.all([
      quark.write('__pus=not-real; __puus=test-secret'),
      deepseek.write('test-deepseek-secret'),
    ])
    const raw = await readFile(path.join(directory, 'quark.key'), 'utf8')
    assert.ok(!raw.includes('test-secret'))
    assert.equal(
      await createSecretStore(directory, 'quark.key').read(),
      '__pus=not-real; __puus=test-secret',
    )
    await quark.remove()
    assert.equal(await quark.read(), '')
    assert.equal(await deepseek.read(), 'test-deepseek-secret')
  },
)

test('resource extraction strips markup, deduplicates Quark shares and ignores unrelated hosts', () => {
  const rows = [
    {
      content:
        '名称：<b>测试动画 第二季</b>\n<a href="https://pan.quark.cn/s/test123?pwd=abcd">链接</a> 提取码：abcd',
    },
    { content: 'https://pan.quark.cn/s/test123' },
    { content: 'https://pan.quark.cn.evil.test/s/steal' },
  ]
  const values = extractQuarkResults(
    rows,
    'https://www.pansearch.me/search?keyword=test',
  )
  assert.equal(values.length, 1)
  assert.equal(values[0].title, '测试动画 第二季')
  assert.equal(values[0].code, 'abcd')
  assert.ok(!values[0].description.includes('<b>'))
  const aggregated = extractQuarkResults(
    [
      {
        content:
          '1、乱马二分之一:<a class="resource-link" href="https://pan.quark.cn/s/other123">分享</a>',
      },
    ],
    'https://www.pansearch.me',
  )
  assert.equal(aggregated[0].title, '乱马二分之一')
})

test('automatic resource search caches real provider results and transmits no credentials', async () => {
  let calls = 0
  const service = createResourceSearch({
    fetcher: async (url, options) => {
      calls++
      assert.ok(!JSON.stringify(options.headers).includes('Cookie'))
      if (String(url).startsWith('https://pansou.app/api/search?'))
        return new Response(
          JSON.stringify({ code: 0, data: { merged_by_type: {} } }),
        )
      assert.ok(
        String(url).startsWith('https://www.pansearch.me/search?keyword='),
      )
      const data = {
        buildId: 'test',
        props: {
          pageProps: {
            limit: 10,
            data: {
              total: 1,
              data: [
                { content: '名称：测试新番\nhttps://pan.quark.cn/s/real123' },
              ],
            },
          },
        },
      }
      return new Response(
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`,
      )
    },
  })
  assert.equal((await service.search('测试新番')).results.length, 1)
  assert.equal((await service.search('测试新番')).results.length, 1)
  assert.equal(calls, 2)
  await assert.rejects(service.search('一'), /2 到 150/)
})
