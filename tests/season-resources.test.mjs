import test from 'node:test'
import assert from 'node:assert/strict'
import { seasonalBanner, seasonAt, fetchSeasonal } from '../seasonal.mjs'
import { attachSeasonalMetadata } from '../seasonal-metadata.mjs'
import { createQuark } from '../quark.mjs'
import {
  createResourceSearch,
  resourceQueries,
  resourceSeasonMatch,
  extractQuarkResults,
  resourceRelevance,
} from '../resource-search.mjs'

test('Quark matching filters same-word noise and does not truncate the wanted high-quality title behind aggregates', async () => {
  assert.equal(resourceRelevance('山水狂飙','狂飙'),0)
  assert.equal(resourceRelevance('狂飙赛车','狂飙'),0)
  assert.equal(resourceRelevance('狂飙营数学课程','狂飙'),0)
  const rows=[...Array.from({length:30},(_,i)=>({content:`名称：其他作品${i}\nhttps://pan.quark.cn/s/other${i}`})),{content:'名称：琅琊榜 (2015)【54集全】【4K】\nhttps://pan.quark.cn/s/langya4k'}]
  const service=createResourceSearch({fetcher:async url=>String(url).includes('pansou.app')?Response.json({code:0,data:{merged_by_type:{}}}):new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{data:{data:rows}}}})}</script>`)})
  const value=await service.search('琅琊榜')
  assert.equal(value.results.length,1)
  assert.match(value.results[0].title,/54集全/)
  assert.equal(value.results[0].qualityHint,'资源标注 4K')
  const parsed=extractQuarkResults([{content:'名称：甲\nhttps://pan.quark.cn/s/first?pwd=aaaa\n名称：乙\nhttps://pan.quark.cn/s/second?pwd=bbbb'}],'https://www.pansearch.me')
  assert.deepEqual(parsed.map(item=>item.code),['aaaa','bbbb'])
})

test('rendered Quark provider results complete a partial response automatically through polling', async () => {
  let finish, renders=0
  const service=createResourceSearch({renderSearch:()=>{renders++;return new Promise(resolve=>{finish=resolve})},fetcher:async url=>String(url).includes('pansou.app')?Response.json({code:0,data:{merged_by_type:{}}}):new Response('<script id="__NEXT_DATA__">{"props":{"pageProps":{"data":{"data":[]}}}}</script>')})
  const initial=await service.search('测试剧')
  assert.equal(initial.pending,true)
  assert.equal(initial.sources.find(s=>s.name==='夸克盘搜').status,'loading')
  finish({rows:[{title:'测试剧 4K',url:'https://pan.quark.cn/s/completed'}]})
  await new Promise(resolve=>setImmediate(resolve))
  const complete=await service.search('测试剧')
  assert.equal(complete.pending,false)
  assert.equal(complete.results.length,1)
  assert.equal(renders,1)
})

test('background share validation removes empty shares and retains reachable video shares without writing to the cloud', async () => {
  const service=createResourceSearch({renderSearch:async()=>({rows:[]}),validateShare:async item=>item.url.endsWith('empty')?'invalid':'ready',fetcher:async url=>String(url).includes('pansou.app')?Response.json({code:0,data:{merged_by_type:{}}}):new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{data:{data:[{content:'名称：测试剧 4K\nhttps://pan.quark.cn/s/empty'},{content:'名称：测试剧 1080P\nhttps://pan.quark.cn/s/video'}]}}}})}</script>`)})
  const first=await service.search('测试剧')
  assert.equal(first.pending,true)
  await new Promise(resolve=>setImmediate(resolve))
  const checked=await service.search('测试剧')
  assert.equal(checked.pending,false)
  assert.equal(checked.results.length,1)
  assert.equal(checked.results[0].availability,'ready')
  assert.ok(checked.results[0].url.endsWith('video'))
})

test('cached banner is drawn from the current aired quarter with meaningful votes, sorted by score', () => {
  const season = seasonAt(new Date('2026-10-24T12:00:00Z'))
  const item = {
    id: 'a',
    platform: 'TV',
    airDate: '2026-10-02',
    score: 7.5,
    votes: 80,
  }
  const items = [
    item,
    { ...item, id: 'b', score: 8 },
    { ...item, id: 'old', airDate: '2026-07-02', score: 9 },
    { ...item, id: 'unaired', airDate: '2026-11-02', score: 9 },
    { ...item, id: 'few', votes: 3, score: 10 },
    { ...item, id: 'low', score: 6.9 },
    { ...item, id: 'film', platform: '剧场版', score: 9 },
  ]
  assert.deepEqual(
    seasonalBanner(
      { items, slides: [{ id: 'classic', score: 9 }] },
      season,
    ).map((x) => x.id),
    ['b', 'a'],
  )
})

