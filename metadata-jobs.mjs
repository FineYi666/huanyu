import { applyMetadata, downloadPoster } from './metadata.mjs'

export function createMetadataQueue({
  client,
  getMedia,
  getKey,
  save,
  saveCover,
  fetcher = fetch,
}) {
  const pending = []
  const queued = new Set()
  let running = false
  let currentAbort
  let drained = Promise.resolve()
  async function run() {
    running = true
    try {
      while (pending.length) {
        const id = pending.shift()
        const media = getMedia(id)
        if (!media) {
          queued.delete(id)
          continue
        }
        const key = getKey()
        if (!key) {
          media.metadataStatus = 'idle'
          queued.delete(id)
          await save()
          continue
        }
        const controller = new AbortController()
        currentAbort = controller
        media.metadataStatus = 'loading'
        delete media.metadataError
        try {
          await save()
          const info =
            media.metadataInfo ||
            (await client.identify(media, controller.signal))
          let cover = '',
            posterSource = null,
            posterError = ''
          if (!media.cover && !media.manual?.cover) {
            try {
              posterSource = await client.poster(info, controller.signal)
              if (posterSource)
                cover = await saveCover(
                  id,
                  await downloadPoster(
                    posterSource.url,
                    controller.signal,
                    fetcher,
                  ),
                )
              else
                posterError =
                  '已补全简介，暂未匹配到可靠海报，可调整作品名后重试或自行上传'
            } catch (error) {
              if (controller.signal.aborted) throw error
              posterError = '简介已补全，海报下载暂时失败，请稍后重试'
            }
          }
          if (controller.signal.aborted || getKey() !== key)
            throw new Error('CANCELLED')
          const current = getMedia(id)
          if (!current) continue
          applyMetadata(current, info, cover)
          current.metadataInfo = info
          current.metadataProvider = 'DeepSeek'
          current.metadataUpdatedAt = Date.now()
          if (cover && posterSource && !current.manual?.cover) {
            current.posterProvider = posterSource.provider
            current.posterSourceUrl = posterSource.sourceUrl
          }
          current.metadataStatus =
            current.cover && current.description ? 'ready' : 'partial'
          if (posterError) current.metadataError = posterError
        } catch (error) {
          const current = getMedia(id)
          if (current) {
            current.metadataStatus = controller.signal.aborted
              ? 'idle'
              : 'error'
            if (!controller.signal.aborted)
              current.metadataError =
                error.message?.includes('DeepSeek') ||
                error.message?.includes('文件名')
                  ? error.message
                  : '资料补全暂时失败，请检查网络后重试'
          }
        } finally {
          queued.delete(id)
          currentAbort = null
          await save()
        }
      }
    } finally {
      running = false
    }
  }
  return {
    enqueue(ids) {
      let count = 0
      for (const id of ids) {
        const media = getMedia(id)
        if (
          !media ||
          media.source === 'sample' ||
          queued.has(id) ||
          (media.cover && media.description)
        )
          continue
        media.metadataStatus = 'queued'
        delete media.metadataError
        queued.add(id)
        pending.push(id)
        count++
      }
      if (count && !running) {
        running = true
        drained = Promise.resolve()
          .then(run)
          .catch(() => {
            running = false
          })
      }
      return count
    },
    cancel() {
      currentAbort?.abort()
      for (const id of pending.splice(0)) {
        const media = getMedia(id)
        if (media) media.metadataStatus = 'idle'
        queued.delete(id)
      }
    },
    async wait() {
      await drained
    },
  }
}
