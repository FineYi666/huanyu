import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchVideoSource, rewritePlaylist } from '../video-stream.mjs'

test('HLS manifests proxy nested playlists, maps, encryption keys and relative media without exposing upstream URLs', () => {
  const urls = []
  const manifest = rewritePlaylist(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="../key?token=private"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-STREAM-INF:BANDWIDTH=300000\nvariant/index.m3u8\n#EXTINF:5,\nsegment.m4s?token=private\n',
    'https://video.quark.cn/path/master.m3u8?secret=private',
    (url) => {
      urls.push(url)
      return '/api/stream/' + urls.length
    },
  )
  assert.deepEqual(urls, [
    'https://video.quark.cn/path/audio/index.m3u8',
    'https://video.quark.cn/key?token=private',
    'https://video.quark.cn/path/init.mp4',
    'https://video.quark.cn/path/variant/index.m3u8',
    'https://video.quark.cn/path/segment.m4s?token=private',
  ])
  assert.ok(manifest.includes('URI="/api/stream/3"'))
  assert.ok(manifest.includes('#EXTINF:5,\n/api/stream/5'))
  assert.ok(!manifest.includes('private'))
  assert.ok(!manifest.includes('https://'))
  assert.throws(() =>
    rewritePlaylist('file:///private', 'https://video.quark.cn/', String),
  )
})

test('video redirects and manifest hosts retain ranges but never forward Quark Cookie to other CDN domains', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://media.example/segment.m4s' },
        })
      : new Response('video', { status: 206 })
  }
  try {
    const result = await fetchVideoSource(
      {
        url: 'https://video.quark.cn/segment',
        headers: {
          Cookie: 'test=credential',
          Referer: 'https://pan.quark.cn/',
        },
      },
      { method: 'GET', range: 'bytes=0-1023' },
    )
    assert.equal(result.status, 206)
    assert.equal(calls[0].options.headers.get('Cookie'), 'test=credential')
    assert.equal(calls[1].options.headers.get('Cookie'), null)
    assert.equal(calls[1].options.headers.get('Range'), 'bytes=0-1023')
    await fetchVideoSource(
      {
        url: 'https://quark.cn.example/video',
        headers: { Cookie: 'test=credential' },
      },
      { method: 'HEAD' },
    )
    assert.equal(calls[2].options.headers.get('Cookie'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
