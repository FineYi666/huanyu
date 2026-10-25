import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  ChevronRight,
  Computer,
  Film,
  Folder,
  Gamepad2,
  HardDrive,
  LoaderCircle,
  Search,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react'

type Entry = { name: string; path: string; directory: boolean; kind: string }
type Listing = {
  current: string
  parent: string | null
  locations: { name: string; path: string; kind: string }[]
  entries: Entry[]
  total: number
  truncated: boolean
}

export default function LocalPicker({
  mode = 'files',
  kind = 'video',
  initialPath,
  onCancel,
  onSelect,
}: {
  mode?: 'folder' | 'files'
  kind?: 'video' | 'game'
  initialPath: string
  onCancel: () => void
  onSelect: (paths: string[]) => void
}) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [address, setAddress] = useState(initialPath)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const isGame = kind === 'game'
  async function navigate(directory: string) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const currentRequest = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/files/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: directory, kind }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '暂时无法打开此文件夹')
      if (currentRequest === sequence.current) {
        setListing(data)
        setAddress(data.current)
        setQuery('')
      }
    } catch (error) {
      if (!controller.signal.aborted && currentRequest === sequence.current)
        setError(
          (error as Error).name === 'TimeoutError'
            ? '打开文件夹超时，请检查磁盘连接后重试'
            : (error as Error).message,
        )
    } finally {
      if (currentRequest === sequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    void navigate(initialPath)
    return () => {
      sequence.current++
      request.current?.abort()
    }
  }, [])
  const visible = (listing?.entries || []).filter((entry) =>
    entry.name.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const toggle = (file: string) =>
    setSelected((files) =>
      files.includes(file)
        ? files.filter((item) => item !== file)
        : [...files, file],
    )
  const breadcrumbs = listing?.current
    ? listing.current.split(/[\\/]/).filter(Boolean)
    : []
  return (
    <section
      className="local-picker"
      aria-label={isGame ? '选择本地游戏' : mode === 'folder' ? '选择本地文件夹' : '选择本地视频文件'}
    >
      <div className="local-picker-header">
        <div>
          <span className="eyebrow">YOUR LOCAL COLLECTION</span>
          <h2>{isGame ? '选择要导入的游戏' : mode === 'folder' ? '选择影片所在的文件夹' : '选择想收藏的视频'}</h2>
          <p>
            {isGame
              ? '浏览文件夹，勾选一个或多个游戏程序（.exe / .lnk）。'
              : mode === 'folder'
                ? '打开文件夹，确认后将自动整理其中的分集。'
                : '浏览文件夹，勾选一个或多个视频。'}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="返回导入表单"
          onClick={onCancel}
        >
          <X size={19} />
        </button>
      </div>
      <form
        className="local-picker-address"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate(address)
        }}
      >
        <button
          className="icon-button"
          type="button"
          aria-label="返回上一级文件夹"
          disabled={loading || !listing?.current}
          onClick={() => navigate(listing?.parent || '')}
        >
          <ArrowLeft size={17} />
        </button>
        <label>
          <Folder size={15} />
          <input
            aria-label="浏览文件夹路径"
            placeholder="本机，或粘贴完整文件夹路径"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <button className="button outline" type="submit" disabled={loading}>
          前往 <ArrowRight size={14} />
        </button>
      </form>
      <div className="local-picker-layout">
        <nav className="local-picker-locations" aria-label="磁盘与常用位置">
          <button
            type="button"
            className={!listing?.current ? 'active' : ''}
            onClick={() => navigate('')}
          >
            <Computer size={16} />
            <span>本机</span>
          </button>
          {listing?.locations.map((location) => (
            <button
              type="button"
              key={location.path}
              title={location.path}
              className={listing.current === location.path ? 'active' : ''}
              onClick={() => navigate(location.path)}
            >
              {location.kind === 'drive' ? (
                <HardDrive size={16} />
              ) : (
                <Folder size={16} />
              )}
              <span>{location.name}</span>
            </button>
          ))}
        </nav>
        <div className="local-picker-main">
          <div className="local-picker-breadcrumb">
            <span>{breadcrumbs.length ? breadcrumbs.join(' / ') : '本机'}</span>
            <label>
              <Search size={13} />
              <input
                aria-label="筛选当前文件夹"
                placeholder="筛选"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
              <button
                type="button"
                className="text-button"
                onClick={() => navigate('')}
              >
                返回本机
              </button>
            </div>
          )}
          <div className="local-picker-entries" aria-busy={loading}>
            {loading ? (
              <div className="local-picker-empty" role="status">
                <LoaderCircle size={26} className="spin" />
                <p>正在读取文件夹…</p>
              </div>
            ) : visible.length ? (
              visible.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  title={entry.path}
                  className={`local-picker-entry ${selected.includes(entry.path) ? 'selected' : ''} ${!entry.directory && mode === 'folder' ? 'preview-only' : ''}`}
                  disabled={!entry.directory && mode === 'folder'}
                  aria-pressed={
                    entry.directory || mode === 'folder'
                      ? undefined
                      : selected.includes(entry.path)
                  }
                  onClick={() =>
                    entry.directory ? navigate(entry.path) : toggle(entry.path)
                  }
                >
                  {entry.directory ? (
                    entry.kind === 'drive' ? (
                      <HardDrive size={21} />
                    ) : (
                      <Folder size={21} />
                    )
                  ) : isGame ? (
                    <Gamepad2 size={20} />
                  ) : (
                    <Film size={20} />
                  )}
                  <span>
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.directory
                        ? entry.kind === 'drive'
                          ? '打开磁盘'
                          : '打开文件夹'
                        : isGame
                          ? '游戏程序'
                          : '视频文件'}
                    </small>
                  </span>
                  {entry.directory ? (
                    <ChevronRight size={15} />
                  ) : mode === 'files' ? (
                    selected.includes(entry.path) ? (
                      <CheckSquare size={18} />
                    ) : (
                      <Square size={18} />
                    )
                  ) : null}
                </button>
              ))
            ) : (
              <div className="local-picker-empty">
                <Folder size={29} strokeWidth={1.3} />
                <p>
                  {query
                    ? isGame
                      ? '没有匹配的游戏或文件夹'
                      : '没有匹配的文件夹或视频'
                    : isGame
                      ? '这里没有游戏程序或子文件夹'
                      : '这里没有子文件夹或视频'}
                </p>
                {mode === 'folder' && listing?.current && (
                  <small>仍可选择此文件夹，导入时会继续查找子目录。</small>
                )}
              </div>
            )}
          </div>
          {listing?.truncated && (
            <p className="local-picker-limit">
              项目较多，仅显示前 3000 项，可输入更具体的文件夹路径。
            </p>
          )}
        </div>
      </div>
      <div className="local-picker-footer">
        <div>
          <ShieldCheck size={14} />
          <span>
            {mode === 'folder'
              ? listing?.current || '请选择一个磁盘或文件夹'
              : selected.length
                ? `已选择 ${selected.length} 个${isGame ? '游戏' : '视频'}`
                : isGame
                  ? '尚未选择游戏'
                  : '尚未选择视频'}
            <small>
              {isGame
                ? '仅记录启动路径，游戏不会被复制或修改'
                : '仅选择路径，视频保留在原位置'}
            </small>
          </span>
        </div>
        <div>
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={
              loading ||
              Boolean(error) ||
              (mode === 'folder' ? !listing?.current : !selected.length)
            }
            onClick={() =>
              onSelect(mode === 'folder' ? [listing!.current] : selected)
            }
          >
            <Check size={15} />
            {mode === 'folder'
              ? '选择此文件夹'
              : isGame
                ? `选择游戏${selected.length ? ` (${selected.length})` : ''}`
                : `选择视频${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        </div>
      </div>
    </section>
  )
}
