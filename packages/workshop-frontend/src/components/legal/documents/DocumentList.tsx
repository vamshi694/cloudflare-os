import type { LegalDocument } from '@gadgets/workshop-shared/legal'
import { Trash } from '@phosphor-icons/react'
import { Pill, StatusDot } from '../primitives'
import { docLabel, formatBytes, plural, shortDate, tidy } from '../labels'
import { documentTitle } from './FirmRead'

export type FilterKey = 'all' | 'ready' | 'reading' | 'unread' | 'relevance' | 'aside'

/**
 * THREE DIFFERENT THINGS, THREE DIFFERENT NAMES. "The firm is BLOCKED and needs you" (couldn't
 * read), "the firm has a QUESTION" (check relevance) and "nothing here, FYI" (empty) are never one
 * pill: a number that is always a third of the record becomes wallpaper.
 */
export const FILTERS: { key: FilterKey; label: string; test: (d: LegalDocument) => boolean }[] = [
  { key: 'all', label: 'Total', test: (d) => d.status !== 'superseded' && d.relevance !== 'excluded' },
  { key: 'ready', label: 'Ready', test: (d) => d.status === 'ready' && d.relevance === 'included' },
  { key: 'reading', label: 'Reading', test: (d) => d.status === 'queued' || d.status === 'reading' },
  { key: 'unread', label: "Couldn't read", test: (d) => d.status === 'failed' },
  { key: 'relevance', label: 'Check relevance', test: (d) => d.relevance === 'check' && d.status !== 'superseded' },
  { key: 'aside', label: 'Set aside', test: (d) => d.relevance === 'excluded' || d.status === 'superseded' },
]

export function FilterPills({
  docs,
  value,
  onChange,
}: {
  docs: LegalDocument[]
  value: FilterKey
  onChange: (k: FilterKey) => void
}) {
  const older = docs.filter((d) => d.status === 'superseded').length
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FILTERS.map((f) => {
        const n = docs.filter(f.test).length
        // A category at zero renders nothing unless the lawyer is standing on it.
        if (n === 0 && value !== f.key) return null
        const active = value === f.key
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            className={`press inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors ${
              active ? 'shadow-depth border-kumo-ring bg-kumo-base font-medium text-kumo-default' : 'border-kumo-line text-kumo-subtle hover:text-kumo-default'
            }`}
          >
            {f.label}
            <span className="tnum text-[12px] text-kumo-inactive">{n}</span>
          </button>
        )
      })}
      {older > 0 && (
        <span className="tnum ml-1 text-[12px] text-kumo-subtle">+{older} older {older === 1 ? 'copy' : 'copies'}</span>
      )}
    </div>
  )
}

export type SortKey = 'title' | 'bytes' | 'at'

const GRID = 'grid grid-cols-[minmax(0,1fr)_90px_56px_36px] sm:grid-cols-[minmax(0,1fr)_110px_64px_130px_40px] md:grid-cols-[minmax(0,1fr)_140px_120px_72px_130px_40px] items-center gap-3'

function StatusCell({ doc, onRetry }: { doc: LegalDocument; onRetry: () => void }) {
  if (doc.status === 'queued' || doc.status === 'reading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-kumo-default">
        <StatusDot tone="working" className="breathe" /> Reading…
      </span>
    )
  }
  if (doc.status === 'failed') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRetry()
        }}
        className="press inline-flex cursor-pointer items-center gap-1 text-[12.5px] font-medium text-kumo-danger hover:underline"
      >
        Couldn't read · Retry
      </button>
    )
  }
  if (doc.status === 'empty') return <span className="text-[12.5px] text-kumo-warning">no readable text</span>
  if (doc.status === 'superseded') return <span className="text-[12.5px] text-kumo-inactive">older copy</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-kumo-subtle">
      <StatusDot tone="ready" /> Ready
    </span>
  )
}

