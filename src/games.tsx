import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Gamepad2,
  Heart,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { api } from './api'
import Dialog, { IconButton } from './ui'
import LocalPicker from './LocalPicker'
import type { AppState, Game } from './types'

export const gameGenres = [
  '动作',
  '冒险',
  '角色扮演',
  '射击',
  '策略',
  '模拟',
  '竞速',
  '休闲',
  '独立',
  '体育',
  '解谜',
]

export const fileNameOf = (filePath: string) =>
  filePath.split(/[\\/]/).pop()?.replace(/\.(exe|lnk)$/i, '') || filePath

function lastPlayedLabel(game: Game) {
  if (!game.lastPlayedAt) return '尚未游玩'
  const days = Math.floor((Date.now() - game.lastPlayedAt) / 86400000)
  if (days <= 0) return '今天游玩过'
  if (days === 1) return '昨天游玩过'
  if (days < 30) return `${days} 天前游玩`
  return `上次游玩 ${new Date(game.lastPlayedAt).toLocaleDateString('zh-CN')}`
}

function GameCover({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [game.cover])
  return (
    <div
      className={`cover fallback-${
        Math.abs((game.title.charCodeAt(0) || 71) % 5)
      }`}
    >
      {game.cover && !failed ? (
        <img
          src={game.cover}
          alt={game.title}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-fallback">
          <Gamepad2 size={36} strokeWidth={1} />
          <span>{game.title}</span>
          <small>MY GAME SHELF</small>
        </div>
      )}
    </div>
  )
}

type GameResourceLink = { type: string; url: string }
type GameResource = {
  id: string
  title: string
  links: GameResourceLink[]
  code: string
  date: string
  source: string
}

