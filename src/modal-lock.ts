const locks = new Set<symbol>()
let restore: (() => void) | undefined

export function lockPageScroll() {
  const token = Symbol()
  if (!locks.size) {
    const root = document.documentElement, body = document.body
    const overflow = [root.style.overflow, body.style.overflow]
    const gutter = root.style.scrollbarGutter
    const modal = root.dataset.modalOpen
    root.style.scrollbarGutter = 'stable'
    root.style.overflow = body.style.overflow = 'hidden'
    root.dataset.modalOpen = 'true'
    restore = () => {
      root.style.overflow = overflow[0]
      body.style.overflow = overflow[1]
      root.style.scrollbarGutter = gutter
      if (modal === undefined) delete root.dataset.modalOpen
      else root.dataset.modalOpen = modal
    }
  }
  locks.add(token)
  return () => {
    if (locks.delete(token) && !locks.size) {
      restore?.()
      restore = undefined
    }
  }
}
