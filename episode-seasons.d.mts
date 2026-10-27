export type EpisodeLayout = {
  index: number
  group: string
  season: number | null
  number: number
  groupLabel: string
}
export function seasonNumber(value?: string): number | null
export function episodeLayout(
  episodes: { name?: string; title?: string; path?: string; season?:number|null; seasonGroup?:string }[],
  title?: string,
): EpisodeLayout[]
