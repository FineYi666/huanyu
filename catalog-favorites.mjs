import { attachSeasonalMetadata } from './seasonal-metadata.mjs'

export function setCatalogFavorite(media, subject, favorite) {
  if (!subject?.id || !subject.title) throw new Error('无法找到这部作品的资料，请刷新片单后重试')
  const matches = media.filter(item=>item.subjectId===subject.id && item.source!=='sample')
  for (const item of matches) item.favorite=favorite
  if (favorite && !matches.length) {
    const item={id:`favorite-${subject.id}`,source:'catalog',episodes:[],addedAt:Date.now(),favorite:true}
    attachSeasonalMetadata(item,subject)
    media.unshift(item)
  }
  if (!favorite) for (let index=media.length-1;index>=0;index--)
    if(media[index].source==='catalog' && media[index].subjectId===subject.id)media.splice(index,1)
}

export function inheritCatalogFavorite(media, collection) {
  if (media.subjectId && collection.some(item=>item.subjectId===media.subjectId && item.favorite))media.favorite=true
}