// 游戏资源搜索：聚合公开网盘与磁力站，独立于游戏卡片网格（无游戏时也可用）。
export function GameResourceSearch({ notify }: { notify: (message: string) => void }) {
  const [resourceQuery, setResourceQuery] = useState('')
  const [resourceResults, setResourceResults] = useState<GameResource[] | null>(
    null,
  )
  const [resourceBusy, setResourceBusy] = useState(false)
  const [resourceError, setResourceError] = useState('')
  const [copied, setCopied] = useState('')
  async function searchResources() {
    const keyword = resourceQuery.trim()
    if (keyword.length < 2 || resourceBusy) return
    setResourceBusy(true)
    setResourceError('')
    try {
      const value = await api<{ results: GameResource[] }>(
        `/games/resource-search?q=${encodeURIComponent(keyword)}`,
      )
      setResourceResults(value.results || [])
    } catch (error) {
      setResourceError((error as Error).message)
    } finally {
      setResourceBusy(false)
    }
  }
  async function copyLink(link: GameResourceLink) {
    const url = link.url
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      setTimeout(() => setCopied(''), 1500)
      if (url.startsWith('magnet:')) {
        notify('磁力链接已复制，可在下载工具中新建任务')
      } else if (window.yingyuDesktop?.openWeb) {
        await window.yingyuDesktop.openWeb(url)
        notify('已打开资源页面，登录网盘后转存即可下载')
      } else {
        window.open(url, '_blank')
        notify('链接已复制并打开网盘页面，转存到你的网盘后即可下载')
      }
    } catch {
      // Electron 剪贴板不可用时的兜底：选中文本供手动复制
      const helper = document.createElement('textarea')
      helper.value = url
      document.body.appendChild(helper)
      helper.select()
      document.execCommand('copy')
      helper.remove()
      setCopied(url)
      setTimeout(() => setCopied(''), 1500)
      notify(url.startsWith('magnet:') ? '磁力链接已复制' : '链接已复制')
    }
  }
  return (
    <div className="game-resource-search">
      <div className="game-resource-head">
        <strong>搜索游戏资源</strong>
        <span>
          聚合公开网盘与磁力站的游戏资源，复制链接转存网盘后下载导入
        </span>
      </div>
      <div className="game-resource-row">
        <input
          value={resourceQuery}
          onChange={(e) => setResourceQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void searchResources()
          }}
          placeholder="输入游戏名称，如：艾尔登法环"
          maxLength={80}
          aria-label="搜索游戏资源"
        />
        <button
          type="button"
          className="button subtle"
          disabled={resourceBusy || resourceQuery.trim().length < 2}
          onClick={() => void searchResources()}
        >
          {resourceBusy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Sparkles size={15} />
          )}
          {resourceBusy ? '搜索中' : '搜索资源'}
        </button>
      </div>
      {resourceError && (
        <p className="game-resource-error">{resourceError}</p>
      )}
      {resourceResults && (
        <div className="game-resource-results">
          {resourceResults.length ? (
            resourceResults.map((item) => (
              <div className="game-resource-item" key={item.id}>
                <div className="game-resource-copy">
                  <h4>{item.title}</h4>
                  <span>
                    {item.date ? `${item.date.slice(0, 10)} · ` : ''}
                    {item.links.map((l) => l.type).join(' / ')}
                  </span>
                </div>
                <div className="game-resource-links">
                  {item.links.map((link) => (
                    <button
                      key={link.url}
                      type="button"
                      onClick={() => void copyLink(link)}
                      title={link.url}
                    >
                      {copied === link.url ? '已复制' : link.type}
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="game-resource-error">
              没有找到相关资源，可以换一个名称或添加空格重试。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function GamesPage({
  games,
  launchingId,
  onOpen,
  onLaunch,
  onFavorite,
  notify,
}: {
  games: Game[]
  launchingId: string | null
  onOpen: (id: string) => void
  onLaunch: (game: Game) => void
  onFavorite: (game: Game) => void
  notify: (message: string) => void
}) {
  return (
    <div className="media-grid games-grid">
      {games.map((game, index) => (
        <article
          className="media-card game-card"
          key={game.id}
          style={{ '--card-index': Math.min(index, 8) } as never}
        >
          <div className="poster-wrap">
            <button
              className="poster-button"
              aria-label={`查看${game.title}的详情`}
              onClick={() => onOpen(game.id)}
            >
              <GameCover game={game} />
              <div className="poster-shade" />
              <span className="poster-source">
                <Gamepad2 size={12} />
                {game.source === 'lnk' ? '快捷方式' : '本地程序'}
              </span>
              {game.playCount ? (
                <span className="poster-rating">
                  <strong>{game.playCount}</strong> 次游玩
                </span>
              ) : null}
              <span className="poster-bottom">
                {lastPlayedLabel(game)}
                <span>{game.genre || '未分类'}</span>
              </span>
            </button>
            <button
              className="poster-launch"
              aria-label={`启动${game.title}`}
              title={`启动${game.title}`}
              disabled={Boolean(launchingId)}
              onClick={(e) => {
                e.stopPropagation()
                onLaunch(game)
              }}
            >
              {launchingId === game.id ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Play size={18} fill="currentColor" strokeWidth={1.5} />
              )}
            </button>
            <button
              className={`poster-favorite ${game.favorite ? 'favorited' : ''}`}
              aria-label={`${game.favorite ? '取消收藏' : '收藏'}${game.title}`}
              onClick={() => onFavorite(game)}
            >
              <Heart
                size={17}
                fill={game.favorite ? 'currentColor' : 'none'}
              />
            </button>
          </div>
          <div className="card-copy">
            <button className="card-title" onClick={() => onOpen(game.id)}>
              {game.title}
            </button>
            <div className="card-meta">
              <span>
                {game.genre || '未分类'}
                <i />
                {game.source === 'lnk' ? '快捷方式' : '本地程序'}
              </span>
              <span className="card-status">
                {game.metadataStatus === 'loading'
                  ? '资料整理中…'
                  : game.favorite
                    ? '心愿单'
                    : '随时开玩'}
              </span>
            </div>
          </div>
        </article>
      ))}
          </div>
  )
}

export function GameDetailDialog({
  game,
  launching,
  onClose,
  onLaunch,
  onUpdate,
  notify,
}: {
  game: Game
  launching: boolean
  onClose: () => void
  onLaunch: (game: Game) => void
  onUpdate: (data: AppState) => void
  notify: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(game.title)
  const [genre, setGenre] = useState(game.genre || '')
  const [description, setDescription] = useState(game.description || '')
  const [launchArgs, setLaunchArgs] = useState(game.launchArgs || '')
  const [workDir, setWorkDir] = useState(game.workDir || '')
  const [steamQuery, setSteamQuery] = useState(game.title)
  const [steamResults, setSteamResults] = useState<
    { appId: number; name: string; image: string }[] | null
  >(null)
  const [steamBusy, setSteamBusy] = useState(false)
  const [applyingId, setApplyingId] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) {
      setTitle(game.title)
      setGenre(game.genre || '')
      setDescription(game.description || '')
      setLaunchArgs(game.launchArgs || '')
      setWorkDir(game.workDir || '')
    }
  }, [game, editing])
  async function run(action: () => Promise<AppState>, done?: () => void) {
    if (busy) return
    setBusy(true)
    try {
      onUpdate(await action())
      done?.()
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const saveEdit = () =>
    run(
      () =>
        api<AppState>(`/games/${game.id}`, {
          title,
          genre,
          description,
          launchArgs,
          workDir,
        }, 'PATCH'),
      () => {
        setEditing(false)
        notify('游戏信息已更新')
      },
    )
  const uploadCover = (cover: File) => {
    if (cover.size > 4 * 1024 * 1024) {
      notify('封面图片请控制在 4 MB 以内')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      await run(
        () => api<AppState>(`/games/${game.id}/cover`, { image: reader.result }),
        () => notify('新封面已保存'),
      )
    }
    reader.readAsDataURL(cover)
  }
  const refreshMetadata = () =>
    run(async () => {
      const data = await api<AppState & { found: boolean }>(
        `/games/${game.id}/metadata`,
        {},
      )
      notify(
        data.found
          ? '游戏资料已更新'
          : '没有在 Steam 找到这款游戏，可以手动填写介绍',
      )
      return data
    })
  async function searchSteam() {
    const keyword = steamQuery.trim()
    if (!keyword || steamBusy) return
    setSteamBusy(true)
    try {
      const data = await api<{ results: { appId: number; name: string; image: string }[] }>(
        `/games/search?q=${encodeURIComponent(keyword)}`,
      )
      setSteamResults(data.results || [])
      if (!(data.results || []).length) notify('Steam 没有返回匹配的游戏')
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSteamBusy(false)
    }
  }
  async function applySteam(appId: number) {
    if (applyingId) return
    setApplyingId(appId)
    try {
      onUpdate(
        await api<AppState>(`/games/${game.id}/apply`, { appId }),
      )
      setSteamResults(null)
      notify('已应用 Steam 的封面与介绍')
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setApplyingId(0)
    }
  }
  const remove = () =>
    run(
      () => api<AppState>(`/games/${game.id}`, {}, 'DELETE'),
      () => {
        notify(`已将《${game.title}》移出游戏空间`)
        onClose()
      },
    )
  const metaBusy = game.metadataStatus === 'loading'
  const showMetaPanel =
    !editing &&
    (!game.description || ['error', 'partial'].includes(game.metadataStatus || ''))
  return (
    <Dialog
      title="游戏详情"
      eyebrow="YOUR GAME SHELF"
      className="detail-dialog game-detail-dialog"
      onClose={onClose}
    >
      <div className="detail-overview">
        <button
          className="detail-cover-button"
          title="更换游戏封面"
          onClick={() => file.current?.click()}
        >
          <GameCover game={game} />
          <span>
            <ImagePlus size={17} /> 更换封面
          </span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) uploadCover(e.target.files[0])
          }}
        />
        <div className="detail-copy">
          <span className="source-label local">
            <Gamepad2 size={13} />
            本地游戏
          </span>
          <p className="detail-subtitle">READY PLAYER ONE</p>
          <h2>{game.title}</h2>
          <div className="detail-meta">
            <span>{game.genre || '未分类'}</span>
            <span>{game.source === 'lnk' ? '快捷方式' : '本地程序'}</span>
            {game.playCount ? <span>游玩 {game.playCount} 次</span> : null}
            <span>{lastPlayedLabel(game)}</span>
          </div>
          <p className="detail-description">
            {game.description ||
              '还没有介绍。点击下方按钮从 Steam 拉取资料，或编辑一段属于你自己的介绍。'}
          </p>
          <div className="detail-actions">
            <button
              className="button primary"
              disabled={launching}
              onClick={() => onLaunch(game)}
            >
              {launching ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              启动游戏
            </button>
            <button
              className={`button outline ${game.favorite ? 'is-favorite' : ''}`}
              onClick={() =>
                run(() =>
                  api<AppState>(
                    `/games/${game.id}`,
                    { favorite: !game.favorite },
                    'PATCH',
                  ),
                )
              }
            >
              <Heart
                size={17}
                fill={game.favorite ? 'currentColor' : 'none'}
              />
              {game.favorite ? '已收藏' : '收藏'}
            </button>
            <IconButton
              label="编辑游戏信息"
              onClick={() => setEditing(!editing)}
            >
              <Pencil size={17} />
            </IconButton>
          </div>
        </div>
      </div>
      {!editing && (
        <div className="steam-search-panel">
          <div className="steam-search-head">
            <strong>从 Steam 匹配资料</strong>
            <p>启动程序名是简称时，输入正确的游戏名称，搜索并一键应用封面与介绍。</p>
          </div>
          <div className="steam-search-row">
            <input
              value={steamQuery}
              onChange={(e) => setSteamQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void searchSteam()
                }
              }}
              placeholder="输入游戏名称，如：寂静岭F"
              maxLength={80}
              aria-label="搜索 Steam 游戏"
            />
            <button
              type="button"
              className="button subtle"
              disabled={steamBusy || !steamQuery.trim()}
              onClick={() => void searchSteam()}
            >
              {steamBusy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}
              搜索
            </button>
          </div>
          {steamResults && (
            <div className="steam-results">
              {steamResults.length ? (
                steamResults.map((item) => (
                  <button
                    type="button"
                    key={item.appId}
                    className="steam-result"
                    disabled={Boolean(applyingId)}
                    onClick={() => void applySteam(item.appId)}
                  >
                    <img src={item.image} alt="" loading="lazy" />
                    <span>{item.name}</span>
                    {applyingId === item.appId ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Check size={15} />
                    )}
                  </button>
                ))
              ) : (
                <p className="steam-empty">没有找到匹配的游戏，可手动填写介绍。</p>
              )}
            </div>
          )}
        </div>
      )}
      {showMetaPanel && (
        <div className={`metadata-status-panel ${game.metadataStatus || ''}`}>
          <div>
            <span className="metadata-status-icon">
              {metaBusy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}
            </span>
            <div>
              <strong>
                {metaBusy
                  ? '资料管家正在从 Steam 整理这款游戏'
                  : game.metadataStatus === 'error'
                    ? '暂时没有找到这款游戏的资料'
                    : '给这款游戏补一张封面、一段介绍'}
              </strong>
              <p>
                {game.metadataError ||
                  (metaBusy
                    ? '按游戏名在 Steam 搜索封面与简介，稍等片刻。'
                    : '可以重新搜索，或手动编辑介绍、上传封面。')}
              </p>
            </div>
          </div>
          <button
            className="button subtle"
            disabled={busy || metaBusy}
            onClick={refreshMetadata}
          >
            <RefreshCw size={15} /> 重新获取
          </button>
        </div>
      )}
      {editing && (
        <form
          className="edit-panel"
          onSubmit={(e) => {
            e.preventDefault()
            saveEdit()
          }}
        >
          <label className="field">
            游戏名称
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className="field">
            分类 <span>留空表示未分类</span>
            <input
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              maxLength={60}
              list="game-genre-options"
              placeholder="动作、冒险、角色扮演…"
            />
          </label>
          <datalist id="game-genre-options">
            {gameGenres.map((item) => (
              <option value={item} key={item} />
            ))}
          </datalist>
          <label className="field">
            游戏介绍
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="写下这款游戏最吸引你的地方"
            />
          </label>
          <label className="field">
            启动参数 <span>可选，传给游戏程序的命令行参数</span>
            <input
              value={launchArgs}
              onChange={(e) => setLaunchArgs(e.target.value)}
              maxLength={300}
              placeholder={'例如 -windowed 或 "C:\\某路径\\mod.cfg"'}
            />
          </label>
          <label className="field">
            工作目录 <span>可选，默认使用游戏所在文件夹</span>
            <input
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="D:\\Games\\MyGame"
            />
          </label>
          <div className="edit-actions">
            <button
              type="button"
              className="button subtle"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
            <button className="button primary" disabled={busy || !title.trim()}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              保存修改
            </button>
          </div>
        </form>
      )}
      <div className="detail-bottom">
        <span>
          <ShieldCheck size={14} />
          启动路径与游戏文件都不会被改动
        </span>
        <button
          className="text-button danger"
          onClick={() => setRemoving(!removing)}
        >
          <Trash2 size={14} />
          移出游戏空间
        </button>
      </div>
      {removing && (
        <div className="remove-confirm">
          <p>确认把「{game.title}」移出游戏空间？游戏文件会保留。</p>
          <div>
            <button
              className="button subtle"
              disabled={busy}
              onClick={() => setRemoving(false)}
            >
              保留
            </button>
            <button
              className="button danger-button"
              disabled={busy}
              onClick={remove}
            >
              确认移除
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

type ImportResult = {
  id?: string
  title?: string
  existed?: boolean
  path?: string
  error?: string
}

export function GameImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (data: AppState, imported: number, failed: number) => void
}) {
  const [picker, setPicker] = useState(true)
  const [paths, setPaths] = useState<string[]>([])
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<{
    data: AppState & { results: ImportResult[]; imported: number }
    results: ImportResult[]
  } | null>(null)
  async function submit() {
    setBusy(true)
    setError('')
    try {
      const data = await api<
        AppState & { results: ImportResult[]; imported: number }
      >('/games/import', { paths, autoMetadata: auto })
      const failed = data.results.filter((item) => item.error)
      if (!failed.length) {
        onImported(data, data.imported, 0)
        return
      }
      setOutcome({ data, results: data.results })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (picker && !outcome)
    return (
      <Dialog
        key="game-picker"
        title="选择要导入的游戏"
        className="local-picker-dialog"
        hideHeader
        onClose={onClose}
      >
        <LocalPicker
          kind="game"
          initialPath=""
          onCancel={onClose}
          onSelect={(selected) => {
            setPaths(selected)
            setPicker(false)
            setError('')
          }}
        />
      </Dialog>
    )
  return (
    <Dialog
      key="game-import-form"
      title="把游戏收进游戏空间"
      eyebrow="YOUR GAME SHELF"
      className="import-dialog game-import-dialog"
      onClose={onClose}
    >
      <p className="dialog-intro">
        {outcome
          ? '一部分游戏没有导入成功，确认下面的原因后即可继续。'
          : '确认所选的游戏，导入后点击封面即可随时启动。'}
      </p>
      {outcome ? (
        <>
          <div className="game-import-results">
            {outcome.results.map((item, index) => (
              <div
                className={`game-import-result ${item.error ? 'failed' : ''}`}
                key={item.path || item.id || index}
              >
                <span className="game-import-mark">
                  {item.error ? <X size={16} /> : <Check size={16} />}
                </span>
                <div>
                  <strong>{item.title || fileNameOf(item.path || '')}</strong>
                  <small>
                    {item.error ||
                      (item.existed
                        ? '已在游戏空间中，启动路径已更新'
                        : '导入成功')}
                  </small>
                </div>
              </div>
            ))}
          </div>
          <div className="dialog-footer">
            <span>
              <ShieldCheck size={15} /> 已成功导入的部分已进入游戏空间
            </span>
            <button
              className="button primary"
              onClick={() =>
                onImported(
                  outcome.data,
                  outcome.data.imported,
                  outcome.results.filter((item) => item.error).length,
                )
              }
            >
              完成
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="game-import-list">
            {paths.map((item) => (
              <div className="game-import-item" key={item}>
                <Gamepad2 size={19} />
                <div>
                  <strong>{fileNameOf(item)}</strong>
                  <small>{item}</small>
                </div>
              </div>
            ))}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />{' '}
            自动获取封面和介绍
            <span>按游戏名在 Steam 搜索，联网时生效</span>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-footer">
            <span>
              <ShieldCheck size={15} /> 仅记录启动路径，游戏不会被复制或修改
            </span>
            <div>
              <button
                type="button"
                className="button subtle"
                disabled={busy}
                onClick={() => setPicker(true)}
              >
                重新选择
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={submit}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Plus size={17} />
                )}
                {busy ? '正在导入…' : `导入 ${paths.length} 款游戏`}
              </button>
            </div>
          </div>
        </>
      )}
    </Dialog>
  )
}
