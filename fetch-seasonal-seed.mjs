import { writeFile } from 'node:fs/promises'
import { fetchSeasonal } from './seasonal.mjs'
const result = await fetchSeasonal({
  async saveImage(id, image) {
    const name = `seasonal-${id}.${image.extension}`
    await writeFile(
      new URL(`./public/artwork/${name}`, import.meta.url),
      image.bytes,
    )
    return `/artwork/${name}`
  },
})
await writeFile(
  new URL('./seasonal.json', import.meta.url),
  JSON.stringify(result, null, 2),
)
await writeFile(
  new URL('./public/seasonal.json', import.meta.url),
  JSON.stringify(result, null, 2),
)
console.log(
  JSON.stringify(
    {
      season: result.season.label,
      updatedAt: result.updatedAt,
      slides: result.slides.map(({ title, score, votes }) => ({
        title,
        score,
        votes,
      })),
    },
    null,
    2,
  ),
)
