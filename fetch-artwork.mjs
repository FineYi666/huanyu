import { mkdir, writeFile, readFile } from 'node:fs/promises'
const directory = new URL('./public/artwork/', import.meta.url)
await mkdir(directory, { recursive: true })
const sources = []
async function request(url, options = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'Yingyu/1.0 (local personal cinema)',
          ...options.headers,
        },
        signal: AbortSignal.timeout(16000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response
    } catch (e) {
      if (i === 2) throw e
    }
  }
}
const items = [
  ['frieren', '葬送的芙莉莲', 400602],
  ['apothecary', '药屋少女的呢喃'],
  ['bocchi', '孤独摇滚', 328609],
  ['dungeon', '迷宫饭'],
  ['spy', '间谍过家家'],
  ['violet', '紫罗兰永恒花园'],
  ['natsume', '夏目友人帐'],
  ['yourname', '你的名字。'],
  ['haikyu', '排球少年'],
  ['chihiro', '千与千寻'],
  ['howls', '哈尔的移动城堡'],
  ['yuru', '摇曳露营'],
]
for (const [key, name, knownId] of items) {
  try {
    let subject
    if (knownId)
      subject = await (
        await request(`https://api.bgm.tv/v0/subjects/${knownId}`)
      ).json()
    else {
      const result = await (
        await request('https://api.bgm.tv/v0/search/subjects?limit=5', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: name,
            sort: 'match',
            filter: { type: [2] },
          }),
        })
      ).json()
      subject = result.data?.[0]
      if (!subject) throw new Error('No subject')
    }
    const imageUrl = subject.images?.large || subject.images?.common
    const image = await request(imageUrl)
    await writeFile(
      new URL(`${key}.jpg`, directory),
      Buffer.from(await image.arrayBuffer()),
    )
    sources.push({
      file: `${key}.jpg`,
      work: subject.name_cn || subject.name,
      source: `https://bgm.tv/subject/${subject.id}`,
      image: imageUrl,
    })
    console.log('Saved', key, subject.id, subject.name_cn)
  } catch (error) {
    console.log('FAILED', key, error.message)
  }
}
for (const [name, url, source] of [
  [
    'hero-howls.jpg',
    'https://www.ghibli.jp/gallery/howl048.jpg',
    'https://www.ghibli.jp/works/howl/',
  ],
  [
    'hero-chihiro.jpg',
    'https://www.ghibli.jp/gallery/chihiro043.jpg',
    'https://www.ghibli.jp/works/chihiro/',
  ],
]) {
  try {
    const image = await request(url)
    await writeFile(
      new URL(name, directory),
      Buffer.from(await image.arrayBuffer()),
    )
    sources.push({ file: name, source, image: url })
    console.log('Saved', name)
  } catch (error) {
    console.log('FAILED', name, error.message)
  }
}
await writeFile(
  new URL('SOURCES.json', directory),
  JSON.stringify(sources, null, 2),
)
