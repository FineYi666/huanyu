import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameResourceSearch, GAME_RESOURCE_SITES, parseGameSearch } from '../game-resources.mjs'

const cheeseRows = `<h2 class="item-heading"><a href="https://www.cheesegame.org/1.html">[PC]寂静岭2<span class="aidoc-cover">好评 2024</span></a></h2>
<h2 class="item-heading"><a href="https://www.cheesegame.org/2.html">[PC]寂静岭 死链接</a></h2>
<h2 class="item-heading"><a href="https://www.cheesegame.org/3.html">[PC]寂静岭 跳转</a></h2>
<h2 class="item-heading"><a href="https://www.cheesegame.org/4.html">[PC]寂静岭 下架</a></h2>
<h2 class="item-heading"><a href="https://www.cheesegame.org/5.html">寂静岭 电影 蓝光</a></h2>
<h2 class="item-heading"><a href="https://www.cheesegame.org/6.html">[PC]别的游戏</a></h2>
<h2 class="item-heading"><a href="https://www.cheesegame.org.evil.test/7.html">[PC]寂静岭</a></h2>`
const shareRows = `<a href="/posts/123"><div><h2>寂静岭F 免安装中文版</h2></div></a><a href="/posts/124"><h2>寂静岭 电影 1080p</h2></a>`
test('game result parsing keeps matching game articles on the exact two site domains', () => {
  const cheese = parseGameSearch(cheeseRows, GAME_RESOURCE_SITES[0], '寂静岭')
  assert.equal(cheese.length, 4)
  assert.equal(cheese[0].title, '[PC]寂静岭2')
  assert.deepEqual(parseGameSearch(shareRows, GAME_RESOURCE_SITES[1], '寂静岭'), [{ title: '寂静岭F 免安装中文版', url: 'https://www.gameshare.cc/posts/123' }])
})
test('game search verifies detail pages, removes dead and redirected links, and never contacts aggregators', async () => {
  const requests = []
  let deleted = false
  const service = createGameResourceSearch({ fetcher: async (input, options) => {
    const url = new URL(input)
    requests.push(url.href)
    assert.ok(['www.cheesegame.org', 'www.gameshare.cc'].includes(url.hostname))
    assert.equal(options.headers.Cookie, undefined)
    assert.equal(options.redirect, 'manual')
    if (url.searchParams.has('s')) return new Response(cheeseRows)
    if (url.pathname === '/search') return new Response(shareRows)
    if (url.pathname === '/1.html') return new Response('<h1>[PC]寂静岭2</h1>', { status: deleted ? 404 : 200 })
    if (url.pathname === '/2.html') return new Response('', { status: 404 })
    if (url.pathname === '/3.html') return new Response('', { status: 302, headers: { location: 'https://other.example/download' } })
    if (url.pathname === '/4.html') return new Response('<h1>寂静岭</h1><article>资源已下架</article>')
    if (url.pathname === '/posts/123') return new Response('<h1>寂静岭F</h1>', { status: deleted ? 404 : 200 })
    throw new Error('Unexpected URL')
  } })
  const found = await service.search('寂静岭')
  assert.equal(found.results.length, 2)
  assert.deepEqual(found.results.map((result) => result.source), ['芝士游戏', 'Game Share'])
  assert.ok(found.results.every((result) => result.links[0].url === result.sourceUrl))
  assert.ok(!requests.some((url) => /pansou|pansearch|zhongchuang|other\.example/.test(url)))
  deleted = true
  assert.deepEqual((await service.search('寂静岭')).results, [])
})
test('empty or unavailable game sources return no results instead of a different search provider', async () => {
  const empty = await createGameResourceSearch({ fetcher: async () => new Response('<h1>没有结果</h1>') }).search('不存在的游戏')
  assert.deepEqual(empty.results, [])
  const offline = await createGameResourceSearch({ fetcher: async () => { throw new Error('offline') } }).search('寂静岭')
  assert.deepEqual(offline.results, [])
  assert.ok(offline.sources.every((source) => source.status === 'error'))
})
