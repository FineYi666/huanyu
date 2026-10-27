import { seasonNumber } from './episode-seasons.mjs'
export const titleKey = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
function baseTitle(value) {
  return titleKey(
    String(value || '')
      .replace(
        /第\s*[\d一二两三四五六七八九十]+\s*[季期]|\b(?:season\s*\d+|\d+(?:st|nd|rd|th)\s+season|s\d{1,2})\b/gi,
        '',
      )
      .replace(
        /(?:\s*[（(](?:国语|日语|英语|粤语|中字|中文字幕|普通话|配音|字幕)[^）)]*[）)]|(?:国语|日语|英语|粤语|普通话)(?:版)?)$/g,
        '',
      ),
  )
}
export function matchesWork(candidate, query, { aliases = [], category } = {}) {
  const name = String(candidate.title || candidate.vod_name || '')
  if (
    !name ||
    /解说|解說|预告|預告|花絮|速看|看完|盘点|合集|混剪|短剧/.test(name)
  )
    return false
  const kind = String(candidate.type || candidate.type_name || '')
  if (category === 'anime' && kind && !/动漫|动画|動畫|番剧|番劇/.test(kind))
    return false
  if (
    category === 'movie' &&
    /电视剧|连续剧|综艺|日韩动漫|国产动漫|欧美动漫/.test(kind)
  )
    return false
  const targets = [query, ...aliases].filter(Boolean),
    requestedSeason = targets.map(seasonNumber).find(Boolean),
    actualSeason = seasonNumber(name)
  if ((requestedSeason || 1) !== (actualSeason || 1)) return false
  return targets.some((term) => baseTitle(name) === baseTitle(term))
}
