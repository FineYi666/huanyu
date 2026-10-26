import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  Check,
  CheckCheck,
  Moon,
  Sparkles,
  Sun,
  WandSparkles,
} from 'lucide-react'
import { api } from './api'
import { skins, getSkin } from './skins'
import type { AppSettings } from './types'

export type AppearancePatch = Partial<
  Pick<
    AppSettings,
    | 'skin'
    | 'theme'
    | 'glass'
    | 'ambientMotion'
    | 'customAccent'
    | 'customBase'
    | 'customDark'
  >
>

// 从导入的图片中提取强调色与明暗基调（高饱和像素加权均值并提亮）。
function extractPalette(img: HTMLImageElement): {
  accent: string
  base: string
  dark: boolean
} {
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const context = canvas.getContext('2d')
  if (!context) return { accent: '#7aa2f7', base: '#141a26', dark: true }
  context.drawImage(img, 0, 0, 48, 48)
  const { data } = context.getImageData(0, 0, 48, 48)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let samples = 0
  let accR = 0
  let accG = 0
  let accB = 0
  let accWeight = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 510
    if (lightness < 0.1 || lightness > 0.92) continue
    sumR += r
    sumG += g
    sumB += b
    samples++
    const saturation = max === 0 ? 0 : (max - min) / max
    if (saturation > 0.18) {
      accR += r * saturation
      accG += g * saturation
      accB += b * saturation
      accWeight += saturation
    }
  }
  const toHex = (values: number[]) =>
    '#' +
    values
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  let accent = '#7aa2f7'
  if (accWeight > 0) {
    const r = accR / accWeight
    const g = accG / accWeight
    const b = accB / accWeight
    const peak = Math.max(r, g, b)
    const boost = peak > 0 && peak < 205 ? 205 / peak : 1
    accent = toHex([r * boost, g * boost, b * boost])
  }
  const avgLightness = samples
    ? (sumR + sumG + sumB) / (3 * samples * 255)
    : 0.3
  // 底色：全图平均色（软件背景等整体染色跟随图片主色调）。
  const base = samples
    ? toHex([sumR / samples, sumG / samples, sumB / samples])
    : '#141a26'
  return { accent, base, dark: avgLightness < 0.55 }
}

