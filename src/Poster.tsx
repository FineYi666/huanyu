import { useEffect, useState } from 'react'
import { Film } from 'lucide-react'

export default function Poster({ src, title, className = '', eager = false }: { src?: string; title: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return <span className={`poster-art ${className} ${failed || !src ? 'poster-unavailable' : ''}`}>
    {src && !failed ? <img src={src} alt={title ? `${title}海报` : ''} loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> :
      <span className="poster-placeholder" role="img" aria-label={`${title}，海报暂不可用`}><Film size={26} strokeWidth={1} /><strong>{title}</strong><small>映屿 · 等待故事上映</small></span>}
  </span>
}
