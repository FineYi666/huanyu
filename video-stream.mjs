import {publicVideoUrl} from './stream-probe.mjs'
function videoUrl(value, base) {
  const url = new URL(value, base)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('视频流包含不支持的资源地址，请使用夸克官方网页播放')
  return url
}

// Signed CDN URLs can redirect to another host. Never forward the account's
// Cookie to a third-party CDN or to a different host named inside a playlist.
export async function fetchVideoSource(source, { method, range, signal }) {
  let url = videoUrl(source.url)
  for (let redirects = 0; redirects <= 5; redirects++) {
    if(source.web)publicVideoUrl(url.href)
    const headers = new Headers(source.headers)
    if (
      !['quark.cn', 'uc.cn', 'ucweb.com'].some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith('.' + domain),
      )
    )
      headers.delete('Cookie')
    if (range) headers.set('Range', range)
    const response = await fetch(url, {
      method,
      headers,
      signal,
      redirect: 'manual',
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('视频源跳转失败，请重新打开播放')
    url = videoUrl(location, url)
  }
  throw new Error('视频源跳转次数过多，请使用夸克官方网页播放')
}

export function rewritePlaylist(playlist, base, createProxyUrl) {
  const proxied = (uri) => createProxyUrl(videoUrl(uri, base).href)
  return playlist
    .split('\n')
    .map((line) => {
      if (line.startsWith('#'))
        return line.replace(
          /URI="([^"]+)"/g,
          (_, uri) => `URI="${proxied(uri)}"`,
        )
      return line.trim() ? proxied(line.trim()) : line
    })
    .join('\n')
}
