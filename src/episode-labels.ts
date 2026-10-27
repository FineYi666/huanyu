import { episodeLayout } from '../episode-seasons.mjs'
import type { Episode } from './types'
const digits = '零一二三四五六七八九'
const units = ['', '十', '百', '千']

function chineseNumber(value: number): string {
  if (value >= 10000) {
    const rest = value % 10000
    return (
      chineseNumber(Math.floor(value / 10000)) +
      '万' +
      (rest
        ? (rest < 1000 ? '零' : '') + chineseNumber(rest).replace(/^十/, '一十')
        : '')
    )
  }
  let result = '',
    needsZero = false
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(value / 10 ** place) % 10
    if (digit) {
      if (needsZero) result += '零'
      result += digits[digit] + units[place]
      needsZero = false
    } else if (result) needsZero = true
  }
  return result.replace(/^一十/, '十')
}

/** Index belongs to the full episode list, never the filtered or reversed view. */
export function episodeLabel(index: number, episodes?: Episode[], title = ''): string {
  const item = episodes && episodeLayout(episodes, title)[index]
  return `${item?.season ? `第${chineseNumber(item.season)}季 · ` : item?.group === 'special' ? '特别篇 · ' : ''}第${chineseNumber(item?.number || index + 1)}集`
}

export function matchesEpisode(
  name: string,
  index: number,
  query: string,
  episodes?: Episode[],
  title = '',
): boolean {
  const term = query.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, '')
  if (!term) return true
  if (/^(?:第)?\d+(?:集|话)?$/.test(term))
    return Number(term.replace(/\D/g, '')) === (episodes ? episodeLayout(episodes, title)[index]?.number : index + 1)
  return (
    episodeLabel(index, episodes, title).includes(term) ||
    name.normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(term)
  )
}
