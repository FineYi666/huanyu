import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createMetadataClient,
  metadataInput,
  downloadPoster,
  isAllowedPosterUrl,
  parseMetadataResponse,
} from '../metadata.mjs'
import { createMetadataQueue } from '../metadata-jobs.mjs'
import { createSecretStore } from '../secret-store.mjs'

const info = {
  recognized: true,
  confidence: 0.95,
  title: '测试作品',
  englishTitle: 'Test Story',
  originalTitle: '测试作品',
  year: '2026',
  kind: 'anime',
  genre: '奇幻',
  synopsis: '一段谨慎整理的作品简介。',
}
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 0])

test('DeepSeek discovers models and only sends title plus basenames to the official API', async () => {
  const calls = []
  const client = createMetadataClient({
    getKey: () => 'test-key',
    getModel: () => 'available-model',
    fetcher: async (url, options) => {
      calls.push({ url, options })
      return url.endsWith('/models')
        ? json({ data: [{ id: 'available-model' }] })
        : json({ choices: [{ message: { content: JSON.stringify(info) } }] })
    },
  })
  assert.deepEqual(await client.models('test-key'), ['available-model'])
  const media = {
    title: '测试作品',
    shareUrl: 'https://private-share.invalid/secret',
    episodes: [
      {
        name: 'E:\\private\\测试作品 01.mp4',
        path: 'E:\\private\\测试作品 01.mp4',
      },
    ],
  }
  assert.deepEqual(metadataInput(media).filenames, ['测试作品 01.mp4'])
  assert.equal((await client.identify(media)).description, info.synopsis)
  const request = JSON.parse(calls[1].options.body)
  assert.equal(calls[1].url, 'https://api.deepseek.com/chat/completions')
  assert.equal(calls[1].options.redirect, 'error')
  assert.equal(request.model, 'available-model')
  assert.equal(request.response_format.type, 'json_object')
  assert.deepEqual(request.thinking, { type: 'disabled' })
  assert.equal(request.max_tokens, 2048)
  assert.ok(!calls[1].options.body.includes('private'))
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-key')
})

test('metadata parser accepts a complete JSON fence but rejects truncated, empty and invalid-shaped final answers', () => {
  const response = (content, finish_reason = 'stop') => ({
    choices: [
      {
        finish_reason,
        message: { content, reasoning_content: JSON.stringify(info) },
      },
    ],
  })
  assert.equal(
    parseMetadataResponse(
      response('```json\n' + JSON.stringify(info) + '\n```'),
    ).title,
    info.title,
  )
  assert.throws(
    () => parseMetadataResponse(response(JSON.stringify(info), 'length')),
    { code: 'DEEPSEEK_TRUNCATED' },
  )
  assert.throws(() => parseMetadataResponse(response('')), {
    code: 'DEEPSEEK_EMPTY',
  })
  for (const body of ['null', '[]', '{broken'])
    assert.throws(() => parseMetadataResponse(response(body)), {
      code: 'DEEPSEEK_INVALID_JSON',
    })
  assert.throws(
    () =>
      parseMetadataResponse(
        response(JSON.stringify({ ...info, synopsis: '' })),
      ),
    { code: 'DEEPSEEK_MISSING_SYNOPSIS' },
  )
})

test('incomplete output retries once with non-thinking mode and a larger budget, never treating reasoning as metadata', async () => {
  for (const first of [
    {
      finish_reason: 'length',
      message: { content: '', reasoning_content: JSON.stringify(info) },
    },
    { finish_reason: 'stop', message: { content: '' } },
    { finish_reason: 'stop', message: { content: '{broken' } },
  ]) {
    const calls = []
    const client = createMetadataClient({
      getKey: () => 'test',
      getModel: () => 'deepseek-flash',
      fetcher: async (_url, options) => {
        calls.push(JSON.parse(options.body))
        return json({
          choices: [
            calls.length === 1
              ? first
              : {
                  finish_reason: 'stop',
                  message: { content: JSON.stringify(info) },
                },
          ],
        })
      },
    })
    assert.equal((await client.identify({ title: 'test' })).title, info.title)
    assert.equal(calls.length, 2)
    assert.deepEqual(
      calls.map((call) => call.thinking.type),
      ['disabled', 'disabled'],
    )
    assert.deepEqual(
      calls.map((call) => call.max_tokens),
      [2048, 4096],
    )
  }
})

test('retry is bounded and never repeats credential, credit or low-confidence failures', async () => {
  for (const scenario of ['empty', '401', '402', 'uncertain']) {
    let count = 0
    const client = createMetadataClient({
      getKey: () => 'test',
      getModel: () => 'deepseek-flash',
      fetcher: async () => {
        count++
        if (scenario === '401' || scenario === '402')
          return json({}, Number(scenario))
        return json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  scenario === 'empty'
                    ? ''
                    : JSON.stringify({
                        ...info,
                        recognized: false,
                        confidence: 0.1,
                      }),
              },
            },
          ],
        })
      },
    })
    await assert.rejects(
      client.identify({ title: 'test' }),
      scenario === 'empty' ? /空.*自动重试一次/ : /DeepSeek|文件名/,
    )
    assert.equal(count, scenario === 'empty' ? 2 : 1)
  }
})

