import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { WorkshopIconButton } from '../../WorkshopControls'

/**
 * A portaled right-hand panel over a scrim. Esc and the scrim close it. Used for the plan, filing
 * history and the RFE read: surfaces that sit beside the work rather than interrupting it.
 */
export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  width = 420,
  actions,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  width?: number
  actions?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[1100] flex justify-end" role="presentation">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="slide-over shadow-lift relative flex h-full w-full flex-col border-l border-kumo-line bg-kumo-base"
        style={{ maxWidth: width }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-kumo-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">{title}</h2>
            {subtitle && (
              <p className="mt-1 mb-0 text-[12.5px] leading-[18px] tracking-[-0.2px] text-kumo-subtle">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <WorkshopIconButton className="!h-7 !w-7" onClick={onClose} aria-label="Close">
              <X size={15} />
            </WorkshopIconButton>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}
