import { useEffect, useState } from 'react'
import { Globe2, Plus, Trash2, LoaderCircle, ShieldCheck } from 'lucide-react'
import Dialog from './ui'
import { api } from './api'
import type { AppState } from './types'
import './resource-sites.css'

type Site = { id: string; name: string; type: 'quark' | 'vod' | 'web' | 'page'; url: string; enabled: boolean }
const labels = { quark: '夸克资源网页', vod: '影视采集接口', web: '网页搜索入口', page: '影视网站 · 页面取源' }
function Manager({ onClose }: { onClose: () => void }) {
  const [sites, setSites] = useState<Site[] | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [verifying, setVerifying] = useState('')
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [type, setType] = useState<Site['type']>('page')
  useEffect(() => {
    let active = true
    void api<{ sites: Site[] }>('/search-sites').then(value => { if (active) setSites(value.sites) })
      .catch(reason => { if (active) setError(reason.message) })
    return () => { active = false }
  }, [])
  function add() {
    setError(''); setNotice('')
    if (!name.trim() || !url.trim()) { setError('请填写网站名称和搜索地址'); return }
    if (['quark', 'web'].includes(type) && !url.includes('{query}')) { setError('请把搜索网址中的关键词替换为 {query}'); return }
    if ((sites?.length || 0) >= 12) { setError('最多添加 12 个网站'); return }
    if (sites?.some(site => site.url === url.trim() && site.type === type)) { setError('这个网站已经添加'); return }
    setSites(current => [...(current || []), { id: `draft-${Date.now()}`, name: name.trim(), url: url.trim(), type, enabled: true }])
    setName(''); setUrl('')
  }
  async function save() {
    if (!sites) return
    setBusy(true); setError(''); setNotice('')
    try {
      const value = await api<AppState>('/search-sites', { sites })
      setSites(value.settings.searchSites || [])
      setNotice('已保存，下次搜索将使用已启用的网站。')
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }
  async function verify(site: Site) {
    setVerifying(site.id); setError(''); setNotice('')
    try {
      await api(`/search-sites/${site.id}/verify`, {})
      setNotice('验证窗口已打开。请自行完成访问验证或登录，关闭该窗口后重新搜索。')
    } catch (reason) { setError((reason as Error).message) }
    finally { setVerifying('') }
  }
  return <Dialog title="管理搜索网站" onClose={onClose} className="search-sites-dialog">
    <p className="dialog-intro">添加你常用的网站，保存后会参与下一次影视资源搜索。</p>
    <div className="search-sites-list" aria-label="自定义搜索网站">
      {sites?.length ? sites.map(site => <article key={site.id}>
        <label><input type="checkbox" aria-label={`启用${site.name}`} checked={site.enabled} disabled={busy}
          onChange={event => { setNotice(''); setSites(items => items!.map(item => item.id === site.id ? { ...item, enabled: event.target.checked } : item)) }} />
          <span><strong>{site.name}</strong><small>{labels[site.type]}</small></span></label>
        <p>{site.url}</p>
        <div className="site-row-actions">
          {site.type === 'page' && <button type="button" className="site-verify" disabled={busy || !!verifying || site.id.startsWith('draft-')}
            title={site.id.startsWith('draft-') ? '请先保存网站设置' : '打开独立的网站验证窗口'} onClick={() => void verify(site)}>
            {verifying === site.id ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}验证 / 登录</button>}
          <button aria-label={`移除${site.name}`} type="button" disabled={busy}
            onClick={() => { setNotice(''); setSites(items => items!.filter(item => item.id !== site.id)) }}><Trash2 size={16} /></button>
        </div>
      </article>) : sites ? <div className="sites-empty"><Globe2 size={27} /><p>还没有添加网站，内置搜索来源仍然可用。</p></div>
        : <p><LoaderCircle className="spin" size={18} /> 正在读取网站设置…</p>}
    </div>
    <form className="search-site-form" onSubmit={event => { event.preventDefault(); add() }}>
      <h3><Plus size={16} /> 添加网站</h3>
      <div className="site-fields">
        <label>网站名称<input value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder="给这个来源起个名字" disabled={busy || !sites} /></label>
        <label>搜索方式<select aria-label="网站搜索方式" value={type} onChange={event => setType(event.target.value as Site['type'])} disabled={busy || !sites}>
          <option value="page">影视网站 · 读取页面播放器</option>
          <option value="vod">影视采集接口 · 自动搜索播放</option>
          <option value="quark">夸克资源网页 · 自动提取分享</option>
          <option value="web">网页搜索入口 · 打开网站查找</option>
        </select></label>
      </div>
      <label>{type === 'vod' ? 'JSON 采集接口地址' : type === 'page' ? '影视网站首页或搜索地址' : '搜索结果页地址'}
        <input aria-label="网站搜索地址" value={url} onChange={event => setUrl(event.target.value)} maxLength={1500}
          placeholder={type === 'page' ? 'https://ddys.app/' : type === 'vod' ? 'https://example.com/api.php/provide/vod/' : 'https://example.com/search?q={query}'} disabled={busy || !sites} />
      </label>
      <p>{type === 'page' ? '支持 DDYS 等页面播放列表，读取公开可用线路并校验播放。需要访问验证时，可先保存，再点击“验证 / 登录”自行处理；不支持的播放器会明确提示。'
        : type === 'vod' ? '支持兼容苹果 CMS / MacCMS 的 JSON 接口。继续核对片名、集数、画质和播放入口。'
          : type === 'quark' ? '用 {query} 代表搜索关键词。自动读取网页和作品详情中的公开夸克分享。'
            : '用 {query} 代表搜索关键词。显示网站搜索入口，点击后前往该站查看；此方式不自动导入片源。'}</p>
      <button className="button outline" type="submit" disabled={busy || !sites}><Plus size={15} />加入列表</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="sites-saved" role="status">{notice}</p>}
    <div className="dialog-footer"><span>{sites?.length || 0} / 12 个自定义网站</span>
      <button className="button primary" disabled={busy || !sites} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Globe2 size={16} />}保存网站设置</button></div>
  </Dialog>
}
export default function SearchSitesButton() {
  const [open, setOpen] = useState(false)
  return <><button className="search-sites-trigger" type="button" title="添加或管理资源搜索网站" onClick={() => setOpen(true)}><Globe2 size={15} /><span>搜索网站</span></button>
    {open && <Manager onClose={() => setOpen(false)} />}</>
}
