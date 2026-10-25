import test from 'node:test'
import assert from 'node:assert/strict'
import { seasonAt, selectSeasonal, fetchSeasonal } from '../seasonal.mjs'

test('quarter boundaries follow Asia/Shanghai and exclude unaired, low-vote and low-score titles', () => {
  const season = seasonAt(new Date('2026-09-30T16:00:00Z'))
  assert.equal(season.id, '2026-Q4')
  assert.equal(season.end, '2027-01-01')
  assert.equal(season.today, '2026-10-01')
  assert.equal(seasonAt(new Date('2026-12-31T16:00:00Z')).id, '2027-Q1')
  const base = {
    id: 1,
    platform: 'TV',
    date: '2026-10-01',
    rating: { score: 7.5, total: 100 },
  }
  const items = [
    base,
    base,
    { ...base, id: 2, date: '2026-10-02' },
    { ...base, id: 3, date: '2026-09-30' },
    { ...base, id: 4, rating: { score: 9, total: 2 } },
    { ...base, id: 5, rating: { score: 6.9, total: 1000 } },
    { ...base, id: 6, platform: '剧场版' },
    { ...base, id: 7, nsfw: true },
    { ...base, id: 8, rating: { score: 8, total: 40 } },
  ]
  assert.deepEqual(
    selectSeasonal(items, season).map((item) => item.id),
    [8, 1],
  )
})

test('seasonal recommendation data is sourced from dated API ratings and detail pages', async () => {
  const calls = []
  const result = await fetchSeasonal({
    now: new Date('2026-10-23T12:00:00Z'),
    fetcher: async (url, options) => {
      calls.push({ url, options })
      return new Response(
        JSON.stringify(
          url.includes('search')
            ? {
                total: 1,
                data: [
                  {
                    id: 123,
                    platform: 'TV',
                    date: '2026-10-02',
                    rating: { score: 7.8, total: 130 },
                  },
                ],
              }
            : {
                name_cn: '新番名称',
                name: 'Title',
                summary: '来源简介。',
                images: { large: 'https://lain.bgm.tv/cover.jpg' },
              },
        ),
        { headers: { 'content-type': 'application/json' } },
      )
    },
  })
  assert.deepEqual(JSON.parse(calls[0].options.body).filter.air_date, [
    '>=2026-10-01',
    '<2027-01-01',
  ])
  assert.equal(result.slides[0].score, 7.8)
  assert.equal(result.slides[0].votes, 130)
  assert.equal(result.slides[0].sourceUrl, 'https://bgm.tv/subject/123')
  assert.equal(result.slides[0].description, '来源简介。')
  assert.equal(result.updatedAt, '2026-10-23T12:00:00.000Z')
})
