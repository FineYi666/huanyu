import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ArrowDownAZ,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Cloud,
  CloudCheck,
  Copy,
  Download,
  Film,
  Folder,
  FolderOpen,
  Gamepad2,
  Grid2X2,
  Heart,
  History,
  ImagePlus,
  LayoutGrid,
  List,
  LoaderCircle,
  Maximize,
  Minimize,
  Minus,
  RefreshCw,
  Moon,
  Palette,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { api } from './api'
import Dialog, { IconButton } from './ui'
import GamesPage, {
  GameDetailDialog,
  GameImportDialog,
} from './games'
import type { AppState, Episode, Game, Media } from './types'
import AppearancePicker, { type AppearancePatch } from './AppearancePicker'
import DeepSeekSettings from './DeepSeekSettings'
import { episodeLabel, matchesEpisode } from './episode-labels'
import LocalPicker from './LocalPicker'
import QuarkQrConnect from './QuarkQrConnect'
import {
  SynthAtmosphere,
  GildedAtmosphere,
  EmberAtmosphere,
  GroveAtmosphere,
  LunarAtmosphere,
  AuroraAtmosphere,
  GlacierAtmosphere,
} from './SkinAtmospheres'
import { getSkin } from './skins'
import NewSeasonPage, {
  ResourceSearch,
  type SeasonTitle,
} from './NewSeasonPage'
import StreamVideo, { type NativeSubtitleTrack } from './StreamVideo'
import EmbeddedSubtitlePanel from './EmbeddedSubtitlePanel'
import SubtitleAppearance from './SubtitleAppearance'
import { normalizeSubtitleStyle, type SubtitleStyle } from '../subtitle-style.mjs'
import SubtitlePanel, { type SubtitleTrack } from './SubtitlePanel'

type Page =
  | 'home'
  | 'library'
  | 'anime'
  | 'movies'
  | 'games'
  | 'favorites'
  | 'history'
type ImportMode = 'local' | 'quark'
const genres = ['全部', '奇幻', '治愈', '日常', '热血', '悬疑', '电影']
const sourceNames = {
  sample: '示例片单',
  local: '本地资源',
  quark: '夸克网盘',
  url: '在线资源',
}
const pageNames = {
  home: '本季新番',
  library: '我的媒体库',
  anime: '动漫',
  movies: '电影',
  games: '游戏空间',
  favorites: '我的收藏',
  history: '观看记录',
}
const categoryOf = (media: Media) =>
  media.category || (media.genre === '电影' ? 'movie' : 'anime')
const sizeLabel = (size?: number) =>
  !size
    ? ''
    : size >= 1024 ** 3
      ? `${(size / 1024 ** 3).toFixed(1)} GB`
      : `${Math.round(size / 1024 ** 2)} MB`
const timeLabel = (time: number) =>
  `${Math.floor(time / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(time % 60)
    .toString()
    .padStart(2, '0')}`
function latestProgress(media: Media) {
  return Object.entries(media.progress || {}).sort(
    (a, b) => b[1].at - a[1].at,
  )[0]
}

function Cover({
  media,
  className = '',
}: {
  media: Media
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [media.cover])
  return (
    <div
      className={`cover ${className} fallback-${Math.abs(media.title.charCodeAt(0)) % 5}`}
    >
      {media.cover && !failed ? (
        <img
          src={media.cover}
          alt={media.title}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-fallback">
          <Film size={36} strokeWidth={1} />
          <span>{media.title}</span>
          <small>MY PRIVATE CINEMA</small>
        </div>
      )}
    </div>
  )
}

