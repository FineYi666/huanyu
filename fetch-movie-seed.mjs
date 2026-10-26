// 抓取豆瓣 Top250 生成电影推荐种子（标题/评分/年份/本地封面/链接）。
// 用法：node fetch-movie-seed.mjs （需可访问 movie.douban.com）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const output = path.join(root, 'movie-seed.json')
const coverDir = path.join(root, 'public', 'artwork', 'movies')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Yingyu/1.3'
const baseHeaders = {
  'User-Agent': UA,
  Referer: 'https://movie.douban.com/top250',
  Accept: 'text/html,application/json,image/jpeg',
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchPage(start) {
  const response = await fetch(`https://movie.douban.com/top250?start=${start}`, {
    headers: baseHeaders,
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`豆瓣返回 ${response.status}`)
  return response.text()
}

function parsePage(html) {
  const movies = []
  const blocks = html.split('<div class="item">').slice(1)
  for (const block of blocks) {
    const id = (/subject\/(\d+)\/?/.exec(block) || [])[1]
    const title = (/class="title">([^<&]+)</.exec(block) || [])[1]?.trim()
    const foreign = (block.match(/&nbsp;\/&nbsp;([^<\n]+)</) || [])[1]?.trim()
    const score = (/class="rating_num"[^>]*>([\d.]+)</.exec(block) || [])[1]
    const cover = (/src="(https:\/\/img\d?\.doubanio\.com\/[^"]+\.jpg)"/.exec(block) || [])[1]
    const year = (/(\d{4})&nbsp;\/&nbsp;/.exec(block) || [])[1]
    const quote = (/class="inq">([^<]+)</.exec(block) || [])[1]?.trim()
    const genres = (block.match(/&nbsp;\/&nbsp;\n?\s*([^<\n]+?)\s*<\/p>/) || [])[1]
    if (!id || !title || !score || !cover) continue
    movies.push({
      id: `douban-${id}`,
      title,
      foreignTitle: foreign || '',
      score: Number(score),
      coverUrl: cover,
      year: year || '',
      genre: (genres || '').split('/').pop()?.trim() || '',
      quote: quote || '',
      url: `https://movie.douban.com/subject/${id}/`,
    })
  }
  return movies
}

async function downloadCover(movie) {
  const target = path.join(coverDir, `m${movie.id.replace('douban-', '')}.jpg`)
  if (fs.existsSync(target)) {
    movie.cover = `/artwork/movies/${path.basename(target)}`
    return
  }
  const response = await fetch(movie.coverUrl, {
    headers: { ...baseHeaders, Referer: 'https://movie.douban.com/' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`封面 ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < 1000) throw new Error('封面过小')
  fs.writeFileSync(target, bytes)
  movie.cover = `/artwork/movies/${path.basename(target)}`
}

fs.mkdirSync(coverDir, { recursive: true })
const all = []
const seen = new Set()
for (let start = 0; start < 250; start += 25) {
  const html = await fetchPage(start)
  const page = parsePage(html)
  for (const movie of page)
    if (!seen.has(movie.id)) {
      seen.add(movie.id)
      all.push(movie)
    }
  console.log(`start=${start}: 累计 ${all.length} 部`)
  await sleep(600)
}
console.log('共解析', all.length, '部，开始下载封面…')
let done = 0,
  failed = 0
for (const movie of all) {
  try {
    await downloadCover(movie)
  } catch {
    failed++
    movie.cover = ''
  }
  done++
  if (done % 50 === 0) console.log(`封面 ${done}/${all.length}`)
  await sleep(120)
}
console.log(`封面完成（失败 ${failed}）`)
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      source: 'douban-top250',
      updatedAt: new Date().toISOString(),
      movies: all,
    },
    null,
    1,
  ),
)
console.log('movie-seed.json 已生成:', all.length, '部')
