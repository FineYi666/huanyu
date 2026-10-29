const numbers = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}
export function seasonNumber(value) {
  const text = String(value || '').normalize('NFKC')
  const token =
    text.match(/第\s*([\d一二两三四五六七八九十]+)\s*(?:[季期]|部(?![队隊]))/i)?.[1] ||
    text.match(/(?:\bseason\s*|\bS)(\d{1,2})(?:\b|E\d)/i)?.[1] ||
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i)?.[1]
  if (!token) {
    const roman=text.match(/(?:^|[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])([IVX]{1,5})(?=\s|[~～〜:：]|$)/u)?.[1]
    return {I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10}[roman] || null
  }
  if (/^\d+$/.test(token)) return Number(token) || null
  if (token.includes('十')) {
    const [a, b] = token.split('十')
    return (numbers[a] || 1) * 10 + (numbers[b] || 0)
  }
  return numbers[token] || null
}
const memo = new WeakMap()
export function episodeLayout(episodes, title = '') {
  const cached = memo.get(episodes)
  if (cached?.title === title) return cached.value
  const fallback = seasonNumber(title),
    counts = new Map()
  const value = episodes.map((episode, index) => {
    const name = `${episode.name || episode.title || ''} ${episode.path || ''}`
    const special = episode.seasonGroup === 'special' || /(?:\b(?:OVA|OAD|SP)\b|特别篇|特別篇|特典)/i.test(name)
    const explicit = Number.isInteger(episode.season) && episode.season > 0 ? episode.season : null
    const season = special ? null : explicit || seasonNumber(name) || fallback
    const group = special ? 'special' : season ? `season-${season}` : 'main'
    const number = Number.isInteger(episode.episodeNumber) && episode.episodeNumber > 0 ? episode.episodeNumber : (counts.get(group) || 0) + 1
    counts.set(group, Math.max(counts.get(group) || 0,number))
    return {
      index,
      group,
      season,
      number,
      groupLabel: special ? '特别篇' : season ? `第${season}季` : '正片',
    }
  })
  memo.set(episodes, { title, value })
  return value
}
