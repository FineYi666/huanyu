import { seasonNumber } from './episode-seasons.mjs'
export const titleKey = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
function baseTitle(value) {
  return titleKey(
    String(value || '').normalize('NFKC')
      .replace(
        /第\s*[\d一二两三四五六七八九十]+\s*[季期部]|\b(?:season\s*\d+|\d+(?:st|nd|rd|th)\s+season|s\d{1,2})\b/gi,
        '',
      )
      .replace(/\s*[（(](?:19|20)\d{2}[）)]\s*$/, '')
      .replace(/([\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[IVX]{1,5}(?=\s|[~～〜:：]|$)/gu,'$1')
      .replace(
        /(?:\s*[（(](?:国语|日语|英语|粤语|中字|中文字幕|普通话|配音|字幕)[^）)]*[）)]|(?:国语|日语|英语|粤语|普通话)(?:版)?)$/g,
        '',
      ),
  )
}
export function canonicalWorkKey(title) {
  return `${baseTitle(title)}/${seasonNumber(title) || 1}`
}
export function workSearchTerms(query, aliases = []) {
  const base = String(query).replace(/第\s*[\d一二两三四五六七八九十]+\s*[季期部]|\b(?:season\s*\d+|s\d{1,2})\b/gi, '').trim()
  const short=String(query).split(/\s*[~～〜：:]\s*/)[0].trim()
  const family=short.replace(/第\s*[\d一二两三四五六七八九十]+\s*[季期部]|\b(?:season\s*\d+|s\d{1,2})\b/gi,'').trim()
  return [...new Set([short, family, query, ...aliases, base, String(query).replace(/\s+/g, '')].filter(term=>term&&term.length>=2))].slice(0, 6)
}
const animeFamilies=[['无职转生','無職転生','無職轉生','mushokutensei'],['转生就是剑','转生成为魔剑','転生したら剣でした']]
const animeKey=value=>{
  let key=baseTitle(String(value||'').replace(/\s*[（(](?:更新至|更新到|全\d|已完结|完结)[\s\S]*[）)]\s*$/,'')).replace(/(?:第?\d+(?:クール|部分)|part\d+)$/i,'')
  for(const names of animeFamilies)for(const name of names){const root=titleKey(name);if(key===root || (key.startsWith(root) && /^(到了异世界就拿出真本事|到了異世界就拿出真本事|異世界行ったら本気だす|joblessreincarnation)$/.test(key.slice(root.length))))return titleKey(names[0])}
  return key
}
function equivalentAnime(a,b){
  const x=animeKey(a),y=animeKey(b)
  if(x===y)return true
  // Allow an actual subtitle after an explicit separator, not arbitrary prefixes.
  const short=value=>animeKey(String(value).split(/\s*[~～〜：:]\s*/)[0])
  return short(a).length>=3 && short(a)===short(b)
}
export const animeTitleRelevant=(name,query)=>equivalentAnime(name,query)
export function matchesWork(candidate, query, { aliases = [], category } = {}) {
  const name = String(candidate.title || candidate.vod_name || '')
  if (
    !name ||
    /解说|解說|预告|預告|花絮|速看|看完|盘点|合集|混剪|短剧/.test(name)
  )
    return false
  const kind = String(candidate.type || candidate.type_name || '')
  if (category === 'tv' && (
    /动漫|动画|動畫|综艺|綜藝|电影|電影|解说|解說|短剧|短劇/.test(kind) ||
    !/电视剧|電視劇|连续剧|連續劇|国产剧|國產劇|大陆剧|大陸劇|欧美剧|歐美劇|美剧|英剧|日剧|韩剧|韓劇|日本剧|韩国剧|泰剧|泰国剧|海外剧|香港剧|台湾剧|台灣劇|港台剧|港剧|台剧|新马剧|新加坡剧|马来西亚剧|其他剧|series|drama/i.test(kind)
  )) return false
  if (category === 'anime' && kind && !/动漫|动画|動畫|番剧|番劇/.test(kind))
    return false
  if (
    category === 'movie' &&
    /电视剧|连续剧|综艺|日韩动漫|国产动漫|欧美动漫/.test(kind)
  )
    return false
  const targets = [query, ...aliases].filter(Boolean),
    requestedSeason = targets.map(seasonNumber).find(Boolean)
  let actualSeason = seasonNumber(name), comparable = baseTitle(name)
  if (!actualSeason && requestedSeason && targets.some(term => baseTitle(term) === comparable.replace(/\d{1,2}$/, ''))) {
    actualSeason = Number(comparable.match(/\d{1,2}$/)?.[0]) || null
    comparable = comparable.replace(/\d{1,2}$/, '')
  }
  if ((requestedSeason || 1) !== (actualSeason || 1)) return false
  return targets.some((term) => comparable === baseTitle(term) || (category==='anime'&&equivalentAnime(name,term)))
}
