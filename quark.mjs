import {
  parseQuarkShare,
  isVideo,
  naturalSort,
  fileId,
} from './media-utils.mjs'
import { isSubtitle } from './subtitles.mjs'
import { qualityLabel } from './stream-quality.mjs'

const BASE = 'https://drive-pc.quark.cn/1/clouddrive'
const QUALITY_RANK = { low: 1, normal: 2, high: 3, super: 4, '2k': 5, '4k': 6 }
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function mergeQuarkCookies(current, setCookies) {
  const values = new Map(
    current
      .split(';')
      .map((part) => {
        const equal = part.indexOf('=')
        return [part.slice(0, equal).trim(), part.slice(equal + 1).trim()]
      })
      .filter(([name]) => /^[\w-]+$/.test(name)),
  )
  for (const raw of setCookies) {
    const pair = raw.split(';', 1)[0],
      equal = pair.indexOf('=')
    if (equal <= 0) continue
    const name = pair.slice(0, equal).trim(),
      value = pair.slice(equal + 1).trim()
    if (!/^[\w-]+$/.test(name)) continue
    if (!value || /;\s*max-age\s*=\s*0(?:;|$)/i.test(raw)) values.delete(name)
    else values.set(name, value)
  }
  return [...values].map(([key, value]) => `${key}=${value}`).join('; ')
}

