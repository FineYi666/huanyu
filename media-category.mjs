export function mediaCategory(media) {
  if (['anime', 'movie'].includes(media.category)) return media.category
  return media.genre === '电影' || media.metadataInfo?.kind === 'movie'
    ? 'movie'
    : 'anime'
}
