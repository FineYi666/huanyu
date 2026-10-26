import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createMovieCatalog } from '../movie-catalog.mjs'
import { filterMovies, movieGenres, movieSearchKey } from '../movie-filters.mjs'
import { attachSeasonalMetadata } from '../seasonal-metadata.mjs'

const movies = [
  { id: 'douban-1', title: '星际穿越', foreignTitle: 'Interstellar', score: 9.4, year: '2014', genre: '&nbsp;剧情 科幻 冒险', cover: '/artwork/movies/1.jpg', url: 'https://movie.douban.com/subject/1/' },
  { id: 'douban-2', title: '机器人总动员', foreignTitle: 'WALL·E', score: 9.3, year: '2008', genre: '动画 / 科幻 / 爱情' },
  { id: 'douban-3', title: '喜剧电影', score: 8.5, year: '2024', genre: '喜剧' },
]
test('movie catalog supports Chinese names, original names and multi-genre filters', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'huanyu-movies-'))
  await writeFile(path.join(root, 'movie-seed.json'), JSON.stringify({ movies }))
  const catalog = await createMovieCatalog(root)
  assert.deepEqual(movieGenres('&nbsp;剧情\u00a0科幻 / 科幻'), ['剧情', '科幻'])
  assert.equal(movieSearchKey('Schindler&#39;s List'), movieSearchKey("Schindler's List"))
  assert.equal(movieSearchKey('Hachi: A Dog&#x27;s Tale'), movieSearchKey("Hachi: A Dog's Tale"))
  assert.equal(catalog.get({ query: '星际 穿越' }).movies[0].id, 'douban-1')
  assert.equal(catalog.get({ query: 'INTERSTELLAR' }).movies[0].id, 'douban-1')
  assert.equal(catalog.get({ query: 'WALL-E', genre: '科幻' }).movies[0].id, 'douban-2')
  assert.equal(catalog.get({ genre: '科幻' }).movies.length, 2)
  assert.equal(catalog.get({ query: '星际穿越', genre: '喜剧' }).movies.length, 0)
  assert.equal(filterMovies(catalog.get().movies, { sort: 'year' })[0].id, 'douban-3')
  const subject = catalog.findSubject('douban-1')
  const media = { episodes: [{ id: 'ep' }] }
  attachSeasonalMetadata(media, subject)
  assert.equal(media.category, 'movie')
  assert.equal(media.genre, '剧情')
  assert.equal(media.posterProvider, '豆瓣')
  assert.equal(media.year, '2014')
  assert.equal(media.cover, movies[0].cover)
  assert.equal(catalog.findSubject('douban-999'), undefined)
})
