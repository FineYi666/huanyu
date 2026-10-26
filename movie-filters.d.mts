export interface RecommendedMovie {
  id: string; title: string; foreignTitle?: string; score: number; cover: string;
  year: string; quote?: string; genre?: string; genres: string[]; rank: number; url: string;
}
export function movieGenres(value?: string): string[]
export function movieText(value?: string): string
export function movieSearchKey(value?: string): string
export function filterMovies(movies: RecommendedMovie[], options?: {query?: string; genre?: string; sort?: string}): RecommendedMovie[]
