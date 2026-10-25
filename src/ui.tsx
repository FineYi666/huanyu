import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function IconButton({
  children,
  label,
  onClick,
  className = '',
}: {
  children: ReactNode
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function Dialog({
  children,
  title,
  onClose,
  className = '',
  hideHeader = false,
  eyebrow = 'YOUR PRIVATE CINEMA',
}: {
  children: ReactNode
  title: string
  onClose: () => void
  className?: string
  hideHeader?: boolean
  eyebrow?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const initialClose = useRef(onClose)
  initialClose.current = onClose
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const close = (event: Event) => {
      event.preventDefault()
      initialClose.current()
    }
    element.addEventListener('cancel', close)
    return () => {
      element.removeEventListener('cancel', close)
      element.close()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className={`dialog ${className}`}
      aria-label={title}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const r = dialog.current.getBoundingClientRect()
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose()
        }
      }}
    >
      <div className="dialog-content">
        {!hideHeader && (
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">{eyebrow}</span>
              <h2>{title}</h2>
            </div>
            <IconButton label="关闭" onClick={onClose}>
              <X size={21} />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </dialog>
  )
}