function ImportDialog({
  mode,
  preset,
  categoryPreset,
  subject,
  replacement,
  onSearch,
  onClose,
  onImported,
}: {
  mode: ImportMode
  preset?: string
  categoryPreset?: 'anime' | 'movie'
  subject?: SeasonTitle
  replacement?: Media
  onSearch: (media: Media) => void
  onClose: () => void
  onImported: (state: AppState, ids: string[], count: number) => void
}) {
  const [tab, setTab] = useState(mode)
  const [title, setTitle] = useState(preset || '')
  const [folder, setFolder] = useState('')
  const [paths, setPaths] = useState<string[]>([])
  const [link, setLink] = useState('')
  const [code, setCode] = useState('')
  const [split, setSplit] = useState(false)
  const [category, setCategory] = useState(categoryPreset || 'auto')
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<'folder' | 'files' | null>(null)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const data = await api<AppState & { ids: string[]; count: number }>(
        replacement ? `/media/${replacement.id}/source` : `/import/${tab}`,
        tab === 'local'
          ? {
              mode: tab,
              paths: paths.length
                ? paths
                : folder
                    .split('\n')
                    .map((x) => x.trim().replace(/^"|"$/g, ''))
                    .filter(Boolean),
              title,
              splitByFolder: split,
              category,
              subjectId: subject?.id,
            }
          : { mode: tab, url: link, code, title, category, subjectId: subject?.id },
      )
      onImported(data, data.ids, data.count)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (picker)
    return (
      <Dialog
        key="local-picker"
        title={picker === 'folder' ? '选择本地文件夹' : '选择本地视频文件'}
        onClose={() => setPicker(null)}
        className="local-picker-dialog"
        hideHeader
      >
        <LocalPicker
          mode={picker}
          initialPath={
            picker === 'folder'
              ? folder.split('\n')[0].trim().replace(/^"|"$/g, '')
              : ''
          }
          onCancel={() => setPicker(null)}
          onSelect={(selected) => {
            setPaths(selected)
            setFolder(selected.join('\n'))
            setError('')
            setPicker(null)
          }}
        />
      </Dialog>
    )
  return (
    <Dialog
      title={replacement ? '重新选择视频资源' : '把好故事，收进幻屿'}
      key="import-form"
      onClose={() => {
        if (!busy) onClose()
      }}
      className="import-dialog"
    >
      <p className="dialog-intro">
        {replacement ? `为《${replacement.title}》更换视频。封面、简介与收藏保留；不同文件的观看进度重新记录。新资源确认成功前，原资源会保留。` : subject
          ? `关联《${subject.title}》，导入后自动沿用新番封面、简介与评分。`
          : '无论存在硬盘，还是藏在云端，都有一个位置留给它。'}
      </p>
      <div className="import-tabs">
        <button
          className={tab === 'local' ? 'active' : ''}
          onClick={() => {
            setTab('local')
            setError('')
          }}
          disabled={busy}
        >
          <FolderOpen size={18} /> 本地视频
        </button>
        <button
          className={tab === 'quark' ? 'active' : ''}
          onClick={() => {
            setTab('quark')
            setError('')
          }}
          disabled={busy}
        >
          <Cloud size={18} /> 夸克网盘
        </button>
      </div>
      <form onSubmit={submit}>
        {tab === 'local' ? (
          <>
            <div className="import-zone">
              <div className="folder-illustration">
                <FolderOpen size={35} strokeWidth={1.3} />
              </div>
              <h3>给你的影片找个家</h3>
              <p>选择整部剧的文件夹，自动整理每一集</p>
              <div className="import-zone-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => setPicker('folder')}
                >
                  <Folder size={17} /> 选择文件夹
                </button>
                <button
                  type="button"
                  className="button subtle"
                  disabled={busy}
                  onClick={() => setPicker('files')}
                >
                  选择视频文件 <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
            <label className="field">
              文件夹路径 <span>也可以直接粘贴完整路径</span>
              <textarea
                rows={2}
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value)
                  setPaths([])
                }}
                placeholder={'例如 D:\\我的视频\\葬送的芙莉莲'}
                required
              />
            </label>
            {!subject && !replacement && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={split}
                  onChange={(e) => setSplit(e.target.checked)}
                />{' '}
                按子文件夹分别创建作品<span>适合批量导入</span>
              </label>
            )}
          </>
        ) : (
          <>
            <div className="cloud-note">
              <Cloud size={25} />
              <div>
                <strong>连接云端，不占本地空间</strong>
                <p>粘贴分享内容，自动识别链接与提取码。</p>
              </div>
            </div>
            {replacement && <button type="button" className="button outline" disabled={busy} onClick={() => onSearch(replacement)}><Search size={16} /> 搜索其他夸克资源</button>}
            <label className="field">
              夸克分享链接
              <textarea
                rows={4}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={
                  'https://pan.quark.cn/s/…\n支持粘贴包含提取码的完整分享文案'
                }
                required
              />
            </label>
            <label className="field">
              提取码 <span>可选，链接中包含时会自动识别</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={8}
                placeholder="请输入提取码"
              />
            </label>
            <p className="small-note">
              在线播放需要在设置中连接夸克账号。首次播放会询问是否转存本集；播放质量和可用性取决于网盘权限，也可前往官方页面观看。
            </p>
          </>
        )}
        <label className="field">
          作品区域 <span>可自动识别，也可以手动指定</span>
        </label>
        <div className="category-picker">
          {[
            ['auto', '自动识别'],
            ['anime', '动漫'],
            ['movie', '电影'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={category === value ? 'active' : ''}
              aria-pressed={category === value}
              disabled={Boolean(replacement) || (Boolean(subject) && value !== 'anime')}
              onClick={() => setCategory(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          作品名称{' '}
          <span>
            {replacement ? '作品资料保持不变，可在详情页编辑' : subject
              ? '已关联此新番，可在导入后的详情页编辑'
              : '可选，留空则自动识别'}
          </span>
          <input
            value={title}
            disabled={Boolean(subject || replacement)}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            placeholder="为这个故事起个名字"
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <span>
            <ShieldCheck size={15} />{' '}
            {tab === 'local'
              ? '仅建立索引，视频不会被复制或上传'
              : '登录信息由当前 Windows 账号加密保存'}
          </span>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Plus size={17} />
            )}
            {busy ? '正在整理资源…' : replacement ? '替换视频资源' : '导入媒体库'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function DetailDialog({
  media,
  onClose,
  onFavorite,
  onPlay,
  onImport,
  onReplace,
  onUpdate,
  notify,
  deepseekConnected,
  onConfigureAI,
}: {
  media: Media
  onClose: () => void
  onFavorite: () => void
  onPlay: (episode: Episode) => void
  onImport: (mode: ImportMode) => void
  onReplace: () => void
  onUpdate: (data: AppState) => void
  notify: (message: string) => void
  deepseekConnected: boolean
  onConfigureAI: () => void
}) {
  const [search, setSearch] = useState('')
  const [reverse, setReverse] = useState(false)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [title, setTitle] = useState(media.title)
  const [description, setDescription] = useState(media.description || '')
  const [genre, setGenre] = useState(media.genre || '未分类')
  const [category, setCategory] = useState(categoryOf(media))
  const file = useRef<HTMLInputElement>(null)
  const [enrichBusy, setEnrichBusy] = useState(false)
  const metadataBusy =
    enrichBusy || ['queued', 'loading'].includes(media.metadataStatus || '')
  useEffect(() => {
    if (!editing) {
      setTitle(media.title)
      setDescription(media.description || '')
      setGenre(media.genre || '未分类')
      setCategory(categoryOf(media))
    }
  }, [media.title, media.description, media.genre, editing])
  async function enrich() {
    if (!deepseekConnected) {
      onConfigureAI()
      return
    }
    setEnrichBusy(true)
    try {
      const data = await api<AppState & { queued: number }>(
        '/metadata/enrich',
        { id: media.id },
      )
      onUpdate(data)
      notify(
        data.queued
          ? '正在补全封面与简介，你可以继续浏览或播放'
          : '封面与简介已齐全，手动编辑的内容会保留',
      )
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setEnrichBusy(false)
    }
  }
  const episodes = media.episodes.filter((e, index) =>
    matchesEpisode(e.name, index, search),
  )
  const display = reverse ? [...episodes].reverse() : episodes
  async function saveEdit() {
    try {
      onUpdate(
        await api<AppState>(
          `/media/${media.id}`,
          { title, description, genre, category },
          'PATCH',
        ),
      )
      setEditing(false)
      notify('作品信息已更新')
    } catch (e) {
      notify((e as Error).message)
    }
  }
  async function uploadCover(cover: File) {
    if (cover.size > 4 * 1024 * 1024) {
      notify('封面图片请控制在 4 MB 以内')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        onUpdate(
          await api<AppState>(`/cover/${media.id}`, { image: reader.result }),
        )
        notify('新封面已保存')
      } catch (e) {
        notify((e as Error).message)
      }
    }
    reader.readAsDataURL(cover)
  }
  const latest = latestProgress(media)
  const resume =
    media.episodes.find((e) => e.id === latest?.[0]) || media.episodes[0]
  return (
    <Dialog title="作品详情" onClose={onClose} className="detail-dialog">
      <div className="detail-overview">
        <button
          className="detail-cover-button"
          title="更换作品封面"
          onClick={() => file.current?.click()}
        >
          <Cover media={media} />
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
          <span className={`source-label ${media.source}`}>
            <SourceIcon source={media.source} />
            {sourceNames[media.source]}
          </span>
          <p className="detail-subtitle">
            {media.subtitle || 'A STORY WORTH KEEPING'}
          </p>
          <h2>{media.title}</h2>
          <div className="detail-meta">
            {media.year && <span>{media.year}</span>}
            <span>{media.genre || '未分类'}</span>
            <span>
              {media.source === 'sample'
                ? `全 ${media.total} 集`
                : `${media.episodes.length} 个视频`}
            </span>
            {media.rating && <strong>★ {media.rating}</strong>}
          </div>
          <p className="detail-description">
            {media.description ||
              '把喜欢的故事收在这里，随时继续上一次的旅程。你可以编辑简介和分类，让媒体库更有自己的样子。'}
          </p>
          <div className="detail-actions">
            {media.source !== 'sample' && <button className="button outline" onClick={onReplace}><RefreshCw size={16} /> 重新选择视频资源</button>}
            {resume ? (
              <button className="button primary" onClick={() => onPlay(resume)}>
                <Play size={16} fill="currentColor" />
                {latest ? '继续观看' : '开始观看'}
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => onImport('local')}
              >
                <Plus size={17} />
                关联本地视频
              </button>
            )}
            <button
              className={`button outline ${media.favorite ? 'is-favorite' : ''}`}
              onClick={onFavorite}
            >
              <Heart
                size={17}
                fill={media.favorite ? 'currentColor' : 'none'}
              />
              {media.favorite ? '已收藏' : '收藏'}
            </button>
            <IconButton
              label="编辑作品信息"
              onClick={() => setEditing(!editing)}
            >
              <Settings2 size={18} />
            </IconButton>
          </div>
        </div>
      </div>
      {media.source !== 'sample' && (
        <div className={`metadata-status-panel ${media.metadataStatus || ''}`}>
          <div>
            <span className="metadata-status-icon">
              {metadataBusy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}
            </span>
            <div>
              <strong>
                {metadataBusy
                  ? '资料管家正在整理这部作品'
                  : media.metadataStatus === 'ready'
                    ? '这部作品的资料已整理完成'
                    : '给这部作品补一张封面、一段介绍'}
              </strong>
              <p>
                {media.metadataError ||
                  (media.metadataProvider
                    ? `简介由 ${media.metadataProvider} 整理${media.posterProvider ? ` · 海报来自 ${media.posterProvider}` : ''}`
                    : '绑定 DeepSeek 后，新导入的故事会自动变得更完整。')}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="button outline"
            disabled={metadataBusy}
            onClick={enrich}
          >
            <Sparkles size={14} />
            {metadataBusy
              ? '整理中…'
              : deepseekConnected
                ? '补全资料'
                : '绑定 DeepSeek'}
          </button>
          {media.posterSourceUrl &&
            /^https:\/\/(bgm\.tv|en\.wikipedia\.org|(?:[a-z]+\.)?(?:apple\.com|itunes\.apple\.com))\//.test(
              media.posterSourceUrl,
            ) && (
              <a
                className="metadata-source-link"
                href={media.posterSourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看海报作品资料 <ArrowUpRight size={12} />
              </a>
            )}
        </div>
      )}
      {editing && (
        <div className="edit-panel">
          <label className="field">
            作品区域
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'anime' | 'movie')}
            >
              <option value="anime">动漫</option>
              <option value="movie">电影</option>
            </select>
          </label>
          <label className="field">
            作品名称
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            分类
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              {['未分类', ...genres.slice(1)].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="field">
            简介
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="edit-actions">
            <button className="button subtle" onClick={() => setEditing(false)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={saveEdit}
              disabled={!title.trim()}
            >
              保存修改
            </button>
          </div>
        </div>
      )}
      <div className="episodes-heading">
        <h3>
          剧集列表{' '}
          <span>
            {media.episodes.length
              ? `${media.episodes.length} EPISODES`
              : '等待一个故事开始'}
          </span>
        </h3>
        {media.episodes.length > 0 && (
          <div>
            <label className="episode-search">
              <Search size={15} />
              <input
                placeholder="搜索分集"
                aria-label="搜索分集名称、集数或原文件名"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <IconButton
              label={reverse ? '正序排列' : '倒序排列'}
              onClick={() => setReverse(!reverse)}
            >
              <ArrowDownAZ size={17} />
            </IconButton>
          </div>
        )}
      </div>
      {!media.episodes.length ? (
        <div className="detail-empty">
          <Clapperboard size={33} strokeWidth={1.3} />
          <h3>片单已备好，就差你的影片</h3>
          <p>
            这是作品资料预览，尚未关联视频。导入本地文件或夸克链接，开启放映。
          </p>
          <button className="button outline" onClick={() => onImport('quark')}>
            <Cloud size={17} /> 导入夸克资源 <ArrowUpRight size={14} />
          </button>
        </div>
      ) : (
        <div className="episode-list">
          {display.map((episode) => {
            const index = media.episodes.indexOf(episode)
            const progress = media.progress?.[episode.id]
            const watched =
              progress &&
              progress.duration > 0 &&
              progress.time / progress.duration > 0.94
            return (
              <button
                key={episode.id}
                className={`episode ${latest?.[0] === episode.id ? 'current' : ''}`}
                title={`原文件名：${episode.name}`}
                onClick={() => onPlay(episode)}
              >
                <span className="episode-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <strong>{episodeLabel(index)}</strong>
                  <small>
                    {progress
                      ? `${watched ? '已看完' : `看到 ${timeLabel(progress.time)}`} · `
                      : ''}
                    {sizeLabel(episode.size) || sourceNames[media.source]}
                  </small>
                </div>
                {watched ? <CheckCheck size={19} /> : <Play size={17} />}
              </button>
            )
          })}
          {!display.length && <p className="no-episodes">没有找到匹配的分集</p>}
        </div>
      )}
      <div className="detail-bottom">
        <span>
          <ShieldCheck size={14} />
          {media.source === 'sample'
            ? '示例片单仅展示作品资料，不提供影视片源'
            : '移除记录不会删除本地视频或网盘文件'}
        </span>
        {media.shareUrl && (
          <a
            className="text-button"
            href={media.shareUrl}
            target="_blank"
            rel="noreferrer"
          >
            夸克官方页面 <ArrowUpRight size={14} />
          </a>
        )}
        <button
          className="text-button danger"
          onClick={() => setRemoving(!removing)}
        >
          <Trash2 size={14} />
          移除作品
        </button>
      </div>
      {removing && (
        <div className="remove-confirm">
          <p>确认从幻屿移除「{media.title}」？源视频文件会保留。</p>
          <div>
            <button
              className="button subtle"
              onClick={() => setRemoving(false)}
            >
              保留
            </button>
            <button
              className="button danger-button"
              onClick={async () => {
                try {
                  onUpdate(
                    await api<AppState>(`/media/${media.id}`, {}, 'DELETE'),
                  )
                  onClose()
                  notify('已移除作品，源视频文件保留')
                } catch (e) {
                  notify((e as Error).message)
                }
              }}
            >
              确认移除
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function SourceIcon({ source }: { source: string }) {
  return source === 'quark' ? (
    <Cloud size={12} />
  ) : source === 'local' ? (
    <Folder size={12} />
  ) : (
    <Sparkles size={12} />
  )
}

function Player({
  media,
  initialEpisode,
  autoNext,
  subtitlesEnabled,
  onSubtitlesEnabled,
  subtitleStyle,
  onSubtitleStyle,
  onReplace,
  onClose,
  onProgress,
  notify,
}: {
  media: Media
  initialEpisode: Episode
  autoNext: boolean
  subtitlesEnabled: boolean
  onSubtitlesEnabled: (enabled: boolean) => void
  subtitleStyle: SubtitleStyle
  onSubtitleStyle: (value: SubtitleStyle) => void
  onReplace: () => void
  onClose: () => void
  onProgress: () => void
  notify: (message: string) => void
}) {
  const [episode, setEpisode] = useState(initialEpisode)
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState('file')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveConsent, setSaveConsent] = useState(false)
  const [restoreConfirm,setRestoreConfirm]=useState(false)
  const restoreWasPlaying=useRef(false)
  const [rate, setRate] = useState('1')
  const [subtitle, setSubtitle] = useState<
    (SubtitleTrack & { delay: number }) | null
  >(null)
  const [subtitleError, setSubtitleError] = useState('')
  const [subtitleContext, setSubtitleContext] = useState('')
  const [nativeTracks, setNativeTracks] = useState<NativeSubtitleTrack[]>([])
  const [nativeSubtitleId, setNativeSubtitleId] = useState('off')
  const [embeddedAvailable, setEmbeddedAvailable] = useState<boolean | null>(null)
  const [useExternal, setUseExternal] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const fullscreenLeftAt = useRef(0)
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (stage.current?.requestFullscreen) await stage.current.requestFullscreen()
      else setExpanded(value => !value)
    } catch {
      setExpanded(true)
      notify('当前环境未允许系统全屏，已放大播放器')
    }
  }, [notify])
  useEffect(() => {
    const changed = () => {
      setFullscreen(Boolean(document.fullscreenElement))
      if (!document.fullscreenElement) fullscreenLeftAt.current = Date.now()
    }
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        void toggleFullscreen()
      }
    }
    document.addEventListener('fullscreenchange', changed)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('fullscreenchange', changed)
      document.removeEventListener('keydown', key)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [toggleFullscreen])
  const lastSaved = useRef(0)
  const requestIndex = useRef(0)
  const index = media.episodes.findIndex((e) => e.id === episode.id)
  const save = useCallback(() => {
    const element = video.current
    if (
      !element ||
      !Number.isFinite(element.duration) ||
      !element.duration ||
      element.currentTime < 0.2
    )
      return
    api('/progress', {
      mediaId: element.dataset.mediaId,
      episodeId: element.dataset.episodeId,
      time: Math.min(element.currentTime, element.duration),
      duration: element.duration,
    })
      .then(onProgress)
      .catch(() => {})
  }, [onProgress])
  function askRestore(){restoreWasPlaying.current=!!video.current && !video.current.paused;video.current?.pause();setRestoreConfirm(true)}
  function cancelRestore(){setRestoreConfirm(false);if(restoreWasPlaying.current)void video.current?.play().catch(()=>{})}
  async function load(selected: Episode, authorized = false, resave = false) {
    const request = ++requestIndex.current
    save()
    setEpisode(selected)
    setSubtitle(null)
    setSubtitleContext('')
    setNativeTracks([])
    setNativeSubtitleId('off')
    setEmbeddedAvailable(null)
    setUseExternal(false)
    setSubtitleError('')
    setLoading(true)
    setError('')
    setUrl('')
    setSaveConsent(false)
    setRestoreConfirm(false)
    try {
      const response = await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: media.id,
          episodeId: selected.id,
          authorizeSave: authorized,
          resave,
        }),
      })
      const data = await response.json()
      if (request !== requestIndex.current) return
      if (data.needsSave) {
        if(resave)setRestoreConfirm(true)
        else setSaveConsent(true)
        return
      }
      if (!response.ok) throw new Error(data.error)
      setFormat(data.format || 'file')
      setSubtitleContext(data.subtitleContext || '')
      setUrl(data.url)
    } catch (e) {
      if (request === requestIndex.current) setError((e as Error).message)
    } finally {
      if (request === requestIndex.current) setLoading(false)
    }
  }
  useEffect(() => {
    load(initialEpisode)
    return () => {
      ++requestIndex.current
      save()
    }
  }, [])
  useEffect(() => {
    if (video.current) video.current.playbackRate = Number(rate)
  }, [rate, url])
  return (
    <Dialog
      title={media.title}
      onClose={() => {
        if (document.fullscreenElement) { void document.exitFullscreen(); return }
        if (Date.now() - fullscreenLeftAt.current < 350) return
        save()
        onClose()
      }}
      className={`player-dialog ${expanded ? 'player-expanded' : ''}`}
    >
      <div className="player-layout">
        <div className="player-main">
          <div className="video-stage" ref={stage} onDoubleClick={(event) => { if (event.target === stage.current || event.target === video.current) void toggleFullscreen() }}>
            {fullscreen && <button className="button fullscreen-exit" onClick={() => void toggleFullscreen()}><Minimize size={16} /> 退出全屏</button>}
            {url && (
              <StreamVideo
                ref={video}
                key={url}
                src={url}
                format={format}
                subtitle={(!useExternal && embeddedAvailable) || subtitlesEnabled ? subtitle : null}
                nativeSubtitleId={useExternal ? 'off' : nativeSubtitleId}
                onNativeTracks={setNativeTracks}
                subtitleStyle={subtitleStyle}
                onSubtitleError={setSubtitleError}
                onStreamError={setError}
                data-media-id={media.id}
                data-episode-id={episode.id}
                controls
                autoPlay
                playsInline
                preload="metadata"
                onLoadedMetadata={() => {
                  const element = video.current!
                  const progress = media.progress?.[episode.id]
                  if (progress && progress.time < element.duration - 10)
                    element.currentTime = progress.time
                  element.playbackRate = Number(rate)
                }}
                onTimeUpdate={() => {
                  if (Date.now() - lastSaved.current > 5000) {
                    lastSaved.current = Date.now()
                    save()
                  }
                }}
                onPause={save}
                onEnded={() => {
                  save()
                  if (autoNext && media.episodes[index + 1])
                    load(media.episodes[index + 1])
                }}
                onError={() => {
                  setError(
                    '当前浏览器无法解码这个视频。可以用系统播放器打开本地文件，或前往夸克官方页面观看。',
                  )
                }}
              />
            )}
            {(loading || error || saveConsent || restoreConfirm) && (
              <div className="player-status">
                {loading ? (
                  <>
                    <LoaderCircle size={34} className="spin" />
                    <h3>正在准备你的放映…</h3>
                    <p>
                      {media.source === 'quark'
                        ? '正在连接夸克，首次转存可能需要一点时间'
                        : '好故事，即将开始'}
                    </p>
                  </>
                ) : restoreConfirm ? (
                  <><Cloud size={36}/><h3>重新转存{episodeLabel(index)}</h3><p>从原分享重新保存本集到夸克网盘根目录{episode.size ? `，约 ${sizeLabel(episode.size)}` : ''}。<br/>会占用网盘空间，不会删除现有文件。原分享需要仍然有效。</p><div className="player-error-actions"><button className="button outline" onClick={cancelRestore}>取消</button><button className="button primary" onClick={()=>load(episode,true,true)}><RefreshCw size={16}/>重新转存并播放</button></div></>
                ) : saveConsent ? (
                  <>
                    <Cloud size={36} />
                    <h3>把这一集带到你的云端</h3>
                    <p>
                      在线播放需要将本集转存到你的夸克网盘根目录。
                      <br />
                      会占用网盘空间，不会下载到本地。
                    </p>
                    <button
                      className="button primary"
                      onClick={() => load(episode, true)}
                    >
                      转存本集并播放 <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <Film size={34} />
                    <h3>暂时无法开始放映</h3>
                    <p>{error}</p>
                    <div className="player-error-actions">
                      {media.source === 'local' && (
                        <button
                          className="button primary"
                          onClick={() =>
                            api('/open-local', {
                              mediaId: media.id,
                              episodeId: episode.id,
                            })
                              .then(() => notify('已交给系统播放器打开'))
                              .catch((e) => notify(e.message))
                          }
                        >
                          用系统播放器打开 <ArrowUpRight size={15} />
                        </button>
                      )}
                      {media.shareUrl && (
                        <a
                          className="button primary"
                          href={media.shareUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          官方网页播放 <ArrowUpRight size={15} />
                        </a>
                      )}
                      <button
                        className="button outline"
                        onClick={() => load(episode)}
                      >
                        重新尝试
                      </button>
                      {media.source==='quark' && <button className="button primary" onClick={askRestore}><RefreshCw size={16}/>重新转存本集</button>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="player-toolbar">
            <div>
              <span>正在播放 · {media.title}</span>
              <h3 title={`原文件名：${episode.name}`}>{episodeLabel(index)}</h3>
            </div>
            <label className="speed-select">
              <select
                aria-label="播放速度"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              >
                {['0.5', '0.75', '1', '1.25', '1.5', '2'].map((v) => (
                  <option key={v} value={v}>
                    {v === '1' ? '正常速度' : `${v} 倍速`}
                  </option>
                ))}
              </select>
            </label>
            <IconButton
              label="上一集"
              onClick={() => {
                if (media.episodes[index - 1]) load(media.episodes[index - 1])
              }}
              className={index === 0 ? 'disabled' : ''}
            >
              <ChevronLeft size={21} />
            </IconButton>
            <IconButton
              label="下一集"
              onClick={() => {
                if (media.episodes[index + 1]) load(media.episodes[index + 1])
              }}
              className={index === media.episodes.length - 1 ? 'disabled' : ''}
            >
              <ChevronRight size={21} />
            </IconButton>
          </div>
          <div className="playback-options">
            <div className="subtitle-master"><button type="button" role="switch" aria-label="外挂字幕与自动搜索" aria-checked={subtitlesEnabled} className={`switch ${subtitlesEnabled ? 'on' : ''}`} onClick={() => onSubtitlesEnabled(!subtitlesEnabled)}><i /></button><div><strong>外挂字幕与自动搜索 · {subtitlesEnabled ? '开启' : '关闭'}</strong><small>视频画面原有字幕保留</small></div></div>
            <div className="playback-option-actions">
              {media.source==='quark' && <button className="button outline" disabled={loading || restoreConfirm} onClick={askRestore}><Cloud size={15}/>重新转存本集</button>}
              <button className="button outline" onClick={onReplace}><RefreshCw size={15} /> 重新选择视频资源</button>
              <button className="button outline" onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize size={15} /> : <Maximize size={15} />}{expanded ? '还原窗口' : '放大播放'}</button>
              <button className="button primary" title="双击画面或按 F 键切换全屏" onClick={() => void toggleFullscreen()}><Maximize size={15} /> 全屏播放</button>
            </div>
          </div>
          {url && subtitleContext && <EmbeddedSubtitlePanel key={episode.id} mediaId={media.id} episodeId={episode.id} context={subtitleContext} video={video} nativeTracks={nativeTracks} onNative={setNativeSubtitleId} onTrack={setSubtitle} onAvailable={setEmbeddedAvailable} externalMode={useExternal} onExternal={() => {setSubtitle(null);setUseExternal(value=>!value)}}/>}
          {url && subtitlesEnabled && (useExternal || embeddedAvailable === false) && (
            <SubtitlePanel
              key={episode.id}
              media={media}
              episode={episode}
              onTrack={(track) => {
                setSubtitle(track)
                setSubtitleError('')
              }}
              trackError={subtitleError}
            />
          )}
          <SubtitleAppearance value={subtitleStyle} onChange={onSubtitleStyle}/>
          <p className="player-footnote">
            <ShieldCheck size={13} /> 自动保存观看进度
            {autoNext ? ' · 播放结束后自动播放下一集' : ''}
          </p>
        </div>
        <aside className="player-episodes">
          <div>
            <h3>选集</h3>
            <span>{media.episodes.length} 集</span>
          </div>
          {media.episodes.map((item, i) => (
            <button
              className={item.id === episode.id ? 'active' : ''}
              key={item.id}
              title={`原文件名：${item.name}`}
              onClick={() => load(item)}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              <strong>{episodeLabel(i)}</strong>
              {item.id === episode.id && (
                <span className="playing-bars">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </button>
          ))}
        </aside>
      </div>
    </Dialog>
  )
}

function SettingsDialog({
  state,
  onUpdate,
  onClose,
  notify,
  onAppearance,
}: {
  state: AppState
  onUpdate: (data: AppState) => void
  onClose: () => void
  notify: (message: string) => void
  onAppearance: () => void
}) {
  const [cookie, setCookie] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function setting(key: string, value: unknown) {
    try {
      onUpdate(await api<AppState>('/settings', { [key]: value }))
    } catch (e) {
      notify((e as Error).message)
    }
  }
  async function connect(disconnect = false) {
    setError('')
    setBusy(true)
    try {
      onUpdate(
        await api<AppState>('/quark/connect', {
          cookie: disconnect ? '' : cookie,
        }),
      )
      setCookie('')
      notify(disconnect ? '已断开夸克账号' : '夸克账号连接成功')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="让幻屿，更合你心意"
      onClose={onClose}
      className="settings-dialog"
    >
      <p className="dialog-intro">一点小调整，让每一次放映都刚刚好。</p>
      <button
        type="button"
        className="settings-appearance-card"
        onClick={onAppearance}
      >
        <span className="settings-appearance-icon">
          <Palette size={22} />
        </span>
        <div>
          <strong>给放映室，换一种氛围</strong>
          <p>
            {getSkin(state.settings.skin).name} ·{' '}
            {state.settings.glass ? '液态玻璃已开启' : '经典按钮材质'}
          </p>
        </div>
        <ChevronRight size={18} />
      </button>
      <DeepSeekSettings state={state} onUpdate={onUpdate} notify={notify} />
      <h3 className="settings-section">放映偏好</h3>
      <div className="setting-row"><div><strong>外挂字幕与自动搜索</strong><p>关闭后不再额外加载字幕，视频原有字幕保留</p></div><button role="switch" aria-label="外挂字幕与自动搜索" aria-checked={state.settings.subtitlesEnabled} className={`switch ${state.settings.subtitlesEnabled ? 'on' : ''}`} onClick={() => setting('subtitlesEnabled', !state.settings.subtitlesEnabled)}><i /></button></div>
      <div className="setting-row">
        <div>
          <strong>自动播放下一集</strong>
          <p>一集结束后，故事继续</p>
        </div>
        <button
          role="switch"
          aria-checked={state.settings.autoNext}
          aria-label="自动播放下一集"
          className={`switch ${state.settings.autoNext ? 'on' : ''}`}
          onClick={() => setting('autoNext', !state.settings.autoNext)}
        >
          <i />
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>显示示例片单</strong>
          <p>在发现页展示精心挑选的作品资料</p>
        </div>
        <button
          role="switch"
          aria-checked={state.settings.showSamples}
          aria-label="显示示例片单"
          className={`switch ${state.settings.showSamples ? 'on' : ''}`}
          onClick={() => setting('showSamples', !state.settings.showSamples)}
        >
          <i />
        </button>
      </div>
      <div className="setting-row">
        <div>
          <strong>界面外观</strong>
          <p>为白天和深夜各留一种心情</p>
        </div>
        <div className="theme-selector">
          <button
            className={state.settings.theme === 'light' ? 'active' : ''}
            aria-label="浅色模式"
            onClick={() => setting('theme', 'light')}
          >
            <Sun size={16} />
          </button>
          <button
            className={state.settings.theme === 'dark' ? 'active' : ''}
            aria-label="深色模式"
            onClick={() => setting('theme', 'dark')}
          >
            <Moon size={16} />
          </button>
        </div>
      </div>
      <h3 className="settings-section">
        云端连接{' '}
        <span
          className={`connection-state ${state.settings.quarkConnected ? 'connected' : ''}`}
        >
          {state.settings.quarkConnected ? '已连接' : '未连接'}
        </span>
      </h3>
      <div className="quark-setting">
        <div className="quark-setting-title">
          <span className="quark-logo">Q</span>
          <div>
            <strong>夸克网盘</strong>
            <p>导入分享链接，在幻屿中在线观看</p>
          </div>
          <a
            href="https://pan.quark.cn/"
            target="_blank"
            rel="noreferrer"
            className="text-button"
          >
            打开夸克 <ArrowUpRight size={14} />
          </a>
        </div>
        <QuarkQrConnect
          connected={state.settings.quarkConnected}
          onUpdate={onUpdate}
          notify={notify}
        />
        <label className="field">
          手动填写 Cookie（备用）
          <textarea
            rows={3}
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="粘贴你自己在 pan.quark.cn 登录后的 Cookie"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <details className="cookie-help">
          <summary>如何获取登录信息？</summary>
          <p>
            在浏览器打开夸克网盘并登录，按 F12 打开开发者工具 →
            网络（Network），刷新页面，选择 drive-pc.quark.cn
            的请求，在请求标头中复制 Cookie 的值。请只使用你自己的账号。
          </p>
        </details>
        <p className="small-note">
          <ShieldCheck size={14} /> Cookie 由当前 Windows
          账号加密保存在本机，重启软件或电脑后自动恢复。若夸克主动使登录失效，则需要重新扫码。断开连接会删除保存的登录信息。
        </p>
        {state.settings.quarkStorageError && (
          <div className="form-error" role="alert">
            {state.settings.quarkStorageError}
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="quark-connect-actions">
          {state.settings.quarkConnected && (
            <button
              className="button subtle"
              disabled={busy}
              onClick={() => connect(true)}
            >
              断开连接
            </button>
          )}
          <button
            className="button primary"
            disabled={busy || !cookie.trim()}
            onClick={() => connect()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <CloudCheck size={16} />
            )}{' '}
            {busy ? '验证连接…' : '连接账号'}
          </button>
        </div>
      </div>
      <div className="settings-export">
        <div>
          <strong>你的片库，由你保管</strong>
          <p>导出作品信息、文件索引和观看进度。</p>
        </div>
        <a className="button outline" href="/api/export" download>
          <Download size={16} /> 导出备份
        </a>
      </div>
      <p className="version-note">
        幻屿 HUANYU · 1.3.0 <span>为每一个喜欢的故事，留一座小岛。</span>
      </p>
    </Dialog>
  )
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [page, setPage] = useState<Page>('home')
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('全部')
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState('default')
  const [layout, setLayout] = useState('grid')
  const [importing, setImporting] = useState<{
    mode: ImportMode
    preset?: string
    subject?: SeasonTitle
    replacement?: Media
  } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [playing, setPlaying] = useState<{
    mediaId: string
    episode: Episode
  } | null>(null)
  const [settings, setSettings] = useState(false)
  const [appearance, setAppearance] = useState(false)
  const [appearanceBusy, setAppearanceBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [menu, setMenu] = useState(false)
  const [resourceTarget, setResourceTarget] = useState<SeasonTitle | null>(null)
  const [resourceBusy, setResourceBusy] = useState(false)
  const [gameImporting, setGameImporting] = useState(false)
  const [selectedGame, setSelectedGame] = useState<string | null>(null)
  const [launchingGame, setLaunchingGame] = useState<string | null>(null)
  const [closeDialog, setCloseDialog] = useState(false)
  const [closeChoice, setCloseChoice] = useState<'tray' | 'exit'>('tray')
  const [closeNoMore, setCloseNoMore] = useState(false)

  const search = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const subtitleStyleTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const subtitleStyleRevision=useRef(0)
  const pendingSubtitleStyle=useRef<SubtitleStyle|null>(null)
  const notify = useCallback((message: string) => {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4200)
  }, [])
  const refresh = useCallback(() => {
    api<AppState>('/state')
      .then(data=>setState(pendingSubtitleStyle.current?{...data,settings:{...data.settings,subtitleStyle:pendingSubtitleStyle.current}}:data))
      .catch((e) => setLoadError(e.message))
  }, [])
  async function changeSubtitles(enabled: boolean) {
    setState(current => current ? {...current, settings: {...current.settings, subtitlesEnabled: enabled}} : current)
    try { await api<AppState>('/settings', {subtitlesEnabled: enabled}) }
    catch (error) {
      setState(current => current ? {...current, settings: {...current.settings, subtitlesEnabled: !enabled}} : current)
      notify((error as Error).message)
    }
  }
  function changeSubtitleStyle(value:SubtitleStyle){
    const style=normalizeSubtitleStyle(value),revision=++subtitleStyleRevision.current
    pendingSubtitleStyle.current=style
    setState(current=>current?{...current,settings:{...current.settings,subtitleStyle:style}}:current)
    clearTimeout(subtitleStyleTimer.current)
    subtitleStyleTimer.current=setTimeout(()=>{void api('/settings',{subtitleStyle:style}).then(()=>{if(revision===subtitleStyleRevision.current)pendingSubtitleStyle.current=null}).catch(error=>{if(revision===subtitleStyleRevision.current){pendingSubtitleStyle.current=null;notify(error.message)}})},250)
  }
  function replaceResource(media: Media) {
    setPlaying(null)
    setImporting({mode: media.source === 'local' ? 'local' : 'quark', preset: media.title, replacement: media})
  }
  useEffect(() => {
    refresh()
    const visible = () => {
      if (!document.hidden) refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearTimeout(toastTimer.current)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])
  const hasMetadataWork = Boolean(
    state?.media.some((media) =>
      ['queued', 'loading'].includes(media.metadataStatus || ''),
    ),
  )
  useEffect(() => {
    if (!hasMetadataWork) return
    const timer = setInterval(refresh, 1600)
    return () => clearInterval(timer)
  }, [hasMetadataWork, refresh])
  useEffect(() => {
    document.documentElement.dataset.theme = state?.settings.theme || 'light'
    document.documentElement.dataset.skin = state?.settings.skin || 'grove'
    document.documentElement.dataset.glass = String(
      state?.settings.glass ?? true,
    )
  }, [
    state?.settings.theme,
    state?.settings.skin,
    state?.settings.glass,
  ])
  // 桌面端（Electron）：Windows 自绘窗口按钮；macOS 使用系统红绿灯。
  const [isDesktop, setIsDesktop] = useState(false)
  const [isMac, setIsMac] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    if (!/ Electron\/[\d.]+/.test(navigator.userAgent)) return
    const mac = /Macintosh|Mac OS X/.test(navigator.userAgent)
    setIsDesktop(true)
    setIsMac(mac)
    document.documentElement.dataset.desktop = 'true'
    document.documentElement.dataset.platform = mac ? 'darwin' : 'win32'
    const desktop = window.yingyuDesktop
    if (!desktop?.onMaximizeChange) return
    void desktop.isMaximized().then(setIsMaximized).catch(() => {})
    desktop.onMaximizeChange(setIsMaximized)
  }, [])
  // 自定义皮肤：把取色得到的强调色注入 CSS 变量。
  useEffect(() => {
    const rootElement = document.documentElement
    if (
      state?.settings.skin === 'custom' &&
      /^#[0-9a-fA-F]{6}$/.test(state?.settings.customAccent || '')
    ) {
      rootElement.style.setProperty(
        '--custom-accent',
        state.settings.customAccent,
      )
      const numeric = parseInt(state.settings.customAccent.slice(1), 16)
      rootElement.style.setProperty(
        '--custom-accent-rgb',
        `${(numeric >> 16) & 255} ${(numeric >> 8) & 255} ${numeric & 255}`,
      )
    } else {
      rootElement.style.removeProperty('--custom-accent')
      rootElement.style.removeProperty('--custom-accent-rgb')
    }
  }, [state?.settings.skin, state?.settings.customAccent])
  // 关闭行为偏好与设置变更时同步到主进程。
  useEffect(() => {
    const desktop = window.yingyuDesktop
    if (!desktop?.setCloseBehavior) return
    desktop.setCloseBehavior({
      ask: state?.settings.closeAsk ?? true,
      action: state?.settings.closeAction === 'exit' ? 'exit' : 'tray',
    })
  }, [
    state?.settings.closeAsk,
    state?.settings.closeAction,
    isDesktop,
  ])
  // 主进程请求展示关闭确认弹窗。
  useEffect(() => {
    const desktop = window.yingyuDesktop
    if (!desktop?.onCloseAsk) return
    return desktop.onCloseAsk(() => {
      setCloseDialog(true)
      setCloseChoice(
        state?.settings.closeAction === 'exit' ? 'exit' : 'tray',
      )
    })
  }, [state?.settings.closeAction, state?.settings.skin])
  async function confirmClose() {
    setCloseDialog(false)
    const desktop = window.yingyuDesktop
    if (!desktop) return
    if (closeNoMore) {
      try {
        const value = await api<AppState>('/settings', {
          closeAsk: false,
          closeAction: closeChoice,
        })
        setState(value)
        desktop.setCloseBehavior({
          ask: false,
          action: closeChoice,
        })
      } catch {}
    }
    if (closeChoice === 'tray') {
      notify('幻屿已最小化到任务栏托盘，双击托盘图标可找回')
      void desktop.hide()
    } else {
      void desktop.quit()
    }
  }
  useEffect(() => {
    const syncMotion = () => { document.documentElement.dataset.ambientMotion = String((state?.settings.ambientMotion ?? true) && !document.hidden && !playing) }
    syncMotion()
    document.addEventListener('visibilitychange', syncMotion)
    return () => document.removeEventListener('visibilitychange', syncMotion)
  }, [state?.settings.ambientMotion, playing])
  async function changeAppearance(patch: AppearancePatch) {
    if (appearanceBusy) return
    setAppearanceBusy(true)
    try {
      setState(await api<AppState>('/settings', patch))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setAppearanceBusy(false)
    }
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  async function favorite(media: Media) {
    try {
      setState(
        await api<AppState>(
          `/media/${media.id}`,
          { favorite: !media.favorite },
          'PATCH',
        ),
      )
      notify(media.favorite ? '已从收藏中移除' : '已收藏，留给下一次相遇')
    } catch (e) {
      notify((e as Error).message)
    }
  }
  async function favoriteGame(game: Game) {
    try {
      setState(
        await api<AppState>(
          `/games/${game.id}`,
          { favorite: !game.favorite },
          'PATCH',
        ),
      )
      notify(game.favorite ? '已从收藏中移除' : '已收藏，随时开玩')
    } catch (e) {
      notify((e as Error).message)
    }
  }
  async function launchGame(game: Game) {
    if (launchingGame) return
    setLaunchingGame(game.id)
    try {
      setState(await api<AppState>(`/games/${game.id}/launch`, {}))
      notify(`已启动《${game.title}》，玩得开心！`)
    } catch (e) {
      notify((e as Error).message)
    } finally {
      setLaunchingGame(null)
    }
  }
  const media = state?.media || []
  const real = media.filter((m) => m.source !== 'sample')
  const visible = useMemo(() => {
    let items = media.filter((m) =>
      page === 'library'
        ? m.source !== 'sample'
        : page === 'favorites'
          ? m.favorite
          : page === 'history'
            ? latestProgress(m)
            : m.source !== 'sample' || state?.settings.showSamples,
    )
    if (query.trim())
      items = items.filter((m) =>
        `${m.title} ${m.subtitle || ''}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    if (page === 'anime' || page === 'movies')
      items = items.filter(
        (m) => categoryOf(m) === (page === 'movies' ? 'movie' : 'anime'),
      )
    if (genre !== '全部') items = items.filter((m) => m.genre === genre)
    if (source !== 'all') items = items.filter((m) => m.source === source)
    if (sort === 'title')
      items.sort((a, b) =>
        a.title.localeCompare(b.title, 'zh-CN', { numeric: true }),
      )
    else if (sort === 'rating')
      items.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    else if (page === 'history')
      items.sort((a, b) => latestProgress(b)![1].at - latestProgress(a)![1].at)
    else items.sort((a, b) => b.addedAt - a.addedAt)
    return items
  }, [media, page, query, genre, source, sort, state?.settings.showSamples])
  const detail = media.find((m) => m.id === selected)
  const playerMedia = media.find((m) => m.id === playing?.mediaId)
  const games = state?.games || []
  const gameDetail = games.find((g) => g.id === selectedGame)
  const gameGenreTabs = useMemo(
    () => [
      '全部',
      ...new Set(games.map((g) => g.genre).filter(Boolean) as string[]),
    ],
    [games],
  )
  const visibleGames = useMemo(() => {
    let items = [...games]
    const keyword = query.trim().toLowerCase()
    if (keyword)
      items = items.filter((g) =>
        `${g.title} ${g.description || ''}`
          .toLowerCase()
          .includes(keyword),
      )
    if (genre !== '全部') items = items.filter((g) => g.genre === genre)
    if (sort === 'title')
      items.sort((a, b) =>
        a.title.localeCompare(b.title, 'zh-CN', { numeric: true }),
      )
    else if (sort === 'played')
      items.sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    else
      items.sort(
        (a, b) => (b.lastPlayedAt || b.addedAt) - (a.lastPlayedAt || a.addedAt),
      )
    return items
  }, [games, query, genre, sort])
  const favoriteGames = useMemo(() => {
    const items = games.filter((g) => g.favorite)
    const keyword = query.trim().toLowerCase()
    if (keyword)
      return items.filter((g) =>
        `${g.title} ${g.description || ''}`
          .toLowerCase()
          .includes(keyword),
      )
    return items
  }, [games, query])
  // 弹窗打开期间停用顶栏拖动手柄，避免拖动区吞掉弹窗附近的点击。
  const modalOpen =
    Boolean(importing) ||
    Boolean(resourceTarget) ||
    Boolean(detail) ||
    Boolean(playing) ||
    Boolean(settings) ||
    Boolean(appearance) ||
    gameImporting ||
    Boolean(gameDetail)
  useEffect(() => {
    document.documentElement.dataset.modalOpen = String(modalOpen)
  }, [modalOpen])
  const nav = (newPage: Page) => {
    setPage(newPage)
    setQuery('')
    setGenre('全部')
    setSource('all')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return (
    <div className="app-shell">
      {state?.settings.skin === 'lunar' && <LunarAtmosphere />}
      {state?.settings.skin === 'aurora' && <AuroraAtmosphere />}
      {state?.settings.skin === 'custom' && (
        <div className="custom-atmosphere scene-atmosphere" aria-hidden="true">
          <div className="scene-landscape" />
          <div className="scene-tint" />
        </div>
      )}
      {state?.settings.skin === 'synth' && <SynthAtmosphere />}
      {state?.settings.skin === 'gilded' && <GildedAtmosphere />}
      {state?.settings.skin === 'ember' && <EmberAtmosphere />}
      {state?.settings.skin === 'grove' && <GroveAtmosphere />}
      {state?.settings.skin === 'glacier' && <GlacierAtmosphere />}
      <div className="main-shell">
        <header className="topbar">
          <a
            className="wordmark"
            href="#"
            aria-label="幻屿首页"
            onClick={(event) => {
              event.preventDefault()
              nav('home')
            }}
          >
            <svg className="brand-symbol" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="36" height="36" rx="11" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeOpacity=".6" />
              <path d="M16 11.5 29 19a1.15 1.15 0 0 1 0 2L16 28.5a1.15 1.15 0 0 1-1.7-1V12.5a1.15 1.15 0 0 1 1.7-1Z" fill="currentColor" />
              <path d="M9 30c4-3 7 3 11 0s7 2 11-1" stroke="currentColor" strokeOpacity=".65" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            幻屿<span>HUANYU</span>
          </a>
          <nav className="main-nav" aria-label="主导航">
          {(
            [
              { id: 'home', icon: LayoutGrid, label: '新番' },
              { id: 'anime', icon: Play, label: '动漫' },
              { id: 'movies', icon: Film, label: '电影' },
              { id: 'games', icon: Gamepad2, label: '游戏' },
              { id: 'favorites', icon: Heart, label: '收藏' },
              { id: 'history', icon: History, label: '最近观看' },
            ] as const
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => nav(id)}
              aria-current={page === id ? 'page' : undefined}
            >
              <span>
                <Icon
                  size={22}
                  strokeWidth={1.7}
                  fill={
                    id === 'favorites' && page === id ? 'currentColor' : 'none'
                  }
                />
              </span>
              <small>{label}</small>
            </button>
          ))}
        </nav>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                ref={search}
                placeholder="搜索你想看的故事"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="搜索作品"
              />
              {query ? (
                <button aria-label="清空搜索" onClick={() => setQuery('')}>
                  <X size={14} />
                </button>
              ) : (
                <kbd>Ctrl K</kbd>
              )}
            </label>
            <button
              type="button"
              className="appearance-trigger"
              aria-label="切换外观皮肤"
              title="切换外观皮肤"
              onClick={() => setAppearance(true)}
            >
              <Palette size={17} />
              <span>皮肤</span>
            </button>
            <IconButton label="设置" className="settings-trigger" onClick={() => setSettings(true)}>
              <Settings2 size={19} strokeWidth={1.7} />
            </IconButton>
            <span className="header-divider" />
            <div className="local-status">
              <span />
              本地运行
            </div>
            {isDesktop && !isMac && (
              <div className="window-controls">
                <button
                  type="button"
                  aria-label="最小化"
                  onClick={() => void window.yingyuDesktop?.minimize()}
                >
                  <Minus size={15} />
                </button>
                <button
                  type="button"
                  aria-label={isMaximized ? '向下还原' : '最大化'}
                  onClick={() => void window.yingyuDesktop?.toggleMaximize()}
                >
                  {isMaximized ? <Copy size={13} /> : <Square size={13} />}
                </button>
                <button
                  type="button"
                  className="window-close"
                  aria-label="关闭"
                  onClick={() => void window.yingyuDesktop?.close()}
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
        </header>
        <main className={page === 'home' ? 'home-main' : ''}>
          <div
            className={`page-heading ${page === 'home' ? 'seasonal-page-heading' : ''}`}
          >
            <div>
              <div className="page-eyebrow">
                <span className="tiny-spark">✳</span> A LITTLE ISLAND FOR YOUR
                STORIES
              </div>
              <h1>
                {pageNames[page]}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {page === 'home'
                  ? '这一季的相遇，从这里开始。浏览新番，发现资源，收藏喜欢的故事。'
                  : page === 'anime'
                    ? '连载与长篇，收进专属的动漫片库。'
                    : page === 'movies'
                      ? '为完整的一场光影，留一个专门的位置。'
                      : page === 'library'
                        ? `${real.length} 部作品，${real.reduce((n, m) => n + m.episodes.length, 0)} 个视频，都是你的珍藏。`
                        : page === 'games'
                          ? '把本机收藏的游戏排成一排，点击封面就能回到冒险。'
                          : page === 'favorites'
                            ? '那些舍不得散场的故事，值得再看一次。'
                            : '每一次暂停，都是下一次相遇的起点。'}
              </p>
            </div>
            <div className="import-menu-wrap">
              <button
                className="button primary import-main"
                onClick={() => setMenu(!menu)}
                aria-expanded={menu}
              >
                <Plus size={18} /> 导入资源 <ChevronDown size={15} />
              </button>
              {menu && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="收起导入菜单"
                    onClick={() => setMenu(false)}
                  />
                  <div className="import-menu">
                    <button
                      onClick={() => {
                        setImporting({ mode: 'local' })
                        setMenu(false)
                      }}
                    >
                      <FolderOpen size={18} />
                      <div>
                        <strong>导入本地视频</strong>
                        <span>从文件夹或文件开始</span>
                      </div>
                      <ChevronRight size={15} />
                    </button>
                    <button
                      onClick={() => {
                        setImporting({ mode: 'quark' })
                        setMenu(false)
                      }}
                    >
                      <Cloud size={18} />
                      <div>
                        <strong>导入夸克链接</strong>
                        <span>把云端资源带进片库</span>
                      </div>
                      <ChevronRight size={15} />
                    </button>
                    <button
                      onClick={() => {
                        setGameImporting(true)
                        setMenu(false)
                      }}
                    >
                      <Gamepad2 size={18} />
                      <div>
                        <strong>导入本地游戏</strong>
                        <span>exe 或快捷方式，点击即玩</span>
                      </div>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          {page === 'home' && (
            <NewSeasonPage
              skin={state?.settings.skin}
              query={query}
              onResource={setResourceTarget}
              media={media}
              onOpen={setSelected}
              onImport={(subject, mode) =>
                setImporting({ mode, preset: subject.title, subject })
              }
            />
          )}
          {page === 'games' && (
            <section className="library-section games-section">
              <div className="library-heading">
                <div className="section-title">
                  <h2>{query ? '搜索结果' : pageNames[page]}</h2>
                  <span className="count-label">
                    {visibleGames.length} 款游戏
                  </span>
                </div>
                <div className="view-controls">
                  <label className="sort-select">
                    <ArrowDownAZ size={15} />
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      aria-label="游戏排序"
                    >
                      <option value="default">最近游玩</option>
                      <option value="played">最常游玩</option>
                      <option value="title">名称排序</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  <span className="controls-divider" />
                  <button
                    className="button primary"
                    onClick={() => setGameImporting(true)}
                  >
                    <Plus size={17} /> 导入游戏
                  </button>
                </div>
              </div>
              {gameGenreTabs.length > 2 && (
                <div className="filter-bar">
                  <div className="genre-tabs">
                    {gameGenreTabs.map((item) => (
                      <button
                        className={genre === item ? 'active' : ''}
                        key={item}
                        onClick={() => setGenre(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!state ? (
                <div className="empty-state">
                  {loadError ? (
                    <>
                      <Cloud size={36} />
                      <h3>暂时连接不到本地服务</h3>
                      <p>{loadError}</p>
                      <button className="button primary" onClick={refresh}>
                        重新连接
                      </button>
                    </>
                  ) : (
                    <>
                      <LoaderCircle size={32} className="spin" />
                      <p>正在打开你的游戏空间…</p>
                    </>
                  )}
                </div>
              ) : visibleGames.length ? (
                <GamesPage
                  games={visibleGames}
                  launchingId={launchingGame}
                  onOpen={setSelectedGame}
                  onLaunch={launchGame}
                  onFavorite={favoriteGame}
                />
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">
                    {query || genre !== '全部' ? (
                      <Search size={31} />
                    ) : (
                      <Gamepad2 size={33} />
                    )}
                  </span>
                  <h3>
                    {query || genre !== '全部'
                      ? '这一次，还没有找到'
                      : '把游戏，也收进这座小岛'}
                  </h3>
                  <p>
                    {query || genre !== '全部'
                      ? '试试其他关键词，或切换游戏分类。'
                      : '导入本机的游戏程序或快捷方式，点击封面即可启动。'}
                  </p>
                  {query || genre !== '全部' ? (
                    <button
                      className="button outline"
                      onClick={() => {
                        setQuery('')
                        setGenre('全部')
                      }}
                    >
                      清除筛选
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => setGameImporting(true)}
                    >
                      <Plus size={17} />
                      导入第一款游戏
                    </button>
                  )}
                </div>
              )}
              <footer className="library-footer">
                <span>
                  <span className="footer-dot" />
                  游戏只记录启动路径，文件都留在原位。
                </span>
                <span>
                  READY PLAYER ONE <Gamepad2 size={13} />
                </span>
              </footer>
            </section>
          )}
          {page !== 'home' && page !== 'games' && (
            <section className="library-section">
              <div className="library-heading">
                <div className="section-title">
                  <h2>{query ? '搜索结果' : pageNames[page]}</h2>
                  <span className="count-label">{visible.length} 部作品</span>
                  {['anime', 'movies'].includes(page) &&
                    state?.settings.showSamples && (
                      <span className="sample-label">含示例片单</span>
                    )}
                </div>
                <div className="view-controls">
                  <label className="sort-select">
                    <ArrowDownAZ size={15} />
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      aria-label="作品排序"
                    >
                      <option value="default">最近添加</option>
                      <option value="title">名称排序</option>
                      <option value="rating">评分优先</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  <span className="controls-divider" />
                  <IconButton
                    label="海报视图"
                    className={layout === 'grid' ? 'selected' : ''}
                    onClick={() => setLayout('grid')}
                  >
                    <Grid2X2 size={17} />
                  </IconButton>
                  <IconButton
                    label="列表视图"
                    className={layout === 'list' ? 'selected' : ''}
                    onClick={() => setLayout('list')}
                  >
                    <List size={19} />
                  </IconButton>
                </div>
              </div>
              <div className="filter-bar">
                <div className="genre-tabs">
                  {genres
                    .filter((g) => g !== '电影')
                    .map((g) => (
                      <button
                        className={genre === g ? 'active' : ''}
                        key={g}
                        onClick={() => setGenre(g)}
                      >
                        {g}
                      </button>
                    ))}
                </div>
                <label className="source-select">
                  <span className={`source-dot ${source}`} />
                  <select
                    aria-label="资源来源"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="all">全部来源</option>
                    <option value="local">本地视频</option>
                    <option value="quark">夸克网盘</option>
                    {page !== 'library' && (
                      <option value="sample">示例片单</option>
                    )}
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              {!state ? (
                <div className="empty-state">
                  {loadError ? (
                    <>
                      <Cloud size={36} />
                      <h3>暂时连接不到本地服务</h3>
                      <p>{loadError}</p>
                      <button className="button primary" onClick={refresh}>
                        重新连接
                      </button>
                    </>
                  ) : (
                    <>
                      <LoaderCircle size={32} className="spin" />
                      <p>正在打开你的放映室…</p>
                    </>
                  )}
                </div>
              ) : visible.length ? (
                <div
                  className={`media-grid ${layout === 'list' ? 'list-view' : ''}`}
                >
                  {visible.map((m, i) => {
                    const progress = latestProgress(m)
                    return (
                      <article
                        className="media-card"
                        key={m.id}
                        style={
                          { '--card-index': Math.min(i, 8) } as CSSProperties
                        }
                      >
                        <div className="poster-wrap">
                          <button
                            className="poster-button"
                            aria-label={`查看${m.title}的分集和详情`}
                            onClick={() => setSelected(m.id)}
                          >
                            <Cover media={m} />
                            <div className="poster-shade" />
                            <span className="poster-source">
                              <SourceIcon source={m.source} />
                              {m.source === 'sample'
                                ? '片单'
                                : m.source === 'local'
                                  ? '本地'
                                  : '夸克'}
                            </span>
                            {m.rating && (
                              <span className="poster-rating">
                                ★ <strong>{m.rating}</strong>
                              </span>
                            )}
                            <span className="poster-play">
                              <Play
                                size={21}
                                fill="currentColor"
                                strokeWidth={1.5}
                              />
                            </span>
                            <span className="poster-bottom">
                              {m.source === 'sample'
                                ? `全 ${m.total} 集`
                                : `${m.episodes.length} 集`}
                              {m.source === 'sample' ? (
                                <span>作品预览</span>
                              ) : (
                                <span>
                                  点击选集 <ArrowRight size={13} />
                                </span>
                              )}
                            </span>
                            {progress && (
                              <span className="poster-progress">
                                <i
                                  style={{
                                    width: `${Math.min(100, (progress[1].time / progress[1].duration) * 100)}%`,
                                  }}
                                />
                              </span>
                            )}
                          </button>
                          <button
                            className={`poster-favorite ${m.favorite ? 'favorited' : ''}`}
                            aria-label={`${m.favorite ? '取消收藏' : '收藏'}${m.title}`}
                            onClick={() => favorite(m)}
                          >
                            <Heart
                              size={17}
                              fill={m.favorite ? 'currentColor' : 'none'}
                            />
                          </button>
                        </div>
                        <div className="card-copy">
                          <button
                            className="card-title"
                            onClick={() => setSelected(m.id)}
                          >
                            {m.title}
                          </button>
                          <div className="card-meta">
                            <span>
                              {m.year || '我的收藏'}
                              <i />
                              {m.genre || '未分类'}
                            </span>
                            <span className="card-status">
                              {['queued', 'loading'].includes(
                                m.metadataStatus || '',
                              )
                                ? 'AI 整理中…'
                                : m.source === 'sample'
                                  ? '已完结'
                                  : m.source === 'local'
                                    ? '本地收藏'
                                    : '云端资源'}
                            </span>
                          </div>
                          {layout === 'list' && (
                            <p className="list-description">
                              {m.description ||
                                `${m.episodes.length} 个视频 · ${sourceNames[m.source]}`}
                            </p>
                          )}
                        </div>
                        {layout === 'list' && (
                          <button
                            className="button list-detail outline"
                            onClick={() => setSelected(m.id)}
                          >
                            查看分集 <ArrowRight size={15} />
                          </button>
                        )}
                      </article>
                    )
                  })}
                </div>
              ) : page === 'favorites' && favoriteGames.length ? null : (
                <div className="empty-state">
                  <span className="empty-icon">
                    {query ? (
                      <Search size={31} />
                    ) : page === 'favorites' ? (
                      <Heart size={32} />
                    ) : page === 'history' ? (
                      <History size={33} />
                    ) : (
                      <FolderOpen size={33} />
                    )}
                  </span>
                  <h3>
                    {query || genre !== '全部' || source !== 'all'
                      ? '这一次，还没有找到'
                      : page === 'favorites'
                        ? '把喜欢的故事，留在这里'
                        : page === 'history'
                          ? '你的第一场放映，即将开始'
                          : '你的私人片库，等待第一个故事'}
                  </h3>
                  <p>
                    {query || genre !== '全部' || source !== 'all'
                      ? '试试其他关键词，或切换分类与资源来源。'
                      : '导入本地视频或夸克分享链接，让喜欢的故事有个家。'}
                  </p>
                  {query || genre !== '全部' || source !== 'all' ? (
                    <button
                      className="button outline"
                      onClick={() => {
                        setQuery('')
                        setGenre('全部')
                        setSource('all')
                      }}
                    >
                      清除筛选
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => setImporting({ mode: 'local' })}
                    >
                      <Plus size={17} />
                      导入我的第一部作品
                    </button>
                  )}
                </div>
              )}
              {page === 'favorites' && favoriteGames.length > 0 && (
                <section className="favorite-games-block">
                  <div className="favorite-games-heading">
                    <h3>收藏的游戏</h3>
                    <span className="count-label">
                      {favoriteGames.length} 款
                    </span>
                  </div>
                  <GamesPage
                    games={favoriteGames}
                    launchingId={launchingGame}
                    onOpen={setSelectedGame}
                    onLaunch={launchGame}
                    onFavorite={favoriteGame}
                  />
                </section>
              )}
              <footer className="library-footer">
                <span>
                  <span className="footer-dot" />
                  所有收藏与观看记录，都安静地留在本机。
                </span>
                <span>
                  MADE FOR YOUR LITTLE ESCAPES <Clapperboard size={13} />
                </span>
              </footer>
            </section>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={15} />
          </span>
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {resourceTarget && (
        <Dialog
          title="查找夸克资源"
          className="resource-dialog"
          onClose={() => {
            if (!resourceBusy) setResourceTarget(null)
          }}
        >
          <ResourceSearch
            subject={resourceTarget}
            onManualImport={() => {
              setImporting({
                mode: 'quark',
                preset: resourceTarget.title,
                subject: resourceTarget.replaceMediaId ? undefined : resourceTarget,
                replacement: state?.media.find(media => media.id === resourceTarget.replaceMediaId),
              })
              setResourceTarget(null)
            }}
            onWorking={setResourceBusy}
            onImported={(data, ids, count) => {
              setState(data)
              setResourceTarget(null)
              setSelected(ids[0] || null)
              nav(categoryOf(data.media.find(media => media.id === ids[0]) || ({} as Media)) === 'movie' ? 'movies' : 'anime')
              notify(resourceTarget.replaceMediaId ? `已替换为 ${count} 个视频，作品资料与收藏已保留` : `已将 ${count} 个视频导入动漫区`)
            }}
          />
        </Dialog>
      )}
      {importing && (
        <ImportDialog
          mode={importing.mode}
          preset={importing.preset}
          subject={importing.subject}
          replacement={importing.replacement}
          onSearch={(media) => {
            setImporting(null)
            setResourceTarget({id: media.subjectId || '', title: media.title, subtitle: '', description: media.description || '', image: media.cover || '', replaceMediaId: media.id})
          }}
          categoryPreset={
            importing.replacement ? categoryOf(importing.replacement) : importing.subject
              ? 'anime'
              : page === 'movies'
                ? 'movie'
                : page === 'anime'
                  ? 'anime'
                  : undefined
          }
          onClose={() => setImporting(null)}
          onImported={(data, ids, count) => {
            setState(data)
            setImporting(null)
            setSelected(ids.length === 1 ? ids[0] : null)
            setPage(
              categoryOf(
                data.media.find((m) => m.id === ids[0]) || ({} as Media),
              ) === 'movie'
                ? 'movies'
                : 'anime',
            )
            setGenre('全部')
            setSource('all')
            setQuery('')
            notify(importing.replacement ? `已替换为 ${count} 个视频，作品资料与收藏已保留` : `已整理 ${count} 个视频，好故事准备好了`)
          }}
        />
      )}
      {gameImporting && (
        <GameImportDialog
          onClose={() => setGameImporting(false)}
          onImported={(data, imported, failed) => {
            setState(data)
            setGameImporting(false)
            setPage('games')
            setQuery('')
            setGenre('全部')
            setSort('default')
            notify(
              failed
                ? `已导入 ${imported} 款游戏，${failed} 款未能导入`
                : `已收下 ${imported} 款游戏，随时开玩`,
            )
          }}
        />
      )}
      {gameDetail && !gameImporting && (
        <GameDetailDialog
          key={gameDetail.id}
          game={gameDetail}
          launching={launchingGame === gameDetail.id}
          onClose={() => setSelectedGame(null)}
          onLaunch={launchGame}
          onUpdate={setState}
          notify={notify}
        />
      )}
      {detail && !importing && !playing && !resourceTarget && (
        <DetailDialog
          key={detail.id}
          media={detail}
          onClose={() => setSelected(null)}
          onFavorite={() => favorite(detail)}
          onPlay={(episode) => setPlaying({ mediaId: detail.id, episode })}
          onImport={(mode) => setImporting({ mode, preset: detail.title })}
          onReplace={() => replaceResource(detail)}
          onUpdate={setState}
          notify={notify}
          deepseekConnected={Boolean(state?.settings.deepseekConnected)}
          onConfigureAI={() => {
            setSelected(null)
            setSettings(true)
          }}
        />
      )}
      {playing && playerMedia && (
        <Player
          media={playerMedia}
          initialEpisode={playing.episode}
          autoNext={state!.settings.autoNext}
          subtitlesEnabled={state!.settings.subtitlesEnabled}
          onSubtitlesEnabled={changeSubtitles}
          subtitleStyle={state!.settings.subtitleStyle}
          onSubtitleStyle={changeSubtitleStyle}
          onReplace={() => replaceResource(playerMedia)}
          onClose={() => {
            setPlaying(null)
            refresh()
          }}
          onProgress={refresh}
          notify={notify}
        />
      )}
      {settings && state && (
        <SettingsDialog
          state={state}
          onUpdate={setState}
          onClose={() => setSettings(false)}
          notify={notify}
          onAppearance={() => {
            setSettings(false)
            setAppearance(true)
          }}
        />
      )}
      {appearance && state && (
        <Dialog
          title="给故事，换一种氛围"
          onClose={() => setAppearance(false)}
          className="appearance-dialog"
        >
          <AppearancePicker
            settings={state.settings}
            onChange={changeAppearance}
            onClose={() => setAppearance(false)}
            busy={appearanceBusy}
          />
        </Dialog>
      )}
      {closeDialog && (
        <Dialog
          title="点击主界面关闭按钮时"
          onClose={() => setCloseDialog(false)}
          className="close-confirm-dialog"
        >
          <div className="close-confirm-body">
            <div className="close-confirm-options">
              <label className="close-confirm-option">
                <input
                  type="radio"
                  name="close-choice"
                  checked={closeChoice === 'tray'}
                  onChange={() => setCloseChoice('tray')}
                />
                最小化到任务栏托盘
              </label>
              <label className="close-confirm-option">
                <input
                  type="radio"
                  name="close-choice"
                  checked={closeChoice === 'exit'}
                  onChange={() => setCloseChoice('exit')}
                />
                退出幻屿
              </label>
            </div>
            <div className="close-confirm-divider" />
            <div className="close-confirm-footer">
              <label className="close-confirm-nomore">
                <input
                  type="checkbox"
                  checked={closeNoMore}
                  onChange={(e) => setCloseNoMore(e.target.checked)}
                />
                不再提示
              </label>
              <button
                className="button primary"
                onClick={() => void confirmClose()}
              >
                确定
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