export function createQuark(getCookie, { onCookie, requestTimeout = 25000 } = {}) {
  let anonymousCookie = ''
  async function request(endpoint, body, params = {}) {
    const accountCookie = getCookie() || ''
    const requestCookie = accountCookie || anonymousCookie
    const url = new URL(BASE + endpoint)
    for (const [key, value] of Object.entries({
      pr: 'ucpro',
      fr: 'pc',
      ...params,
    }))
      url.searchParams.set(key, String(value))
    let response
    try {
      response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: requestCookie,
          Referer: 'https://pan.quark.cn/',
          Origin: 'https://pan.quark.cn',
          'User-Agent': UA,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeout),
      })
    } catch {
      throw new Error('无法连接夸克网盘，请检查网络后重试')
    }
    let json
    const refreshedCookie = mergeQuarkCookies(
      requestCookie,
      response.headers.getSetCookie?.() || [],
    )
    if (!accountCookie && !getCookie()) anonymousCookie = refreshedCookie
    if (
      accountCookie &&
      getCookie() === accountCookie &&
      onCookie &&
      refreshedCookie !== accountCookie
    )
      await onCookie(refreshedCookie)
    try {
      json = await response.json()
    } catch {
      throw new Error('夸克服务暂时不可用，请稍后重试或使用官方网页播放')
    }
    if (
      !response.ok ||
      (json.code !== undefined && json.code !== 0) ||
      (json.status && json.status >= 400)
    ) {
      const error = new Error(
        `夸克：${json.message || '请求失败，请检查登录状态和分享权限'}`,
      )
      error.quarkCode=json.code
      error.quarkStatus=json.status || response.status
      throw error
    }
    return json
  }

  async function checkShare(text, code = '') {
    try {
      const parsed = parseQuarkShare(text, code)
      const token = await request('/share/sharepage/token', {pwd_id:parsed.shareId,passcode:parsed.passcode})
      if (!token.data?.stoken) return 'unknown'
      const queue = ['0'], visited = new Set()
      let truncated = false
      while (queue.length && visited.size < 3) {
        const fid = queue.shift()
        if (visited.has(fid)) continue
        visited.add(fid)
        const page = await request('/share/sharepage/detail',undefined,{pwd_id:parsed.shareId,stoken:token.data.stoken,pdir_fid:fid,force:0,_page:1,_size:100,_fetch_total:1,_fetch_share:1})
        const files = page.data?.list
        if (!Array.isArray(files)) return 'unknown'
        if (files.some(file=>isVideo(file.file_name))) return 'ready'
        truncated ||= files.length === 100
        for (const file of files) if (file.dir || file.file_type === 0) queue.push(file.fid)
      }
      return queue.length || truncated ? 'unknown' : 'invalid'
    } catch (error) {
      return /分享.*(?:取消|失效|不存在|过期|已删除|被删除|违规)/.test(error.message) ? 'invalid' : 'unknown'
    }
  }

  async function importShare(text, code, title) {
    const parsed = parseQuarkShare(text, code)
    const token = await request('/share/sharepage/token', {
      pwd_id: parsed.shareId,
      passcode: parsed.passcode,
    })
    const stoken = token.data?.stoken
    if (!stoken)
      throw new Error('无法读取分享，请检查提取码、链接有效期及登录状态')
    const episodes = []
    const subtitleFiles = []
    const visited = new Set()
    let shareTitle = ''
    async function walk(parent, prefix = '', depth = 0) {
      if (
        depth > 16 ||
        visited.size >= 200 ||
        episodes.length >= 5000 ||
        subtitleFiles.length >= 5000
      )
        throw new Error('分享目录过大，请使用更具体的分享链接')
      if (visited.has(parent)) return
      visited.add(parent)
      for (let page = 1; page <= 50; page++) {
        const detail = await request('/share/sharepage/detail', undefined, {
          pwd_id: parsed.shareId,
          stoken,
          pdir_fid: parent,
          force: 0,
          _page: page,
          _size: 100,
          _fetch_total: 1,
          _fetch_share: 1,
        })
        shareTitle ||= detail.data?.share?.title || detail.data?.title || ''
        const list = detail.data?.list || []
        if (!shareTitle && parent === '0' && list.length === 1)
          shareTitle = list[0].file_name.replace(/\.[^.]+$/, '')
        for (const item of list) {
          if (item.dir || item.file_type === 0)
            await walk(item.fid, `${prefix}${item.file_name}/`, depth + 1)
          else if (isVideo(item.file_name) || isSubtitle(item.file_name))
            (isVideo(item.file_name) ? episodes : subtitleFiles).push({
              id: fileId(parsed.shareId + item.fid),
              name: prefix + item.file_name,
              fid: item.fid,
              shareToken: item.share_fid_token,
              parentFid: parent,
              size: item.size,
            })
        }
        if (
          list.length < 100 ||
          (detail.metadata?._total && page * 100 >= detail.metadata._total)
        )
          break
      }
    }
    await walk('0')
    if (!episodes.length)
      throw new Error('此分享中没有找到视频文件，请检查链接和访问权限')
    episodes.sort((a, b) => naturalSort(a.name, b.name))
    return {
      id: `quark-${parsed.shareId}`,
      title: title?.trim() || shareTitle || '夸克云端影片',
      ...parsed,
      stoken,
      episodes,
      subtitleFiles,
      source: 'quark',
      addedAt: Date.now(),
      genre: '未分类',
    }
  }

  async function resolveStream(media, episode, authorizeSave, options = {}) {
    if (!getCookie()) {
      const error = new Error('请先在设置中连接夸克账号，或使用官方网页播放')
      error.status = 401
      throw error
    }
    const originalEpisode=episode
    if(options.restore){episode={...episode};delete episode.savedFid}
    function adoptSavedFile(){
      if(options.restore && episode.savedFid){
        originalEpisode.savedFid=episode.savedFid
        if(episode.shareToken)originalEpisode.shareToken=episode.shareToken
      }
    }
    async function downloadFile(fid) {
      const variants=[]
      const headers={ Cookie:getCookie(), Referer:'https://pan.quark.cn/', 'User-Agent':UA }
      try {
        const download = await request('/file/download', { fids: [fid] })
        const url=download.data?.[0]?.download_url
        if(url)variants.push({id:'original',label:qualityLabel(0,'original'),url,format:'file',container:'',variant:'original',headers})
      } catch (error) {
        if (!/download file size limit/i.test(error.message)) throw error
      }
      try {
        const playback = await request('/file/v2/play', {
          fid,
          resolutions: 'normal,low,high,super,2k,4k',
          supports: 'fmp4,m3u8',
        })
        const list = playback.data?.video_list || []
        const available = list.filter(
          (item) =>
            (item.accessable === true || item.accessable === 1) &&
            item.trans_status !== 'transcoding' &&
            item.video_info?.url,
        )
        available.sort(
          (a, b) =>
            (QUALITY_RANK[b.resolution] || 0) -
            (QUALITY_RANK[a.resolution] || 0),
        )
        if (!available.length && !variants.length) {
          if (list.some((item) => item.trans_status === 'transcoding'))
            throw new Error('夸克正在转码这一集，请稍后重试')
          throw new Error(
            '夸克未提供当前账号可用的在线播放画质，请在官方网页检查播放权限',
          )
        }
        for(const selected of available){
          const info=selected.video_info,url=info.url
          variants.push({id:selected.resolution,label:qualityLabel(info.height,selected.resolution),url,container:info.format||'',variant:`${selected.resolution}/${info.size||info.format_ext?.size||''}/${info.update_time||''}`,format:info.file_format==='m3u8'||new URL(url).pathname.endsWith('.m3u8')?'hls':'file',headers})
        }
      }catch(error){if(!variants.length)throw error}
      if (!variants.length)
        throw new Error(
          '未取得播放地址，资源可能受账号权限限制，请使用官方网页播放',
        )
      return {...variants[0],variants}
    }
    if (!episode.savedFid) {
      if (!authorizeSave) {
        const error = new Error(
          '在线播放需要将本集转存到你的夸克网盘，请确认后继续',
        )
        error.status = 409
        error.needsSave = true
        throw error
      }
      // Sharing tokens expire; refresh this episode's access before saving it.
      const token = await request('/share/sharepage/token', {
        pwd_id: media.shareId,
        passcode: media.passcode || '',
      })
      if (!token.data?.stoken)
        throw new Error('分享已过期或提取码失效，请重新导入链接')
      media.stoken = token.data.stoken
      let refreshed = false
      for (let page = 1; page <= 50; page++) {
        const detail = await request('/share/sharepage/detail', undefined, {
          pwd_id: media.shareId,
          stoken: media.stoken,
          pdir_fid: episode.parentFid || '0',
          _page: page,
          _size: 100,
        })
        const list = detail.data?.list || []
        const item = list.find((file) => file.fid === episode.fid)
        if (item) {
          episode.shareToken = item.share_fid_token
          refreshed = true
          break
        }
        if (list.length < 100) break
      }
      if (!refreshed)
        throw new Error('此分集已从分享中移除，请重新导入链接以刷新列表')
      let task
      try {
        task = await request('/share/sharepage/save', {
          fid_list: [episode.fid],
          fid_token_list: [episode.shareToken],
          to_pdir_fid: '0',
          pwd_id: media.shareId,
          stoken: media.stoken,
          pdir_fid: episode.parentFid || '0',
          scene: 'link',
        })
      } catch (error) {
        if (!/禁止转存自己的分享/.test(error.message)) throw error
        // Quark has confirmed this is the account's own share. Read the original
        // file through the normal authenticated download endpoint; never duplicate it.
        episode.savedFid = episode.fid
        adoptSavedFile()
        return downloadFile(episode.fid)
      }
      const taskId = task.data?.task_id
      if (!taskId)
        throw new Error('夸克未返回转存任务，请使用官方网页打开资源后重试')
      for (let attempt = 0; attempt < 30; attempt++) {
        const result = await request('/task', undefined, {
          task_id: taskId,
          retry_index: attempt,
        })
        const saved =
          result.data?.save_as?.save_as_top_fids ||
          result.data?.save_as?.save_as_select_top_fids
        if (saved?.[0]) {
          episode.savedFid = saved[0]
          break
        }
        if (result.data?.status === 3)
          throw new Error(
            result.data.fail_msg || '转存失败，请检查网盘空间和资源权限',
          )
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      if (!episode.savedFid)
        throw new Error('夸克转存超时，请在官方网盘确认后重试')
    }
    // Original media links support native <video> playback; headers are supplied by our local proxy.
    adoptSavedFile()
    return downloadFile(episode.savedFid)
  }
  const pendingRestores=new Map()
  async function getStream(media,episode,authorizeSave,options={}) {
    if(options.restore && !authorizeSave){
      const error=new Error('重新转存会占用网盘空间，请确认后继续');error.status=409;error.needsSave=true;throw error
    }
    if(options.restore && !media.shareId)throw new Error('原分享记录不可用，请重新选择视频资源')
    const key=`${media.id || media.shareId}/${episode.id || episode.fid}`
    if(options.restore && pendingRestores.has(key))return pendingRestores.get(key)
    const operation=resolveStream(media,episode,authorizeSave,options).catch(error=>{
      if(!options.restore && episode.savedFid && (error.quarkStatus===404 || /文件.{0,8}(?:不存在|已删除|被删除)|file.{0,20}(?:not exist|not found|deleted)|已被删除|回收站/i.test(error.message))){
        error.needsRestore=true
        error.message='夸克中已保存的本集文件可能已被删除，可点击“重新转存本集”从原分享恢复'
      }
      throw error
    })
    if(options.restore)pendingRestores.set(key,operation)
    try{return await operation}finally{if(options.restore && pendingRestores.get(key)===operation)pendingRestores.delete(key)}
  }

  async function checkAccount() {
    await request('/file/sort', undefined, {
      pdir_fid: '0',
      _page: 1,
      _size: 1,
    })
    return true
  }

  async function findSubtitles(media, refresh = false) {
    if (!Array.isArray(media.subtitleFiles) || refresh) {
      const scanned = await importShare(
        media.shareUrl,
        media.passcode || '',
        media.title,
      )
      media.subtitleFiles = scanned.subtitleFiles
      media.stoken = scanned.stoken
    }
    return media.subtitleFiles
  }
  async function subtitleSource(media, file) {
    const token = await request('/share/sharepage/token', {
      pwd_id: media.shareId,
      passcode: media.passcode || '',
    })
    if (!token.data?.stoken)
      throw new Error('分享字幕暂时无法读取，请重新导入分享')
    media.stoken = token.data.stoken
    let url
    try {
      const response = await request('/share/sharepage/download', {
        pwd_id: media.shareId,
        stoken: media.stoken,
        fids: [file.fid],
        fid_tokens: [file.shareToken],
      })
      url = response.data?.[0]?.download_url || response.data?.download_url
    } catch {}
    // An owned share can be read through the account's original file. Never
    // transfer a subtitle or any video as a side effect of subtitle discovery.
    if (!url && getCookie()) {
      const response = await request('/file/download', { fids: [file.fid] })
      url = response.data?.[0]?.download_url
    }
    if (!url)
      throw new Error(
        '夸克未允许直接读取此字幕，可下载字幕后手动载入，或尝试在线搜索',
      )
    return {
      url,
      headers: {
        Cookie: getCookie() || '',
        Referer: 'https://pan.quark.cn/',
        'User-Agent': UA,
      },
    }
  }

  return { importShare, getStream, checkShare, checkAccount, findSubtitles, subtitleSource }
}