test('uncertain identity, malformed responses and billing/auth errors fail without invented metadata', async () => {
  for (const result of [
    { ...info, confidence: undefined },
    { ...info, confidence: 0.2 },
    { ...info, recognized: false },
    '{broken',
  ]) {
    const client = createMetadataClient({
      getKey: () => 'test',
      getModel: () => 'model',
      fetcher: async () =>
        json({
          choices: [
            {
              message: {
                content:
                  typeof result === 'string' ? result : JSON.stringify(result),
              },
            },
          ],
        }),
    })
    await assert.rejects(
      client.identify({ title: 'unknown' }),
      /文件名|DeepSeek/,
    )
  }
  for (const [status, message] of [
    [401, /Key/],
    [402, /余额/],
    [429, /频率/],
  ]) {
    const client = createMetadataClient({
      getKey: () => 'test',
      getModel: () => 'model',
      fetcher: async () => json({}, status),
    })
    await assert.rejects(client.identify({ title: 'unknown' }), message)
  }
})

test('poster matching uses real catalogue titles and never forwards the API key', async () => {
  const client = createMetadataClient({
    getKey: () => 'private-key',
    getModel: () => 'model',
    fetcher: async (url, options) => {
      assert.equal(options.headers.Authorization, undefined)
      assert.ok(!JSON.stringify(options).includes('private-key'))
      assert.ok(url.startsWith('https://api.bgm.tv/'))
      return json({
        data: [
          {
            id: 1,
            name_cn: '完全无关',
            images: { large: 'https://lain.bgm.tv/wrong.jpg' },
          },
          {
            id: 2,
            name_cn: info.title,
            date: '2026-10-01',
            images: { large: 'https://lain.bgm.tv/right.jpg' },
          },
        ],
      })
    },
  })
  const poster = await client.poster(info)
  assert.equal(poster.url, 'https://lain.bgm.tv/right.jpg')
  assert.equal(poster.sourceUrl, 'https://bgm.tv/subject/2')
})

test('poster download rejects private hosts, hostile redirects and non-image bodies', async () => {
  for (const url of [
    'http://lain.bgm.tv/x',
    'https://127.0.0.1/x',
    'https://lain.bgm.tv.evil.invalid/x',
    'https://user:pass@lain.bgm.tv/x',
    'https://lain.bgm.tv:8080/x',
  ])
    assert.equal(isAllowedPosterUrl(url), false)
  assert.equal(
    isAllowedPosterUrl('https://is1-ssl.mzstatic.com/image.jpg'),
    true,
  )
  let count = 0
  await assert.rejects(
    downloadPoster('https://lain.bgm.tv/x', undefined, async () => {
      count++
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      })
    }),
    /地址/,
  )
  assert.equal(count, 1)
  await assert.rejects(
    downloadPoster(
      'https://lain.bgm.tv/x',
      undefined,
      async () =>
        new Response('<html>error</html>', {
          headers: { 'content-type': 'image/jpeg' },
        }),
    ),
    /有效/,
  )
  const image = await downloadPoster(
    'https://lain.bgm.tv/x',
    undefined,
    async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined)
      return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })
    },
  )
  assert.deepEqual(image.bytes, jpeg)
})

test('background queue deduplicates work, caches recognition for retries and preserves manual edits', async () => {
  const media = {
    id: 'one',
    source: 'local',
    title: '原始文件夹',
    episodes: [],
  }
  let calls = 0,
    coverCalls = 0
  const queue = createMetadataQueue({
    getKey: () => 'key',
    getMedia: (id) => (id === media.id ? media : null),
    save: async () => {},
    saveCover: async () => '/covers/saved.jpg',
    fetcher: async () =>
      new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }),
    client: {
      identify: async () => {
        calls++
        return { ...info, description: info.synopsis }
      },
      poster: async () => {
        coverCalls++
        return coverCalls === 1
          ? null
          : {
              url: 'https://lain.bgm.tv/real.jpg',
              provider: 'Bangumi',
              sourceUrl: 'https://bgm.tv/subject/2',
            }
      },
    },
  })
  assert.equal(queue.enqueue(['one', 'one']), 1)
  assert.equal(queue.enqueue(['one']), 0)
  await queue.wait()
  assert.equal(media.metadataStatus, 'partial')
  assert.equal(media.description, info.synopsis)
  media.title = '我自己的片名'
  media.description = '我写的简介'
  media.manual = { title: true, description: true }
  queue.enqueue(['one'])
  await queue.wait()
  assert.equal(calls, 1)
  assert.equal(media.title, '我自己的片名')
  assert.equal(media.description, '我写的简介')
  assert.equal(media.cover, '/covers/saved.jpg')
  assert.equal(media.metadataStatus, 'ready')
  assert.equal(queue.enqueue(['one']), 0)
})

test('disconnect aborts current metadata work and clears queued jobs', async () => {
  const items = [
    { id: 'a', source: 'local' },
    { id: 'b', source: 'quark' },
  ]
  let started
  const start = new Promise((resolve) => {
    started = resolve
  })
  const queue = createMetadataQueue({
    getKey: () => 'key',
    getMedia: (id) => items.find((item) => item.id === id),
    save: async () => {},
    saveCover: async () => '',
    client: {
      identify: (_media, signal) =>
        new Promise((_resolve, reject) => {
          started()
          signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          )
        }),
    },
  })
  queue.enqueue(['a', 'b'])
  await start
  queue.cancel()
  await queue.wait()
  assert.deepEqual(
    items.map((item) => item.metadataStatus),
    ['idle', 'idle'],
  )
  assert.ok(items.every((item) => !item.description && !item.cover))
})

test(
  'Windows DPAPI stores no plaintext and decrypts only through the account-bound store',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yingyu-key-test-'))
    const store = createSecretStore(directory)
    const key = 'sk-fake-test-key-not-a-real-account-123456'
    assert.equal(await store.read(), '')
    await store.write(key)
    const stored = await readFile(path.join(directory, 'deepseek.key'), 'utf8')
    assert.ok(!stored.includes(key))
    assert.equal(await store.read(), key)
    await store.remove()
    assert.equal(await store.read(), '')
  },
)
