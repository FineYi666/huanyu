import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { filterMovies, movieGenres, movieText } from './movie-filters.mjs'

export async function createMovieCatalog(root) {
  let seed = { movies: [], updatedAt: null }
  try { seed = JSON.parse(await readFile(path.join(root, 'movie-seed.json'), 'utf8')) } catch {}
  const movies = (seed.movies || []).filter((movie) => /^douban-\d+$/.test(movie.id) && movie.title)
    .map((movie, index) => ({ ...movie, title: movieText(movie.title), foreignTitle: movieText(movie.foreignTitle), quote: movieText(movie.quote), rank: index + 1, genres: movieGenres(movie.genre) }))
  return {
    get(options = {}) { return { movies: filterMovies(movies, options), total: movies.length, genres: [...new Set(movies.flatMap((movie) => movie.genres))], updatedAt: seed.updatedAt } },
    findSubject(id) {
      const movie = movies.find((item) => item.id === id)
      return movie && { id: movie.id, title: movie.title, subtitle: movie.foreignTitle || '',
        description: movie.quote || `${movie.year} · ${movie.genres.join(' / ')} · 豆瓣评分 ${movie.score}`,
        image: movie.cover, score: movie.score, year: movie.year, genre: movie.genres[0],
        category: 'movie', provider: '豆瓣', sourceUrl: movie.url }
    },
  }
}
