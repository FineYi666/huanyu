import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { inspectVideoSample } from '../video-resolution.mjs'
import { probeStream } from '../stream-probe.mjs'
const require = createRequire(import.meta.url)

test('resolution inspection decodes real bounded HLS video bytes, not source names', async () => {
  const sample = execFileSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:d=0.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-f', 'mpegts', 'pipe:1'], { windowsHide: true, maxBuffer: 1024 * 1024 })
  const result = await probeStream({ url: 'https://cdn.example/video.m3u8' }, { fetcher: async url => url.endsWith('.m3u8') ? new Response('#EXTM3U\n#EXTINF:1,\nvideo.ts') : new Response(sample) })
  assert.equal(result.width, 1920)
  assert.equal(result.height, 1080)
  assert.equal(result.resolutionSource, 'sample')
  assert.equal(await inspectVideoSample(Buffer.from('<html>1080P</html>')), null)
})
