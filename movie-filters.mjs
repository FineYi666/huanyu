export function movieText(value) {
  const entities = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>' }
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi, (match, code) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()] || match
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  })
}
export function movieGenres(value) {
  return [...new Set(movieText(value).split(/[\s/、，,|]+/).map((part) => part.trim()).filter(Boolean))]
}
export function movieSearchKey(value) {
  return movieText(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}
export function filterMovies(movies, { query = '', genre = '全部', sort = 'rank' } = {}) {
  const keyword = movieSearchKey(query)
  return movies.filter((movie) => (!keyword || movieSearchKey(`${movie.title} ${movie.foreignTitle || ''}`).includes(keyword)) &&
    (genre === '全部' || (movie.genres || movieGenres(movie.genre)).includes(genre)))
    .sort((a, b) => sort === 'score' ? b.score - a.score || a.rank - b.rank : sort === 'year' ? Number(b.year) - Number(a.year) || a.rank - b.rank : a.rank - b.rank)
}
