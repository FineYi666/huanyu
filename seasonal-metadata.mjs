export function attachSeasonalMetadata(media, subject) {
  if (!subject) return false
  Object.assign(media, {
    subjectId: subject.id,
    title: subject.title,
    subtitle: subject.subtitle,
    description: subject.description,
    cover: subject.image,
    year: subject.airDate?.slice(0, 4),
    rating: subject.score ? subject.score.toFixed(1) : undefined,
    category: 'anime',
    posterProvider: 'Bangumi',
    posterSourceUrl: subject.sourceUrl,
    metadataStatus: 'ready',
    metadataError: '',
    manual: {
      ...media.manual,
      title: true,
      description: true,
      cover: true,
      category: true,
    },
  })
  return true
}
