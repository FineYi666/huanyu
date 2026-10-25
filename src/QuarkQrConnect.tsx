import { useEffect, useRef, useState } from 'react'
import {
  CheckCheck,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import qrcode from './vendor/qrcode.mjs'
import { api } from './api'
import type { AppState } from './types'

type Session = { sessionId: string; qrUrl: string; expiresAt: number }
export default function QuarkQrConnect({
  connected,
  onUpdate,
  notify,
}: {
  connected: boolean
  onUpdate: (state: AppState) => void
  notify: (message: string) => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [qrImage, setQrImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<
    'waiting' | 'expired' | 'connected' | 'error'
  >('waiting')
  const [error, setError] = useState('')
  const active = useRef<string | null>(null)
  const generation = useRef(0)
  async function start() {
    const current = ++generation.current
    setBusy(true)
    setError('')
    setStatus('waiting')
    if (active.current)
      void api('/quark/qr/cancel', { sessionId: active.current }).catch(
        () => {},
      )
    active.current = null
    setSession(null)
    try {
      const next = await api<Session>('/quark/qr/start', {})
      if (current !== generation.current) {
        void api('/quark/qr/cancel', { sessionId: next.sessionId }).catch(
          () => {},
        )
        return
      }
      const code = qrcode(0, 'M')
      code.addData(next.qrUrl)
      code.make()
      setQrImage(
        'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(
            code.createSvgTag({ cellSize: 4, margin: 16, scalable: true }),
          ),
      )
      active.current = next.sessionId
      setSession(next)
    } catch (error) {
      if (current === generation.current) {
        setError((error as Error).message)
        setStatus('error')
      }
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  function cancel() {
    generation.current++
    if (active.current)
      void api('/quark/qr/cancel', { sessionId: active.current }).catch(
        () => {},
      )
    active.current = null
    setSession(null)
    setBusy(false)
    setError('')
  }
  useEffect(
    () => () => {
      generation.current++
      if (active.current)
        void api('/quark/qr/cancel', { sessionId: active.current }).catch(
          () => {},
        )
    },
    [],
  )
  useEffect(() => {
    if (!session || status !== 'waiting') return
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>
    async function poll() {
      if (Date.now() >= session!.expiresAt) {
        setStatus('expired')
        return
      }
      try {
        const result = await api<AppState & { status: string }>(
          '/quark/qr/status',
          { sessionId: session!.sessionId },
        )
        if (cancelled) return
        if (result.status === 'connected') {
          active.current = null
          setStatus('connected')
          onUpdate(result)
          notify('夸克扫码连接成功，登录信息已交由本机服务保管')
          return
        }
        if (result.status === 'expired' || result.status === 'cancelled') {
          setStatus('expired')
          return
        }
      } catch (error) {
        if (!cancelled) {
          setError((error as Error).message)
          setStatus('error')
        }
        return
      }
      if (!cancelled) timer = setTimeout(poll, 2200)
    }
    timer = setTimeout(poll, 2200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [session, status, onUpdate, notify])
  return (
    <div className="quark-qr-connect">
      <div className="quark-qr-intro">
        <span>
          <QrCode size={21} />
        </span>
        <div>
          <strong>扫码连接，让云端就位</strong>
          <p>使用夸克 App 扫码，在手机上确认登录。</p>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={start}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <QrCode size={15} />
          )}
          {busy ? '正在生成…' : connected ? '扫码更换账号' : '扫码连接'}
        </button>
      </div>
      {(session || error) && (
        <div className="quark-qr-panel">
          <button
            type="button"
            className="icon-button quark-qr-close"
            aria-label="关闭扫码连接"
            onClick={cancel}
          >
            <X size={16} />
          </button>
          {status === 'connected' ? (
            <div className="quark-qr-result">
              <CheckCheck size={33} />
              <strong>连接成功</strong>
              <p>现在可以在映屿中使用你的夸克资源。</p>
            </div>
          ) : (
            <>
              <div
                className={`quark-qr-image ${status !== 'waiting' ? 'inactive' : ''}`}
              >
                {qrImage && (
                  <img src={qrImage} alt="使用夸克 App 扫码连接映屿" />
                )}
                {status !== 'waiting' && (
                  <span>
                    {status === 'expired' ? '二维码已过期' : '连接未完成'}
                  </span>
                )}
              </div>
              <div className="quark-qr-caption">
                <strong>
                  {status === 'waiting'
                    ? '请扫码，并在手机上确认登录'
                    : error || '请刷新二维码后重试'}
                </strong>
                <p>确认的是你自己的夸克账号；二维码约 5 分钟有效。</p>
                {status !== 'waiting' && (
                  <button type="button" className="text-button" onClick={start}>
                    <RefreshCw size={13} />
                    重新生成二维码
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <p className="quark-qr-privacy">
        <ShieldCheck size={12} />
        二维码在本机生成，登录信息由 Windows
        加密保存在本机，重启后自动恢复，不显示、不导出。
      </p>
    </div>
  )
}
