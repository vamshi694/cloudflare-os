import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import type { RpcStub } from 'capnweb'
import type { LegalDocument, MatterDesk } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../rpcErrors'
import { WorkshopButton, WorkshopInputArea } from '../WorkshopControls'
import {
  EmptyLine,
  FieldLabel,
  LegalDialog,
  Notice,
  Pill,
  Skeleton,
  StatusDot,
  ThreeState,
  formatDate,
  plural,
  tidy,
} from './primitives'
import { UploadPanel, useUploads } from './uploads'

const POLL_MS = 5000

const isBusy = (doc: LegalDocument) => doc.status === 'queued' || doc.status === 'reading'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The document's name as the lawyer knows it. */
export function documentTitle(doc: LegalDocument): string {
  return doc.displayTitle?.trim() || doc.filename
}

/**
 * THE DOCUMENTS SURFACE — what each document is and where the firm's reading of it stands. Quiet
 * when a document is ready; only the exceptions speak. Older copies are hidden behind one count.
 */
export function DocumentsTab({
  desk,
  onChanged,
}: {
  desk: RpcStub<MatterDesk>
  onChanged?: () => void
}) {
  const toasts = useKumoToastManager()
  const [docs, setDocs] = useState<LegalDocument[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reader, setReader] = useState<LegalDocument | null>(null)
  const [relevanceTarget, setRelevanceTarget] = useState<{
    doc: LegalDocument
    next: 'included' | 'excluded'
  } | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const list = await desk.documents({ includeSuperseded: true })
      setDocs(list)
      setFailed(false)
    } catch (err) {
      logRpcFailure("Failed to load the matter's documents:", err)
      setFailed(true)
    }
  }, [desk])

  const uploads = useUploads(desk, () => {
    void load()
    onChanged?.()
  })

  useEffect(() => {
    void load()
  }, [load])

  // Poll while the firm is reading anything (or an upload is still in flight).
  const anyBusy = (docs?.some(isBusy) ?? false) || uploads.rows.some((r) => r.phase === 'uploading')
  useEffect(() => {
    if (!anyBusy) return
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [anyBusy, load])

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })

  const handleReread = async (doc: LegalDocument) => {
    markBusy(doc.id, true)
    try {
      await desk.reread(doc.id)
      await load()
      onChanged?.()
    } catch (err) {
      logRpcFailure('Failed to re-read the document:', err)
      toasts.add({
        title: `"${documentTitle(doc)}" was not re-read. Its facts are unchanged — try again.`,
        variant: 'error',
      })
    } finally {
      markBusy(doc.id, false)
    }
  }

  const handleRelevance = async (reason: string) => {
    if (!relevanceTarget) return
    const { doc, next } = relevanceTarget
    markBusy(doc.id, true)
    try {
      await desk.setRelevance(doc.id, next, reason)
      setRelevanceTarget(null)
      await load()
      onChanged?.()
    } catch (err) {
      logRpcFailure("Failed to change the document's standing:", err)
      toasts.add({
        title:
          next === 'excluded'
            ? `"${documentTitle(doc)}" was not set aside. It is still in the record — try again.`
            : `"${documentTitle(doc)}" was not restored. It is still set aside — try again.`,
        variant: 'error',
      })
    } finally {
      markBusy(doc.id, false)
    }
  }

  const live = docs?.filter((d) => d.status !== 'superseded') ?? null
  const hiddenCopies = docs?.filter((d) => d.status === 'superseded').length ?? 0
  const uploadedIds = new Set(docs?.map((d) => d.id) ?? [])
  const pendingRows = uploads.rows.filter((r) => !(r.documentId && uploadedIds.has(r.documentId)))

  return (
    <div className="space-y-5">
      <UploadPanel rows={pendingRows} onFiles={uploads.add} onDismiss={uploads.dismiss} />

      <ThreeState
        items={live}
        failed={failed}
        skeleton={
          <div className="space-y-2">
            <Skeleton className="h-[60px]" />
            <Skeleton className="h-[60px]" />
            <Skeleton className="h-[60px]" />
          </div>
        }
        neverLoaded={{
          title: "We could not load this matter's documents just now.",
          body: 'This is a display problem, not a change to the record. Nothing has been lost. Reload to try again.',
        }}
        stale="Not updating right now — showing the last view that loaded."
        empty={
          <EmptyLine
            title="No documents yet."
            body="Upload one above. The firm reads each document as it lands and draws the evidence from it."
          />
        }
      >
        {(items) => (
          <div>
            <ul className="m-0 list-none divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line bg-kumo-base p-0">
              {items.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  busy={busyIds.has(doc.id)}
                  onRead={() => setReader(doc)}
                  onReread={() => void handleReread(doc)}
                  onSetAside={() => setRelevanceTarget({ doc, next: 'excluded' })}
                  onRestore={() => setRelevanceTarget({ doc, next: 'included' })}
                />
              ))}
            </ul>
            {hiddenCopies > 0 && (
              <p className="mt-2 px-1 text-[12px] leading-4 tracking-[-0.1px] text-kumo-subtle">
                {plural(hiddenCopies, 'older copy hidden', 'older copies hidden')}
              </p>
            )}
          </div>
        )}
      </ThreeState>

      {reader && <ReadTextDialog desk={desk} doc={reader} onClose={() => setReader(null)} />}

      {relevanceTarget && (
        <RelevanceDialog
          doc={relevanceTarget.doc}
          next={relevanceTarget.next}
          busy={busyIds.has(relevanceTarget.doc.id)}
          onCancel={() => setRelevanceTarget(null)}
          onConfirm={handleRelevance}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function DocumentStatus({ doc }: { doc: LegalDocument }) {
  switch (doc.status) {
    case 'queued':
    case 'reading':
      return (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-kumo-default">
          <StatusDot tone="working" />
          Reading…
        </span>
      )
    case 'empty':
      return <span className="text-[12.5px] text-kumo-warning">No readable text</span>
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-kumo-warning">
          <StatusDot tone="paused" />
          Couldn't read this copy
        </span>
      )
    default:
      // Quiet means good: a ready document shows nothing here.
      return null
  }
}

function DocumentRow({
  doc,
  busy,
  onRead,
  onReread,
  onSetAside,
  onRestore,
}: {
  doc: LegalDocument
  busy: boolean
  onRead: () => void
  onReread: () => void
  onSetAside: () => void
  onRestore: () => void
}) {
  const setAside = doc.relevance === 'excluded'
  const canRead = doc.status === 'ready'
  return (
    <li className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${setAside ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">
            {documentTitle(doc)}
          </span>
          {doc.docType && doc.status === 'ready' && <Pill>{tidy(doc.docType)}</Pill>}
          {setAside && <Pill>Set aside</Pill>}
          {doc.relevance === 'check' && !setAside && <Pill tone="warning">Check relevance</Pill>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-4 tracking-[-0.2px] text-kumo-subtle">
          <DocumentStatus doc={doc} />
          {doc.status === 'ready' && (
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {plural(doc.factCount, 'fact', 'facts')}
            </span>
          )}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {tidy(doc.uploadedBy)} · {formatDate(doc.uploadedAt)} · {formatBytes(doc.bytes)}
          </span>
        </div>
        {doc.status === 'failed' && doc.note && (
          <p className="mt-1 text-[12.5px] leading-[18px] tracking-[-0.2px] text-kumo-warning">
            {doc.note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canRead && <RowAction onClick={onRead} disabled={busy}>Read text</RowAction>}
        <RowAction onClick={onReread} disabled={busy || isBusy(doc)}>
          {busy ? 'Working…' : 'Re-read'}
        </RowAction>
        {setAside ? (
          <RowAction onClick={onRestore} disabled={busy}>Restore</RowAction>
        ) : (
          <RowAction onClick={onSetAside} disabled={busy}>Set aside</RowAction>
        )}
      </div>
    </li>
  )
}

function RowAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="press inline-flex h-7 cursor-pointer items-center rounded-md px-2 text-[12.5px] font-medium tracking-[-0.2px] text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------

function ReadTextDialog({
  desk,
  doc,
  onClose,
}: {
  desk: RpcStub<MatterDesk>
  doc: LegalDocument
  onClose: () => void
}) {
  const [text, setText] = useState<{ text: string; pageCount: number | null } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    desk
      .documentText(doc.id)
      .then((result) => {
        if (!cancelled) setText(result)
      })
      .catch((err) => {
        logRpcFailure("Failed to read the document's text:", err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [desk, doc.id])

  const pages = text?.pageCount ?? doc.pageCount
  return (
    <LegalDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="lg"
      title={documentTitle(doc)}
      description={
        pages ? `The text the firm read — ${plural(pages, 'page', 'pages')}.` : 'The text the firm read.'
      }
    >
      {failed ? (
        <Notice
          title="The text couldn't be read just now."
          body="The document is unchanged — this is a display problem. Close and try again."
        />
      ) : text === null ? (
        <p className="m-0 text-[13px] text-kumo-subtle">Reading the text…</p>
      ) : text.text.trim() === '' ? (
        <p className="m-0 text-[13px] text-kumo-subtle">No readable text in this copy.</p>
      ) : (
        <pre className="m-0 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-kumo-default">
          {text.text}
        </pre>
      )}
    </LegalDialog>
  )
}

// ---------------------------------------------------------------------------

function RelevanceDialog({
  doc,
  next,
  busy,
  onCancel,
  onConfirm,
}: {
  doc: LegalDocument
  next: 'included' | 'excluded'
  busy: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const settingAside = next === 'excluded'
  return (
    <LegalDialog
      open
      busy={busy}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={settingAside ? 'Set this document aside?' : 'Restore this document?'}
      description={
        settingAside
          ? `"${documentTitle(doc)}" stays on the matter but stops counting as evidence. The firm re-checks the case without it. You can restore it any time.`
          : `"${documentTitle(doc)}" goes back into the record and its facts count as evidence again. The firm re-checks the case against it.`
      }
      footer={
        <>
          <WorkshopButton className="!h-9" onClick={onCancel} disabled={busy}>
            Cancel
          </WorkshopButton>
          <WorkshopButton
            tone="primary"
            className="!h-9"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || reason.trim() === ''}
          >
            {busy ? 'Working…' : settingAside ? 'Set aside' : 'Restore'}
          </WorkshopButton>
        </>
      }
    >
      <FieldLabel hint="The firm records your reason on the matter and plans from it.">
        Why
      </FieldLabel>
      <WorkshopInputArea
        value={reason}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
        rows={3}
        placeholder={settingAside ? 'e.g. Belongs to a different matter.' : 'e.g. It was set aside by mistake.'}
        className="w-full"
      />
    </LegalDialog>
  )
}
