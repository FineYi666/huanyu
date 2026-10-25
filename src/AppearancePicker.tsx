import { useRef, type KeyboardEvent } from 'react'
import {
  Check,
  CheckCheck,
  Moon,
  Sparkles,
  Sun,
  WandSparkles,
} from 'lucide-react'
import { skins, getSkin } from './skins'
import type { AppSettings } from './types'

export type AppearancePatch = Partial<
  Pick<AppSettings, 'skin' | 'theme' | 'glass' | 'ambientMotion'>
>

export default function AppearancePicker({
  settings,
  onChange,
  onClose,
  busy,
}: {
  settings: AppSettings
  onChange: (patch: AppearancePatch) => void
  onClose: () => void
  busy: boolean
}) {
  const choices = useRef<Array<HTMLButtonElement | null>>([])
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
                        : '/artwork/hero-howls.jpg'
                    }
                    alt=""
                    loading="lazy"
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
