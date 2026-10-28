export const MEDIA_CATEGORIES = ['anime', 'movie', 'tv']

export function mediaCategory(media) {
  if (media.metadataInfo?.kind === 'series' && !media.manual?.category)
    return 'tv'
  if (MEDIA_CATEGORIES.includes(media.category)) return media.category
  if (media.genre === '电视剧') return 'tv'
  return media.genre === '电影' || media.metadataInfo?.kind === 'movie'
    ? 'movie'
    : 'anime'
}
