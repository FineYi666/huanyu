import { isIP } from 'node:net'
import { createDecipheriv } from 'node:crypto'
import { inspectVideoSample } from './video-resolution.mjs'
import { readMp4Index } from './mp4-subtitles.mjs'
export function publicVideoUrl(value, base) {
  const url = new URL(value, base),
    host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    host === 'localhost' ||
    /\.(?:localhost|local|internal)$/.test(host) ||
    (isIP(host) &&
      (/^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\./.test(
        host,
      ) ||
        host.includes(':')))
  )
    throw new Error('播放源包含不支持的地址')
  return url.href
}
export async function fetchPublicVideo(
  url,
  { fetcher = fetch, headers = {}, range, timeout = 8000 } = {},
) {
  for (let i = 0; i < 5; i++) {
    url = publicVideoUrl(url)
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Huanyu/1.3',
        ...headers,
        ...(range ? { Range: range } : {}),
      },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get('location')
      await response.body?.cancel().catch(() => {})
      if (!target) throw new Error('播放源跳转无效')
      url = publicVideoUrl(target, url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`播放源暂不可用（${response.status}）`)
    }
    return { response, url: response.url || url }
  }
  throw new Error('播放源跳转过多')
}
async function bytes(response, limit) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('播放源返回空内容')
  const chunks = []
  let size = 0
  try {
    while (size < limit) {
      const part = await reader.read()
      if (part.done) break
      const chunk = part.value.subarray(0, limit - size)
      chunks.push(chunk)
      size += chunk.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks, size)
}
export async function probeStream(source, { fetcher = fetch, inspect = inspectVideoSample } = {}, depth = 0) {
  if (depth > 3) throw new Error('播放列表层级过多')
  const { response, url } = await fetchPublicVideo(source.url, {
    fetcher,
    headers: source.headers,
    range: /\.m3u8(?:$|\?)/i.test(source.url) ? undefined : 'bytes=0-65535',
  })
  const buffer = await bytes(response, 65536),
    text = buffer
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart()
  if (text.startsWith('#EXTM3U')) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()),
      variants = []
    for (let i = 0; i < lines.length; i++)
      if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
        const next = lines
          .slice(i + 1)
          .find((line) => line && !line.startsWith('#'))
        if (next) {
          const [, width, height] =
            lines[i].match(/RESOLUTION=(\d+)x(\d+)/) || []
          variants.push({
            url: publicVideoUrl(next, url),
            height: Number(height) || 0,
            width: Number(width) || 0,
            bitrate: Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1]) || 0,
          })
        }
      }
    if (variants.length) {
      variants.sort(
        (a, b) =>
          b.height * b.width - a.height * a.width || b.bitrate - a.bitrate,
      )
      const verified = []
      for (const variant of variants.slice(0, 6))
        try {
          const child = await probeStream(
            { ...source, url: variant.url },
            { fetcher, inspect },
            depth + 1,
          )
          verified.push({ ...variant, ...(child.height ? { height: child.height, width: child.width || variant.width } : {}), resolutionSource: child.resolutionSource || 'manifest', url: child.url, format: 'hls' })
        } catch {}
      verified.sort((a,b) => b.height - a.height || b.bitrate - a.bitrate)
      if (verified.length)
        return {
          url: verified[0].url,
          format: 'hls',
          height: verified[0].height,
          width: verified[0].width,
          resolutionSource: verified[0].resolutionSource,
          variants: verified,
        }
      throw new Error('所有清晰度线路均无法读取')
    }
    if (!lines.some((line) => line.startsWith('#EXTINF:')))
      throw new Error('播放列表没有正片分段')
    const segment = lines.find((line) => line && !line.startsWith('#'))
    if (!segment) throw new Error('播放列表为空')
    const sample = await fetchPublicVideo(publicVideoUrl(segment, url), {
        fetcher,
        headers: source.headers,
        range: 'bytes=0-262143',
      }),
      data = await bytes(sample.response, 262144)
    let videoBytes = data
    if (
      !data.length ||
      /^\s*(?:<!doctype|<html|\{)/i.test(data.toString('utf8'))
    )
      throw new Error('视频分段失效')
    const key = lines.find(
      (line) => /^#EXT-X-KEY:/.test(line) && !line.includes('METHOD=NONE'),
    )
    if (key) {
      if (!key.includes('METHOD=AES-128')) throw new Error('此加密方式暂不支持')
      const uri = key.match(/URI="([^"]+)"/)?.[1]
      if (!uri) throw new Error('缺少视频密钥')
      const k = await fetchPublicVideo(publicVideoUrl(uri, url), {
        fetcher,
        headers: source.headers,
      })
      const keyBytes = await bytes(k.response, 17)
      if (keyBytes.length !== 16)
        throw new Error('视频密钥无法读取')
      try {
        const iv = Buffer.alloc(16)
        const explicit = key.match(/IV=0x([0-9a-f]{1,32})/i)?.[1]
        if (explicit) Buffer.from(explicit.padStart(32, '0'), 'hex').copy(iv)
        else iv.writeBigUInt64BE(BigInt(lines.find(line => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))?.split(':')[1] || 0), 8)
        const decipher = createDecipheriv('aes-128-cbc', keyBytes, iv)
        decipher.setAutoPadding(false)
        videoBytes = decipher.update(data.subarray(0, Math.floor(data.length / 16) * 16))
      } catch { videoBytes = Buffer.alloc(0) }
    } else if (
      data[0] !== 0x47 &&
      !['ftyp', 'styp', 'moof', 'moov'].includes(
        data.subarray(4, 8).toString(),
      ) &&
      data.subarray(0, 3).toString() !== 'ID3'
    )
      throw new Error('视频分段内容不可识别')
    const map = lines
      .find((line) => line.startsWith('#EXT-X-MAP:'))
      ?.match(/URI="([^"]+)"/)?.[1]
    if (map) {
      const init = await fetchPublicVideo(publicVideoUrl(map, url), {
        fetcher,
        headers: source.headers,
        range: 'bytes=0-65535',
      })
      const data = await bytes(init.response, 65536)
      if (!['ftyp', 'styp', 'moov'].includes(data.subarray(4, 8).toString()))
        throw new Error('视频初始化分段无法读取')
      videoBytes = Buffer.concat([data, videoBytes])
    }
    const resolution = await inspect(videoBytes)
    return { url, format: 'hls', ...resolution }
  }
  if (
    buffer.subarray(4, 8).toString() === 'ftyp' ||
    buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    let resolution = await inspect(buffer)
    if (!resolution && buffer.subarray(4, 8).toString() === 'ftyp') {
      let requests = 0, consumed = 0
      try {
        const index = await readMp4Index({ url }, async (_, start, length) => {
          if (++requests > 10 || (consumed += length) > 2 * 1024 * 1024) throw new Error('Resolution index exceeds budget')
          const part = await fetchPublicVideo(url, { fetcher, headers: source.headers, range: `bytes=${start}-${start + length - 1}` })
          if (part.response.status !== 206 || !part.response.headers.get('content-range')?.startsWith(`bytes ${start}-`)) {
            await part.response.body?.cancel().catch(() => {})
            throw new Error('Precise ranges unavailable')
          }
          const data = await bytes(part.response, length)
          if (data.length !== length) throw new Error('Incomplete resolution index')
          return data
        })
        const track = index.tracks.find(track => track.width && track.height)
        if (track) resolution = { width: track.width, height: track.height, resolutionSource: 'sample' }
      } catch {}
    }
    return { url, format: 'file', ...resolution }
  }
  throw new Error('播放源返回网页或无法识别的视频内容')
}