export function DocumentGrid({
  docs,
  sort,
  onSort,
  evidenceOf,
  onOpen,
  onRetry,
  onRemove,
}: {
  docs: LegalDocument[]
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
  evidenceOf: (doc: LegalDocument) => string[] | null
  onOpen: (doc: LegalDocument) => void
  onRetry: (doc: LegalDocument) => void
  onRemove: (doc: LegalDocument) => void
}) {
  const arrow = (k: SortKey) => (sort.key === k ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '')
  const Head = ({ k, children, className = '' }: { k?: SortKey; children: React.ReactNode; className?: string }) =>
    k ? (
      <button type="button" onClick={() => onSort(k)} className={`cursor-pointer text-left text-[11.5px] font-semibold uppercase tracking-[0.08em] text-kumo-subtle hover:text-kumo-default ${className}`}>
        {children}
        {arrow(k)}
      </button>
    ) : (
      <span className={`text-[11.5px] font-semibold uppercase tracking-[0.08em] text-kumo-subtle ${className}`}>{children}</span>
    )

  return (
    <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
      <div className={`${GRID} border-b border-kumo-line bg-kumo-tint/40 px-5 py-2`}>
        <Head k="title">Document</Head>
        <Head className="hidden md:inline">Evidence</Head>
        <Head>Status</Head>
        <Head k="bytes">Size</Head>
        <Head k="at" className="hidden sm:inline">Uploaded</Head>
        <span />
      </div>
      <ul className="m-0 list-none divide-y divide-kumo-line p-0">
        {docs.map((doc) => {
          const ev = evidenceOf(doc)
          const read = doc.status === 'ready' || doc.status === 'empty'
          return (
            <li
              key={doc.id}
              onClick={() => onOpen(doc)}
              className={`group ${GRID} cursor-pointer px-5 py-3 transition-colors hover:bg-kumo-tint/40 ${doc.relevance === 'excluded' || doc.status === 'superseded' ? 'opacity-60' : ''}`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">{documentTitle(doc)}</span>
                  {doc.relevance === 'check' && <Pill tone="warning">Off-matter?</Pill>}
                </div>
                <div className="mt-0.5">
                  {read && doc.docType ? <Pill>{docLabel(doc.docType)}</Pill> : !read ? <Pill>Not read yet</Pill> : null}
                </div>
              </div>
              <div className="hidden min-w-0 md:block">
                {ev === null ? (
                  <span className="text-[12px] text-kumo-inactive">…</span>
                ) : ev.length === 0 ? (
                  <span className="text-[12.5px] text-kumo-inactive">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {ev.slice(0, 2).map((c) => (
                      <Pill key={c} tone="ready">{tidy(c)}</Pill>
                    ))}
                    {ev.length > 2 && <span className="tnum text-[11.5px] text-kumo-inactive">+{ev.length - 2}</span>}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <StatusCell doc={doc} onRetry={() => onRetry(doc)} />
              </div>
              <span className="tnum text-[12.5px] text-kumo-subtle">{formatBytes(doc.bytes)}</span>
              <span className="hidden text-[12.5px] text-kumo-subtle sm:block">
                {tidy(doc.uploadedBy)} · {shortDate(doc.uploadedAt)}
              </span>
              <button
                type="button"
                aria-label="Remove document"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(doc)
                }}
                className="press inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-kumo-inactive opacity-60 transition-opacity hover:bg-kumo-tint hover:text-kumo-danger group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
              >
                <Trash size={14} />
              </button>
            </li>
          )
        })}
      </ul>
      {docs.length > 0 && (
        <p className="tnum m-0 border-t border-kumo-line px-5 py-2 text-[12px] text-kumo-inactive">{plural(docs.length, 'document', 'documents')}</p>
      )}
    </div>
  )
}

/** The set-aside panel: documents out of the live record, each with its why. */
export function SetAsidePanel({
  docs,
  onRestore,
  busy,
}: {
  docs: LegalDocument[]
  onRestore: (doc: LegalDocument) => void
  busy: Set<string>
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
      <p className="m-0 border-b border-kumo-line px-5 py-3 text-[12.5px] leading-[18px] text-kumo-subtle">
        Documents out of the live record, each with its why. Excluded documents were removed under rulings you approved and can be restored; older copies are version history.
      </p>
      <ul className="m-0 list-none divide-y divide-kumo-line p-0">
        {docs.map((doc) => {
          const older = doc.status === 'superseded'
          return (
            <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[13.5px] font-medium text-kumo-default">{documentTitle(doc)}</p>
                <p className="m-0 text-[12.5px] text-kumo-subtle">{doc.note ?? (older ? 'An older copy of a document on the record.' : 'Set aside by you.')}</p>
              </div>
              {older ? <Pill>Older copy</Pill> : <Pill tone="needsYou">Excluded</Pill>}
              {!older && (
                <button
                  type="button"
                  disabled={busy.has(doc.id)}
                  onClick={() => onRestore(doc)}
                  className="press inline-flex h-7 cursor-pointer items-center rounded-md px-2 text-[12.5px] font-medium text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default disabled:opacity-50"
                >
                  Restore
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
