import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuark } from '../quark.mjs'

test('anonymous share inspection excludes empty shares, finds nested videos and never transfers files', async () => {
  const original=globalThis.fetch
  let empty=false
  const calls=[]
  globalThis.fetch=async(input,options)=>{
    const u=new URL(input);calls.push(u.pathname)
    assert.equal(options.headers.Cookie,'')
    if(u.pathname.endsWith('/sharepage/token'))return Response.json({code:0,data:{stoken:'test-token'}})
    if(u.pathname.endsWith('/sharepage/detail'))return Response.json({code:0,data:{list:empty?[]:u.searchParams.get('pdir_fid')==='0'?[{fid:'folder',file_name:'剧集',file_type:0}]:[{file_name:'01.mp4',file_type:1}]}})
    throw new Error('Unexpected write API')
  }
  try{
    const q=createQuark(()=> '')
    assert.equal(await q.checkShare('https://pan.quark.cn/s/fixture'),'ready')
    empty=true
    assert.equal(await q.checkShare('https://pan.quark.cn/s/fixture'),'invalid')
    assert.ok(calls.every(route=>/sharepage\/(token|detail)$/.test(route)))
  }finally{globalThis.fetch=original}
})

test('Quark bridge discovers episodes, refreshes tokens and requires explicit per-episode save consent', async () => {
  const originalFetch = globalThis.fetch
  let cookie = ''
  let saves = 0
  let tokenCalls = 0
  const calls = []
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ pathname: url.pathname, body, cookie: options.headers.Cookie })
    let data
    if (url.pathname.endsWith('/sharepage/token'))
      data = { stoken: `token-${++tokenCalls}` }
    else if (url.pathname.endsWith('/sharepage/detail')) {
      if (url.searchParams.get('pdir_fid') === 'folder')
        data = {
          list: [
            {
              fid: 'ep1',
              file_name: '第01集.mp4',
              file_type: 1,
              share_fid_token: 'file-token',
              size: 1024,
            },
          ],
        }
      else
        data = {
          title: '我的云端剧集',
          list: [
            { fid: 'folder', file_name: '第一季', file_type: 0 },
            { fid: 'readme', file_name: '说明.txt', file_type: 1 },
          ],
        }
    } else if (url.pathname.endsWith('/sharepage/save')) {
      saves++
      assert.deepEqual(body.fid_list, ['ep1'])
      assert.deepEqual(body.fid_token_list, ['file-token'])
      assert.equal(body.stoken, 'token-2')
      assert.equal(body.pdir_fid, 'folder')
      data = { task_id: 'task-1' }
    } else if (url.pathname.endsWith('/task'))
      data = { status: 2, save_as: { save_as_top_fids: ['saved-ep1'] } }
    else if (url.pathname.endsWith('/file/download')) {
      assert.deepEqual(body.fids, ['saved-ep1'])
      data = [{ download_url: 'https://video.quark.cn/episode.mp4' }]
    } else if (url.pathname.endsWith('/file/sort')) data = { list: [] }
    else throw new Error('Unexpected request: ' + url.pathname)
    return new Response(JSON.stringify({ code: 0, status: 200, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const quark = createQuark(() => cookie)
    const media = await quark.importShare(
      'https://pan.quark.cn/s/share123?pwd=abcd',
      '',
    )
    assert.equal(media.title, '我的云端剧集')
    assert.equal(media.passcode, 'abcd')
    assert.equal(media.episodes.length, 1)
    assert.equal(media.episodes[0].name, '第一季/第01集.mp4')
    const episode = media.episodes[0]
    await assert.rejects(
      quark.getStream(media, episode, false),
      (error) => error.status === 401,
    )
    cookie = 'test-cookie=not-a-real-credential'
    await assert.rejects(
      quark.getStream(media, episode, false),
      (error) => error.status === 409 && error.needsSave === true,
    )
    assert.equal(saves, 0, 'must not save before explicit consent')
    const stream = await quark.getStream(media, episode, true)
    assert.equal(stream.url, 'https://video.quark.cn/episode.mp4')
    assert.equal(stream.headers.Cookie, cookie)
    assert.equal(episode.savedFid, 'saved-ep1')
    assert.equal(tokenCalls, 2)
    assert.equal(saves, 1)
    await quark.getStream(media, episode, false)
    assert.equal(
      saves,
      1,
      'replaying saved episode must not create a second cloud copy',
    )
    assert.equal(await quark.checkAccount(), true)
    assert.equal(
      calls.filter((call) => call.pathname.endsWith('/file/delete')).length,
      0,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Quark bridge reports permission and invalid-share errors without fake success', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ code: 41001, status: 403, message: '分享已取消' }),
      { status: 200 },
    )
  try {
    const quark = createQuark(() => '')
    await assert.rejects(
      quark.importShare('https://pan.quark.cn/s/expired', ''),
      /分享已取消/,
    )
    await assert.rejects(
      quark.importShare('https://other.example/s/id', ''),
      /有效的夸克网盘分享链接/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('own shares use the authenticated original file after Quark rejects a duplicate save', async () => {
  const originalFetch = globalThis.fetch
  const episode = { id: 'episode', fid: 'owned-file', parentFid: '0' }
  const media = { shareId: 'owned-share', episodes: [episode] }
  let saves = 0,
    downloads = 0
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    let data
    if (url.pathname.endsWith('/sharepage/token')) data = { stoken: 'token' }
    else if (url.pathname.endsWith('/sharepage/detail'))
      data = { list: [{ fid: 'owned-file', share_fid_token: 'token' }] }
    else if (url.pathname.endsWith('/sharepage/save')) {
      saves++
      return new Response(
        JSON.stringify({
          code: 41010,
          status: 403,
          message: '用户禁止转存自己的分享',
        }),
      )
    } else if (url.pathname.endsWith('/file/download')) {
      downloads++
      assert.deepEqual(JSON.parse(options.body).fids, ['owned-file'])
      data = [{ download_url: 'https://video.quark.cn/original.mp4' }]
    } else throw new Error('Unexpected endpoint')
    return new Response(JSON.stringify({ code: 0, status: 200, data }))
  }
  try {
    const quark = createQuark(() => 'test=credential')
    assert.equal(
      (await quark.getStream(media, episode, true)).url,
      'https://video.quark.cn/original.mp4',
    )
    assert.equal(episode.savedFid, 'owned-file')
    assert.equal(
      (await quark.getStream(media, episode, false)).url,
      'https://video.quark.cn/original.mp4',
    )
    assert.equal(saves, 1)
    assert.equal(downloads, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('online playback chooses the highest permitted ready quality regardless of server default and list order', async () => {
  const originalFetch = globalThis.fetch
  const episode = { id: 'episode', savedFid: 'saved-file' }
  let playbackCalls = 0
  let fourKAccessible = false
  let fourKTranscoding = false
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/file/download'))
      return Response.json({
        code: 32010,
        message: 'download file size limit[trace-id]',
      })
    assert.ok(url.pathname.endsWith('/file/v2/play'))
    playbackCalls++
    assert.deepEqual(JSON.parse(options.body), {
      fid: 'saved-file',
      resolutions: 'normal,low,high,super,2k,4k',
      supports: 'fmp4,m3u8',
    })
    return Response.json({
      code: 0,
      data: {
        default_resolution: 'normal',
        video_list: [
          {
            resolution: '4k',
            accessable: fourKAccessible,
            trans_status: fourKTranscoding ? 'transcoding' : 'finished',
            video_info: { url: 'https://video.quark.cn/4k.m3u8' },
          },
          {
            resolution: 'normal',
            accessable: true,
            trans_status: 'finished',
            video_info: {
              url: 'https://video.quark.cn/stream?token=test',
              file_format: 'm3u8',
            },
          },
          {
            resolution: '2k',
            accessable: 1,
            trans_status: 'finished',
            video_info: {
              url: 'https://video.quark.cn/2k.m3u8',
              file_format: 'm3u8',
            },
          },
          {
            resolution: 'high',
            accessable: true,
            trans_status: 'finished',
            video_info: { url: 'https://video.quark.cn/high.mp4' },
          },
        ],
      },
    })
  }
  try {
    const quark = createQuark(() => 'test=credential')
    const stream = await quark.getStream({}, episode, false)
    assert.equal(stream.url, 'https://video.quark.cn/2k.m3u8')
    assert.equal(stream.format, 'hls')
    assert.equal(stream.variants[0].id,'2k')
    assert.ok(stream.variants.every(item=>item.label && !item.url.includes('4k')))
    fourKAccessible = true
    assert.equal(
      (await quark.getStream({}, episode, false)).url,
      'https://video.quark.cn/4k.m3u8',
    )
    fourKTranscoding = true
    assert.equal(
      (await quark.getStream({}, episode, false)).url,
      'https://video.quark.cn/2k.m3u8',
    )
    assert.equal(playbackCalls, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('online playback respects inaccessible qualities and reports transcoding without exposing locked URLs', async () => {
  const originalFetch = globalThis.fetch
  let transcoding = false
  globalThis.fetch = async (input) =>
    new URL(input).pathname.endsWith('/file/download')
      ? Response.json({ code: 32010, message: 'download file size limit' })
      : Response.json({
          code: 0,
          data: {
            video_list: [
              {
                accessable: false,
                trans_status: transcoding ? 'transcoding' : 'finished',
                video_info: { url: 'https://video.quark.cn/locked.m3u8' },
              },
            ],
          },
        })
  try {
    const quark = createQuark(() => 'test=credential')
    const episode = { savedFid: 'file' }
    await assert.rejects(
      quark.getStream({}, episode, false),
      /当前账号可用的在线播放画质/,
    )
    transcoding = true
    await assert.rejects(quark.getStream({}, episode, false), /正在转码/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
