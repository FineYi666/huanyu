export type MediaCategory = 'anime' | 'movie' | 'tv'
export const MEDIA_CATEGORIES: MediaCategory[]
export function mediaCategory(media: { category?: string; genre?: string; metadataInfo?: { kind?: string }; manual?: { category?: boolean } }): MediaCategory
