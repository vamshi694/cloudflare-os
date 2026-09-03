import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DownloadSimple, File, Printer, X } from '@phosphor-icons/react'
import { WorkshopIconButton } from '../../WorkshopControls'

export type Citation = { section: string; sentence: string }

/**
 * A citation click opens the cited exhibit HERE, over the letter: never a lost browser tab. Chrome:
 * a doc-tab strip up top, labeled actions right, the document itself center on the native PDF
 * surface, and a right rail: every passage of the letter that leans on this exhibit, verbatim,
 * under its section. Esc or the scrim closes; the letter is exactly where it was.
 */
export function DocViewer({
  name,
  exhibitNo,
  src,
  mime,
  text,
  citations,
  aside,
  page,
  onClose,
}: {
  name: string
  exhibitNo?: number | null
  /** A URL for the original file (pdf/image); when absent, `text` is shown. */
  src?: string | null
  mime?: string
  text?: string | null
  citations?: Citation[]
  /** A caller-supplied rail (the Documents tab passes the firm's read). */
  aside?: ReactNode
  /** Open a PDF at this page (the review grid lands on the page an answer cites). */
  page?: number | null
  onClose: () => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isImage = !!mime && mime.startsWith('image/')
  const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name)

  const print = () => {
    try {
      frame.current?.contentWindow?.print()
    } catch {
      if (src) window.open(src, '_blank', 'noopener')
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1100] bg-black/40 p-3 sm:p-8" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onClick={(e) => e.stopPropagation()}
        className="shadow-lift rise mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-[14px] bg-kumo-base"
      >
        <div className="flex items-end justify-between px-3 pt-2">
          <div className="flex items-center gap-1.5 rounded-t-[9px] border border-b-0 border-kumo-line bg-kumo-base px-3 py-1.5 text-[12.5px] text-kumo-default">
            <File size={13} className="text-kumo-subtle" />
            <span className="max-w-[40ch] truncate">{name}</span>
          </div>
          <WorkshopIconButton className="!h-7 !w-7" onClick={onClose} aria-label="Close">
            <X size={15} />
          </WorkshopIconButton>
        </div>
        <div className="flex items-center justify-between gap-3 border-y border-kumo-line px-4 py-2">
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-kumo-default">
            {exhibitNo != null && (
              <span className="tnum rounded-full bg-kumo-tint px-2 py-0.5 text-[12px] font-medium">Exhibit {exhibitNo}</span>
            )}
            <span className="truncate">{name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {src && (
              <a
                href={src}
                download={name}
                className="press inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
              >
                <DownloadSimple size={14} /> Download file
              </a>
            )}
            <button
              type="button"
              onClick={print}
              className="press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
            >
              <Printer size={14} /> Print
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 bg-[#525659]">
            {src && isPdf ? (
              <iframe ref={frame} title={name} src={`${src}#${page ? `page=${page}&` : ''}view=FitH`} className="h-full w-full border-0" />
            ) : src && isImage ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <img src={src} alt={name} className="max-h-full max-w-full" />
              </div>
            ) : text != null ? (
              <pre className="m-0 h-full overflow-auto bg-kumo-base p-6 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-kumo-default">
                {text.trim() === '' ? 'No parsed text.' : text}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-white/80">
                Preview not available for this file type. Use Download file.
              </div>
            )}
          </div>
          <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-kumo-line bg-kumo-base md:block">
            {aside ?? <CitationsRail citations={citations ?? []} />}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CitationsRail({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return (
      <div className="px-4 py-4">
        <p className="docket m-0">Citations</p>
        <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">
          The letter does not cite this exhibit yet.
        </p>
      </div>
    )
  }
  return (
    <div className="px-4 py-4">
      <p className="docket m-0">Citations in the letter</p>
      <ol className="m-0 mt-3 list-none space-y-4 p-0">
        {citations.map((c, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="tnum mt-0.5 shrink-0 text-[11.5px] text-kumo-inactive">{i + 1}</span>
            <div className="min-w-0">
              <p className="m-0 text-[12.5px] leading-[19px] text-kumo-default">{c.sentence}</p>
              <p className="m-0 mt-1 text-[11.5px] uppercase tracking-[0.06em] text-kumo-inactive">{c.section}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
