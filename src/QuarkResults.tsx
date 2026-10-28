import { ArrowUpRight, Cloud, LoaderCircle } from 'lucide-react'
import type { QuarkResource, QuarkSearchData } from './useQuarkSearch'

export default function QuarkResults({ data, importing = '', error = '', onImport }: {
  data: QuarkSearchData & { loading: boolean; searched: boolean; error: string }
  importing?: string; error?: string; onImport: (resource: QuarkResource) => void
}) {
  const offline = data.sources.length > 0 && data.sources.every(source => source.status === 'error')
  return <section className="quark-results-block" aria-label="夸克分享搜索结果" aria-live="polite">
    <div className="web-sources-head"><strong><Cloud size={16} /> 夸克网盘 · 公开分享</strong><span>优先显示资源标注的 4K / 1080P 合集，实际画质以文件为准；导入时验证分享，播放前确认转存。</span></div>
    {!!data.sources.length && <div className="resource-source-status">{data.sources.map(source => <a key={source.name} href={source.url} target="_blank" rel="noreferrer" title={source.message} className={source.status === 'error' ? 'source-unavailable' : ''}>{source.name}<span>{source.status === 'loading' ? '继续查找中…' : source.status === 'error' ? '暂不可用 ↗' : source.status==='external'?'打开网站搜索 ↗':`${source.count} 条线索 ↗`}</span></a>)}</div>}
    {(data.error || error) && <div className="form-error" role="alert">{error || data.error}</div>}
    {data.loading ? <div className="season-empty"><LoaderCircle size={24} className="spin" /><h3>正在查找夸克分享…</h3></div>
      : data.results.length ? <div className="resource-results quark-result-list">{data.results.map(resource => <article className="resource-result" key={resource.id}>
        <span className="resource-cloud"><Cloud size={21} /></span>
        <div><h4>{resource.title}</h4>{resource.qualityHint && <span className="quark-quality-hint">{resource.qualityHint}</span>}<p>{resource.description.replace(resource.title, '').slice(0, 220)}</p><span>{resource.sources?.join(' / ') || resource.source}{resource.updatedAt ? ` · ${resource.updatedAt.slice(0, 10)}` : ''}{resource.availability === 'ready' ? ' · 已读取到视频文件' : ''}</span><span className={`resource-match ${resource.match || 'related'}`}>{resource.match === 'season' ? '季数匹配' : resource.match === 'other-season' ? '其他季资源，请核对' : '请核对版本与季数'}</span><a className="text-button" href={resource.url} target="_blank" rel="noreferrer">查看分享 <ArrowUpRight size={12} /></a></div>
        <button className="button primary" disabled={!!importing} onClick={() => onImport(resource)}>{importing === resource.id ? <LoaderCircle size={15} className="spin" /> : <Cloud size={15} />} 导入此资源</button>
      </article>)}</div>
        : data.searched && !data.pending && !data.error ? <div className="online-no-results"><h3>{offline ? '搜索来源暂时不可用' : '暂未找到匹配的夸克分享'}</h3><p>{offline ? '可打开上方来源网站继续查找，或直接导入已有链接。' : '可尝试其他译名，或直接导入已有链接。'}</p></div> : null}
    {data.pending && !data.loading && <p className="quark-pending"><LoaderCircle size={13} className="spin" /> 仍有来源在查询或验证分享，新结果会自动补充。</p>}
  </section>
}