test('banner still contains rated catalog titles when detail service fails', async () => {
  const result = await fetchSeasonal({
    now: new Date('2026-10-24T12:00:00Z'),
    fetcher: async (url) => {
      if (!url.includes('/search/')) return new Response('', { status: 503 })
      return new Response(
        JSON.stringify({
          total: 1,
          data: [
            {
              id: 123,
              platform: 'TV',
              date: '2026-10-02',
              name_cn: '有评分的新番',
              summary: '作品介绍',
              rating: { score: 8, total: 100 },
              images: { common: 'https://lain.bgm.tv/test.jpg' },
            },
          ],
        }),
      )
    },
  })
  assert.equal(result.slides[0].title, '有评分的新番')
  assert.equal(result.slides[0].score, 8)
})

test('season association keeps episode identities, progress and favorite while retaining trusted metadata', () => {
  const media = {
    id: 'local-test',
    episodes: [{ id: 'stable', path: 'D:\\private\\01.mp4' }],
    progress: { stable: { time: 12 } },
    favorite: true,
    manual: { genre: true },
  }
  const subject = {
    id: 'seasonal-123',
    title: '作品第三季',
    subtitle: 'Original',
    description: '简介',
    image: '/covers/poster.jpg',
    airDate: '2026-10-02',
    score: 8.1,
    sourceUrl: 'https://bgm.tv/subject/123',
  }
  assert.equal(attachSeasonalMetadata(media, subject), true)
  assert.equal(media.subjectId, subject.id)
  assert.equal(media.rating, '8.1')
  assert.equal(media.episodes[0].id, 'stable')
  assert.equal(media.progress.stable.time, 12)
  assert.equal(media.favorite, true)
  assert.equal(media.manual.genre, true)
  assert.equal(media.manual.cover, true)
  assert.equal(attachSeasonalMetadata(media, null), false)
})

test('search strips season suffixes, tries aliases and distinguishes explicitly different seasons', () => {
  assert.deepEqual(
    resourceQueries('药屋少女的呢喃 第三季', ['薬屋のひとりごと 第3期']),
    ['药屋少女的呢喃', '薬屋のひとりごと'],
  )
  assert.ok(
    resourceQueries('被放逐的作弊赋予魔术师享受随心所欲的第二人生。').some(
      (x) => x.length <= 8,
    ),
  )
  assert.equal(
    resourceSeasonMatch('药屋少女第三季 附1-2季', '药屋少女 第三季'),
    'season',
  )
  assert.equal(
    resourceSeasonMatch('药屋少女 S02', '药屋少女 第三季'),
    'other-season',
  )
  assert.equal(
    resourceSeasonMatch('药屋少女全集', '药屋少女 第三季'),
    'related',
  )
})

test('multiple providers dedupe shares, retain season labels and tolerate an unavailable source', async () => {
  const calls = []
  const service = createResourceSearch({
    renderSearch: async (queries) => {
      assert.equal(queries[0], '测试动画')
      return {
        rows: [
          {
            title: '测试动画 第三季',
            description: '本季连载',
            url: 'https://pan.quark.cn/s/current123',
            sourceUrl: 'https://www.zhongchuangwl.com/s/test/',
          },
        ],
      }
    },
    fetcher: async (url, options) => {
      calls.push({ url, options })
      if (String(url).startsWith('https://pansou.app/'))
        throw new Error('offline')
      const page = {
        props: {
          pageProps: {
            data: {
              total: 3,
              data: [
                {
                  content:
                    '名称：测试动画 第二季\nhttps://pan.quark.cn/s/old123',
                },
                {
                  content:
                    '名称：测试动画 第三季\nhttps://pan.quark.cn/s/current123',
                },
                {
                  content:
                    '名称：不相关电影\nhttps://pan.quark.cn/s/irrelevant123',
                },
              ],
            },
          },
        },
      }
      return new Response(
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(page)}</script>`,
      )
    },
  })
  const result = await service.search('测试动画 第三季')
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0].match, 'season')
  assert.equal(result.results[1].match, 'other-season')
  assert.deepEqual(
    result.results[0].sources.sort(),
    ['PanSearch', '夸克盘搜'].sort(),
  )
  assert.equal(result.sources.find((s) => s.name === 'PanSou').status, 'error')
  assert.ok(calls.every((c) => !JSON.stringify(c.options).includes('Cookie')))
  await service.search('测试动画 第三季')
  assert.equal(calls.length, 2)
})

test('all sources offline is distinct from a successful empty search', async () => {
  const service = createResourceSearch({
    fetcher: async () => {
      throw new Error('offline')
    },
    renderSearch: async () => {
      throw new Error('网页需要人工验证')
    },
  })
  const result = await service.search('测试作品')
  assert.equal(result.results.length, 0)
  assert.ok(result.sources.every((source) => source.status === 'error'))
  assert.equal(result.sources[0].message, '网页需要人工验证')
})

test('public share cookies never mark an anonymous resource import as an account login', async () => {
  const original = globalThis.fetch
  let persisted = false
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: 0, data: { list: [] } }), {
      headers: { 'Set-Cookie': 'anonymous=test; Path=/' },
    })
  try {
    const client = createQuark(() => '', {
      onCookie: async () => {
        persisted = true
      },
    })
    await client.checkAccount()
    assert.equal(persisted, false)
  } finally {
    globalThis.fetch = original
  }
})
