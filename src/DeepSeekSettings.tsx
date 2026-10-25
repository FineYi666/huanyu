import { useState } from 'react'
import {
  ArrowUpRight,
  BrainCircuit,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { api } from './api'
import type { AppState } from './types'

export default function DeepSeekSettings({
  state,
  onUpdate,
  notify,
}: {
  state: AppState
  onUpdate: (data: AppState) => void
  notify: (message: string) => void
}) {
  const [key, setKey] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connected = state.settings.deepseekConnected
  const missing = state.media.filter(
    (media) =>
      media.source !== 'sample' && (!media.cover || !media.description),
  ).length
  async function connect() {
    setBusy(true)
    setError('')
    try {
      onUpdate(await api<AppState>('/deepseek/connect', { apiKey: key }))
      setKey('')
      notify('DeepSeek 已绑定，新导入的作品将按设置自动整理')
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function setting(patch: object) {
    try {
      onUpdate(await api<AppState>('/settings', patch))
    } catch (error) {
      notify((error as Error).message)
    }
  }
  async function enrichAll() {
    setBusy(true)
    setError('')
    try {
      const data = await api<AppState & { queued: number }>(
        '/metadata/enrich',
        { all: true },
      )
      onUpdate(data)
      notify(
        data.queued
          ? `已安排 ${data.queued} 部作品补全，整理完成后自动更新`
          : '现有作品的封面和简介已经齐全',
      )
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="deepseek-section" aria-label="DeepSeek 资料管家">
      <h3 className="settings-section">
        智能资料管家
        <span className={`connection-state ${connected ? 'connected' : ''}`}>
          {connected ? '已绑定' : '未绑定'}
        </span>
      </h3>
      <div className="deepseek-heading">
        <span className="deepseek-icon">
          <BrainCircuit size={25} strokeWidth={1.5} />
        </span>
        <div>
          <strong>
            DeepSeek <span>让每一部作品，都有自己的样子</span>
          </strong>
          <p>识别作品、整理简介，再从作品库匹配真实海报。</p>
        </div>
        <a
          className="text-button"
          href="https://platform.deepseek.com/api_keys"
          target="_blank"
          rel="noreferrer"
        >
          获取 Key <ArrowUpRight size={13} />
        </a>
      </div>
      <label className="field">
        DeepSeek API Key
        <div className="key-input-wrap">
          <input
            type={visible ? 'text' : 'password'}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={
              connected
                ? '已绑定。输入新 Key 可更换账号'
                : '输入你的 sk-… API Key'
            }
            autoComplete="new-password"
            spellCheck={false}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={visible ? '隐藏 API Key' : '显示 API Key'}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </label>
      <p className="small-note">
        <ShieldCheck size={14} />
        Key 使用当前 Windows 账号加密保存在本机，不包含在媒体库导出中。
      </p>
      {(error || state.settings.deepseekStorageError) && (
        <div className="form-error" role="alert">
          {error || state.settings.deepseekStorageError}
        </div>
      )}
      <div className="deepseek-connect-actions">
        {connected && (
          <button
            type="button"
            className="button subtle"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                onUpdate(await api<AppState>('/deepseek/disconnect', {}))
                notify('已解绑并移除本机保存的 DeepSeek Key')
              } catch (error) {
                setError((error as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            解绑
          </button>
        )}
        <button
          type="button"
          className="button primary"
          disabled={busy || !key.trim()}
          onClick={connect}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : connected ? (
            <Check size={15} />
          ) : (
            <KeyRound size={15} />
          )}
          {busy ? '正在连接…' : connected ? '更新绑定' : '验证并绑定'}
        </button>
      </div>
      <div className="deepseek-preferences">
        <div className="setting-row">
          <div>
            <strong>导入后自动补全资料</strong>
            <p>本地视频、夸克资源均适用，在后台整理</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={state.settings.deepseekAuto}
            aria-label="导入后自动补全资料"
            className={`switch ${state.settings.deepseekAuto ? 'on' : ''}`}
            onClick={() =>
              setting({ deepseekAuto: !state.settings.deepseekAuto })
            }
          >
            <i />
          </button>
        </div>
        {connected && (
          <label className="deepseek-model">
            <span>使用模型</span>
            <select
              aria-label="DeepSeek 模型"
              value={state.settings.deepseekModel}
              onChange={(event) =>
                setting({ deepseekModel: event.target.value })
              }
            >
              {[
                ...new Set([
                  state.settings.deepseekModel,
                  ...state.settings.deepseekModels,
                ]),
              ].map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="deepseek-existing">
        <div>
          <strong>已经收藏的故事，也值得有封面</strong>
          <p>
            {missing
              ? `${missing} 部作品还缺少封面或简介`
              : '当前片库资料已齐全'}
          </p>
        </div>
        <button
          type="button"
          className="button outline"
          disabled={!connected || !missing || busy}
          onClick={enrichAll}
        >
          <Sparkles size={14} />
          补全已有作品
        </button>
      </div>
      <p className="deepseek-privacy">
        仅发送作品名与最多 3
        个分集文件名，不发送完整本地路径、网盘链接或视频内容。识别使用你的
        DeepSeek API 额度；海报匹配来自 Bangumi 等公开作品资料源。
      </p>
    </section>
  )
}
