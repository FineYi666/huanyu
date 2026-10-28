import { useCallback, useEffect, useRef, useState } from 'react'

export type QuarkResource = {
  id: string; title: string; description: string; url: string; code: string
  source: string; sources?: string[]; sourceUrl?: string; updatedAt?: string
  match?: 'season' | 'related' | 'other-season'; qualityHint?: string
  availability?: 'ready' | 'unknown'
}
export type QuarkSearchData = {
  results: QuarkResource[]
  sources: { name: string; url: string; status: string; count: number; message?: string }[]
  queries: string[]; pending?: boolean
}
const empty: QuarkSearchData = { results: [], sources: [], queries: [] }
export default function useQuarkSearch() {
  const [data, setData] = useState(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const search = useCallback(async (query: string, subjectId?: string) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true); setError(''); setData(empty); setSearched(false)
    const started = Date.now()
    let first = true
    try {
      while (!controller.signal.aborted) {
        const response = await fetch('/api/resources/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, subjectId, refresh: first }), signal: controller.signal,
        })
        const value = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) throw new Error(value.error || '夸克资源搜索暂时不可用')
        setData(value); setLoading(false); setSearched(true)
        if (!value.pending) return
        if (Date.now() - started > 85000) { setData(current => ({...current,pending:false})); setError('部分来源查询较慢，已保留当前结果，可稍后重搜或打开来源网站。'); return }
        first = false
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, 1000)
          controller.signal.addEventListener('abort', done, { once: true })
        })
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])
  return { ...data, loading, error, searched, search }
}