export default function AppearancePicker({
  settings,
  onChange,
  onClose,
  busy,
}: {
  settings: AppSettings
  onChange: (patch: AppearancePatch) => void | Promise<void>
  onClose: () => void
  busy: boolean
}) {
  const choices = useRef<Array<HTMLButtonElement | null>>([])
  const [customBusy, setCustomBusy] = useState(false)
  const [customError, setCustomError] = useState('')
  async function importCustomBackground(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0]
    if (!image || customBusy) return
    setCustomBusy(true)
    setCustomError('')
    try {
      if (!/image\/(jpeg|png|webp)/.test(image.type))
        throw new Error('请选择 JPG、PNG 或 WebP 图片')
      if (image.size > 20 * 1024 * 1024)
        throw new Error('图片请控制在 20 MB 以内')
      const objectUrl = URL.createObjectURL(image)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('图片无法读取'))
        img.src = objectUrl
      })
      const palette = extractPalette(img)
      const scale = Math.min(1, 2560 / Math.max(img.width, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前环境不支持图片处理')
      context.drawImage(img, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
      URL.revokeObjectURL(objectUrl)
      await api<{ url: string }>('/skin-background', { image: dataUrl })
      await onChange({
        skin: 'custom',
        theme: palette.dark ? 'dark' : 'light',
        customAccent: palette.accent,
        customBase: palette.base,
        customDark: palette.dark,
      })
    } catch (error) {
      setCustomError((error as Error).message)
    } finally {
      setCustomBusy(false)
      event.target.value = ''
    }
  }
  function navigate(event: KeyboardEvent, index: number) {
    const direction = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 2,
      ArrowUp: -2,
    }[event.key]
    if (direction === undefined && event.key !== 'Home' && event.key !== 'End')
      return
    event.preventDefault()
    if (busy) return
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? skins.length - 1
          : (index + direction! + skins.length) % skins.length
    choices.current[next]?.focus()
    onChange({ skin: skins[next].id, theme: skins[next].defaultTheme })
  }
  return (
    <div className="appearance-picker">
      <div className="appearance-intro">
        <span className="appearance-spark">
          <WandSparkles size={19} />
        </span>
        <p>
          不同的氛围，同一个属于你的放映室。
          <br />
          <span>点选即刻应用，下一次打开依然是你喜欢的样子。</span>
        </p>
        <span className="skin-count">{String(skins.length).padStart(2, '0')} SKINS</span>
      </div>
      <div className="skin-grid" role="radiogroup" aria-label="页面皮肤">
        {skins.map((skin, index) => (
          <button
            key={skin.id}
            type="button"
            role="radio"
            aria-checked={settings.skin === skin.id}
            aria-label={skin.name}
            tabIndex={settings.skin === skin.id ? 0 : -1}
            ref={(element) => {
              choices.current[index] = element
            }}
            className={`skin-choice ${settings.skin === skin.id ? 'active' : ''}`}
            onClick={() => {
              if (!busy && settings.skin !== skin.id)
                onChange({ skin: skin.id, theme: skin.defaultTheme })
            }}
            onKeyDown={(event) => navigate(event, index)}
            aria-disabled={busy}
          >
            <div
              className="skin-preview"
              data-preview-skin={skin.id}
              data-preview-theme={settings.skin === skin.id ? settings.theme : skin.defaultTheme}
              aria-hidden="true"
            >
              <div className="mini-page">
                <div className="mini-topbar">
                  <b>映屿</b>
                  <span />
                  <i />
                </div>
                <div className="mini-title">
                  <i />
                  <span />
                </div>
                <div className="mini-hero">
                  <img
                    src={
                      skin.id === 'synth' ? '/artwork/skins/synthwave-city.png'
                        : skin.id === 'glacier' ? '/artwork/skins/winter-alpine.png'
                        : skin.id === 'gilded' ? '/artwork/skins/gilded-waves.jpg'
                        : skin.id === 'ember' ? '/artwork/skins/ember-crimson-city.jpg'
                        : skin.id === 'grove' ? '/artwork/skins/grove-pearl-dunes.jpg'
                        : skin.id === 'lunar' ? '/artwork/skins/lunar-jade-ink.jpg'
                        : skin.id === 'aurora' ? '/artwork/skins/aurora-bluegold-nebula.jpg'
                        : skin.id === 'custom' ? `/skin-background?v=${encodeURIComponent(settings.customBackgroundVersion || '')}`
                    : '/artwork/hero-howls.jpg'
                    }
                    alt=""
                    loading="lazy"
                    onLoad={(event) => { event.currentTarget.style.opacity = '1' }}
                    onError={(event) => {
                      event.currentTarget.style.opacity = '0'
                    }}
                  />
                  <div>
                    <i />
                    <i />
                    <span />
                  </div>
                  <b>{skin.english}</b>
                </div>
                <div className="mini-filters">
                  <i />
                  <i />
                  <i />
                  <span />
                </div>
                <div className="mini-posters">
                  {['frieren', 'apothecary', 'bocchi', 'violet'].map(
                    (poster) => (
                      <span key={poster}>
                        <img
                          src={`/artwork/${poster}.jpg`}
                          alt=""
                          loading="lazy"
                        />
                        <i />
                      </span>
                    ),
                  )}
                </div>
              </div>
              <span className="skin-preview-badge">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
            <div className="skin-choice-copy">
              <div>
                <h3>{skin.name}</h3>
                <span className="skin-english">{skin.english}</span>
              </div>
              <span className="skin-selected" aria-hidden="true">
                {settings.skin === skin.id ? (
                  <Check size={13} />
                ) : (
                  <span className="skin-swatches">
                    {skin.colors.map((color) => (
                      <i key={color} style={{ background: color }} />
                    ))}
                  </span>
                )}
              </span>
            </div>
            <p className="skin-description">{skin.description}</p>
          </button>
        ))}
      </div>
      <div className="custom-skin-import">
        <div>
          <strong>自定义幻境 · 导入专属背景</strong>
          <p>
            选择一张你喜欢的图片（JPG / PNG / WebP，自动压缩与取色），
            即可生成与内置皮肤同等效果的专属主题。
          </p>
          {customError && <p className="custom-skin-error">{customError}</p>}
        </div>
        <label className="button primary custom-import-button">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={importCustomBackground}
            disabled={customBusy || busy}
          />
          {customBusy ? '正在生成…' : '导入背景图'}
        </label>
      </div>
      <div className="appearance-options">
        <div className="appearance-option">
          <div>
            <strong>
              <Sun size={15} /> 放映室光线
            </strong>
            <p>每套皮肤都支持明亮与深邃两种氛围</p>
          </div>
          <div className="appearance-mode" role="group" aria-label="界面明暗">
            <button
              aria-pressed={settings.theme === 'light'}
              disabled={busy}
              onClick={() => onChange({ theme: 'light' })}
            >
              <Sun size={14} />
              明亮
            </button>
            <button
              aria-pressed={settings.theme === 'dark'}
              disabled={busy}
              onClick={() => onChange({ theme: 'dark' })}
            >
              <Moon size={14} />
              深邃
            </button>
          </div>
        </div>
        <div className="appearance-option">
          <div>
            <strong>
              <Sparkles size={15} /> 液态玻璃按钮
            </strong>
            <p>让操作浮在光影之上，透光、反射、轻柔回应</p>
          </div>
          <button
            type="button"
            className={`switch ${settings.glass ? 'on' : ''}`}
            role="switch"
            aria-label="液态玻璃效果"
            aria-checked={settings.glass}
            disabled={busy}
            onClick={() => onChange({ glass: !settings.glass })}
          >
            <i />
          </button>
        </div>
        <div className="appearance-option">
          <div><strong><WandSparkles size={15} /> 动态背景</strong><p>飘雪、薄雾与霓虹光线；播放视频时自动暂停</p></div>
          <button type="button" className={`switch ${settings.ambientMotion ? 'on' : ''}`} role="switch" aria-label="动态背景" aria-checked={settings.ambientMotion} disabled={busy} onClick={() => onChange({ ambientMotion: !settings.ambientMotion })}><i /></button>
        </div>
      </div>
      <div className="appearance-footer">
        <span>
          <CheckCheck size={14} />
          {busy ? '正在保存外观…' : `已保存 · ${getSkin(settings.skin).name}`}
        </span>
        <button type="button" className="button primary" onClick={onClose}>
          就用这个样子 <Check size={15} />
        </button>
      </div>
    </div>
  )
}
