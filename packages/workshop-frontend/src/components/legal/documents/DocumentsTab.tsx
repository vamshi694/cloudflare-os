import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { LegalDocument, MatterDesk, Readiness } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { ArrowsClockwise, GoogleDriveLogo, MagnifyingGlass } from '@phosphor-icons/react'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton, WorkshopInput, WorkshopInputArea } from '../../WorkshopControls'
import { EmptyLine, FieldLabel, LegalDialog, Notice, Skeleton } from '../primitives'
import { useDeskData } from '../useMatterDesk'
import { DocViewer } from '../ui/DocViewer'
import { ConfirmModal } from '../ui/ConfirmModal'
import { Dropzone, UploadButton, UploadRows, useUploads } from '../uploads'
import { DocumentGrid, FILTERS, FilterPills, SetAsidePanel, type FilterKey, type SortKey } from './DocumentList'
import { ByEvidence } from './ByEvidence'
import { DocumentDetail } from './DocumentDetail'
import { FirmRead, documentTitle } from './FirmRead'
import { useDossiers } from './useDossiers'
import { DrivePanel } from './DrivePanel'
import { readingReceipt } from './receipt'
import { StatusDot } from '../primitives'

const isBusy = (doc: LegalDocument) => doc.status === 'queued' || doc.status === 'reading'

/**
 * THE DOCUMENTS SURFACE — consumable first, heavy on demand. Default is a clean scannable list
 * (what each document IS and how the firm will use it); "By evidence" re-buckets the same docs
 * under the visa criteria they support. The rendered file loads ONLY on preview.
 */
export function DocumentsTab({ desk, onChanged }: { desk: RpcStub<MatterDesk>; onChanged: () => void }) {
  const toasts = useKumoToastManager()
  const loadDocs = useCallback(() => desk.documents({ includeSuperseded: true }), [desk])
  const [pollMs, setPollMs] = useState(15000)
  const { data: docs, failed, reload } = useDeskData<LegalDocument[]>(loadDocs, { pollMs })
  const loadReadiness = useCallback(() => desk.readiness(), [desk])
  const readiness = useDeskData<Readiness>(loadReadiness, { pollMs: 30000 })
  const dossiers = useDossiers(desk)

  const [view, setView] = useState<'list' | 'evidence'>('list')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'at', dir: 'desc' })
  const [detailId, setDetailId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ doc: LegalDocument; url: string | null; text: string | null } | null>(null)
  const [removing, setRemoving] = useState<LegalDocument | null>(null)
  const [ruling, setRuling] = useState<{ doc: LegalDocument; next: 'included' | 'excluded' } | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [driveOpen, setDriveOpen] = useState(false)

  const uploads = useUploads(desk, () => {
    reload()
    onChanged()
  })

  const anyBusy = (docs?.some(isBusy) ?? false) || uploads.rows.some((r) => r.phase === 'uploading')
  useEffect(() => setPollMs(anyBusy ? 5000 : 15000), [anyBusy])
  // The receipt reads the record on every poll; the clock in it advances with the 5s refresh.
  const receipt = useMemo(() => (docs ? readingReceipt(docs) : null), [docs])

  // The evidence column reads the dossier of every document the firm has read.
  useEffect(() => {
    if (!docs) return
    dossiers.ensure(docs.filter((d) => d.status === 'ready').map((d) => d.id))
  }, [docs, dossiers])

  const markBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })

  const reread = async (doc: LegalDocument) => {
    markBusy(doc.id, true)
    try {
      await desk.reread(doc.id)
      reload()
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to re-read the document:', err)
      toasts.add({ title: `"${documentTitle(doc)}" was not re-read. Its facts are unchanged — try again.`, variant: 'error' })
    } finally {
      markBusy(doc.id, false)
    }
  }

  const rereadAll = async () => {
    const targets = (docs ?? []).filter((d) => d.status === 'failed' || d.status === 'empty')
    if (targets.length === 0) {
      toasts.add({ title: 'Every document on the record has been read.', variant: 'success' })
      return
    }
    await Promise.all(targets.map(reread))
  }

  const rule = async (doc: LegalDocument, next: 'included' | 'excluded', reason: string) => {
    markBusy(doc.id, true)
    try {
      await desk.setRelevance(doc.id, next, reason)
      dossiers.invalidate(doc.id)
      setRuling(null)
      reload()
      onChanged()
      if (next === 'included' && doc.relevance === 'excluded') {
        toasts.add({ title: `"${documentTitle(doc)}" is back in the record — its facts count as evidence again, and the firm will re-check the case against it.`, variant: 'success' })
      }
    } catch (err) {
      logRpcFailure("Failed to change the document's standing:", err)
      toasts.add({
        title: next === 'excluded' ? `"${documentTitle(doc)}" was not set aside. It is still in the record — try again.` : `We could not restore "${documentTitle(doc)}" to the record. It is still set aside. Please try again.`,
        variant: 'error',
      })
    } finally {
      markBusy(doc.id, false)
    }
  }

  const openViewer = async (doc: LegalDocument) => {
    const isFile = doc.mime === 'application/pdf' || doc.mime.startsWith('image/')
    setViewer({ doc, url: null, text: null })
    try {
      if (isFile) setViewer({ doc, url: await desk.fileUrl(doc.id), text: null })
      else setViewer({ doc, url: null, text: (await desk.documentText(doc.id)).text })
    } catch (err) {
      logRpcFailure('Failed to open the document:', err)
      setViewer({ doc, url: null, text: 'The document could not be fetched just now. It is unchanged — close and try again.' })
    }
  }

  const criteria = useMemo(() => (readiness.data?.sections ?? []).map((s) => ({ key: s.key, title: s.title })), [readiness.data])
  const evidenceOf = useCallback(
    (doc: LegalDocument): string[] | null => {
      if (doc.status !== 'ready') return []
      const s = dossiers.get(doc.id)
      if (s.kind === 'loading') return null
      return s.kind === 'ready' && s.dossier ? s.dossier.evidenceFor : []
    },
    [dossiers],
  )

  const visible = useMemo(() => {
    if (!docs) return []
    const f = FILTERS.find((x) => x.key === filter)!
    const q = query.trim().toLowerCase()
    const list = docs.filter(f.test).filter((d) => !q || documentTitle(d).toLowerCase().includes(q) || d.filename.toLowerCase().includes(q))
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (sort.key === 'title') return documentTitle(a).localeCompare(documentTitle(b)) * dir
      if (sort.key === 'bytes') return (a.bytes - b.bytes) * dir
      return (new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()) * dir
    })
  }, [docs, filter, query, sort])

  const uploadedIds = new Set(docs?.map((d) => d.id) ?? [])
  const pendingRows = uploads.rows.filter((r) => !(r.documentId && uploadedIds.has(r.documentId)))
  const detail = detailId ? docs?.find((d) => d.id === detailId) ?? null : null

  if (detail) {
    return (
      <>
        <DocumentDetail
          desk={desk}
          doc={detail}
          total={docs?.filter((d) => d.status !== 'superseded').length ?? 0}
          dossiers={dossiers}
          criteria={criteria}
          onBack={() => setDetailId(null)}
          onOpenViewer={() => void openViewer(detail)}
          onReread={() => void reread(detail)}
          onRelevance={(next) => setRuling({ doc: detail, next })}
          onRemove={() => setRemoving(detail)}
          onChanged={() => {
            reload()
            onChanged()
          }}
          busy={busyIds.has(detail.id)}
        />
        {viewer && <Viewer viewer={viewer} dossiers={dossiers} onClose={() => setViewer(null)} />}
        {ruling && <RulingDialog target={ruling} busy={busyIds.has(ruling.doc.id)} onCancel={() => setRuling(null)} onConfirm={(reason) => void rule(ruling.doc, ruling.next, reason)} />}
        {removing && <RemoveDialog doc={removing} onCancel={() => setRemoving(null)} onConfirm={async () => { await desk.removeDocument(removing.id); setRemoving(null); setDetailId(null); reload(); onChanged() }} />}
      </>
    )
  }

  return (
    <div className="max-w-[980px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-[260px] flex-1">
          <MagnifyingGlass size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-kumo-inactive" />
          <WorkshopInput value={query} onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} placeholder="Search documents…" className="w-full !h-8 !pl-7" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <WorkshopButton className="!h-8 gap-1.5" onClick={() => void rereadAll()} disabled={!docs}>
            <ArrowsClockwise size={13} /> Read
          </WorkshopButton>
          <WorkshopButton className="!h-8 gap-1.5" onClick={() => setDriveOpen((o) => !o)} aria-expanded={driveOpen}>
            <GoogleDriveLogo size={13} /> Google Drive
          </WorkshopButton>
          <UploadButton onFiles={uploads.add} />
        </div>
      </div>

      {driveOpen && <DrivePanel onClose={() => setDriveOpen(false)} />}

      {receipt && (
        <p className="tnum m-0 flex items-center gap-2 text-[12.5px] text-kumo-subtle" aria-live="polite">
          <StatusDot tone="working" className="breathe" /> {receipt.line}
        </p>
      )}

      <UploadRows rows={pendingRows} onDismiss={uploads.dismiss} />

      {docs === null && failed && (
        <Notice title="We could not load this matter's documents just now." body="This is a display problem, not a change to the record. Nothing has been lost. Reload to try again." />
      )}
      {docs === null && !failed && (
        <div className="space-y-2">
          <Skeleton className="h-[60px]" />
          <Skeleton className="h-[60px]" />
          <Skeleton className="h-[60px]" />
        </div>
      )}
      {docs !== null && failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      {docs !== null && docs.length === 0 && pendingRows.length === 0 && (
        <>
          <Dropzone onFiles={uploads.add} />
          <EmptyLine title="No documents yet." body="Upload one above, or send the client a sign-in link from the Client tab." />
        </>
      )}
      {docs !== null && docs.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FilterPills docs={docs} value={filter} onChange={setFilter} />
            <div className="inline-flex rounded-full border border-kumo-line p-0.5">
              {(['list', 'evidence'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setView(k)} className={`press cursor-pointer rounded-full px-3 py-1 text-[12.5px] font-medium ${view === k ? 'bg-kumo-contrast text-kumo-inverse' : 'text-kumo-subtle hover:text-kumo-default'}`}>
                  {k === 'list' ? 'List' : 'By evidence'}
                </button>
              ))}
            </div>
          </div>
          {filter === 'aside' ? (
            <SetAsidePanel docs={visible} busy={busyIds} onRestore={(doc) => setRuling({ doc, next: 'included' })} />
          ) : view === 'evidence' ? (
            <ByEvidence
              docs={docs.filter((d) => d.status === 'ready' && d.relevance !== 'excluded')}
              dossiers={dossiers}
              sections={readiness.data?.sections ?? null}
              onOpenViewer={(doc) => void openViewer(doc)}
              onDetails={(doc) => setDetailId(doc.id)}
              onKeep={(doc) => setRuling({ doc, next: 'included' })}
              onUse={(doc) => setRuling({ doc, next: 'included' })}
            />
          ) : visible.length === 0 ? (
            <EmptyLine title="Nothing here." body={query ? 'No document matches that search.' : 'Nothing in this category right now.'} />
          ) : (
            <DocumentGrid
              docs={visible}
              sort={sort}
              onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
              evidenceOf={evidenceOf}
              onOpen={(doc) => (doc.mime === 'application/pdf' || doc.mime.startsWith('image/') ? void openViewer(doc) : setDetailId(doc.id))}
              onRetry={(doc) => void reread(doc)}
              onRemove={setRemoving}
            />
          )}
          <Dropzone onFiles={uploads.add} busy={anyBusy} />
        </>
      )}

      {viewer && (
        <Viewer
          viewer={viewer}
          dossiers={dossiers}
          onClose={() => setViewer(null)}
          onDetails={() => {
            setDetailId(viewer.doc.id)
            setViewer(null)
          }}
        />
      )}
      {ruling && <RulingDialog target={ruling} busy={busyIds.has(ruling.doc.id)} onCancel={() => setRuling(null)} onConfirm={(reason) => void rule(ruling.doc, ruling.next, reason)} />}
      {removing && <RemoveDialog doc={removing} onCancel={() => setRemoving(null)} onConfirm={async () => { await desk.removeDocument(removing.id); setRemoving(null); reload(); onChanged() }} />}
    </div>
  )
}

function Viewer({ viewer, dossiers, onClose, onDetails }: { viewer: { doc: LegalDocument; url: string | null; text: string | null }; dossiers: ReturnType<typeof useDossiers>; onClose: () => void; onDetails?: () => void }) {
  useEffect(() => dossiers.ensure([viewer.doc.id]), [viewer.doc.id, dossiers])
  return (
    <DocViewer
      name={documentTitle(viewer.doc)}
      exhibitNo={viewer.doc.exhibitNo}
      src={viewer.url}
      mime={viewer.doc.mime}
      text={viewer.url ? null : viewer.text ?? 'Fetching the document…'}
      aside={<FirmRead doc={viewer.doc} state={dossiers.get(viewer.doc.id)} onDetails={onDetails} />}
      onClose={onClose}
    />
  )
}

function RulingDialog({ target, busy, onCancel, onConfirm }: { target: { doc: LegalDocument; next: 'included' | 'excluded' }; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const aside = target.next === 'excluded'
  const name = documentTitle(target.doc)
  return (
    <LegalDialog
      open
      busy={busy}
      onOpenChange={(open) => { if (!open) onCancel() }}
      title={aside ? 'Set this document aside?' : target.doc.relevance === 'check' ? 'Keep this document on the record?' : 'Restore this document?'}
      description={aside ? `"${name}" stays on the matter but stops counting as evidence. The firm re-checks the case without it. You can restore it any time.` : `"${name}" counts as evidence again. Its claims go back into the case knowledge and the firm re-checks the case against it.`}
      footer={
        <>
          <WorkshopButton className="!h-9" onClick={onCancel} disabled={busy}>Cancel</WorkshopButton>
          <WorkshopButton tone="primary" className="!h-9" onClick={() => onConfirm(reason.trim() || (aside ? 'Set aside by the attorney.' : 'Kept by the attorney.'))} disabled={busy}>
            {busy ? 'Working…' : aside ? 'Set aside' : 'Keep on the record'}
          </WorkshopButton>
        </>
      }
    >
      <FieldLabel hint="The firm records your reason on the matter and plans from it.">Why (optional)</FieldLabel>
      <WorkshopInputArea value={reason} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)} rows={3} placeholder={aside ? 'e.g. Belongs to a different matter.' : 'e.g. It is the beneficiary\'s own award letter.'} className="w-full" />
    </LegalDialog>
  )
}

function RemoveDialog({ doc, onCancel, onConfirm }: { doc: LegalDocument; onCancel: () => void; onConfirm: () => Promise<void> }) {
  return (
    <ConfirmModal
      open
      heading="Remove this document?"
      body={<>This removes “{documentTitle(doc)}” and its earlier versions from the matter, and retires the facts the firm drew from it. The case knowledge refreshes without it.</>}
      confirmLabel="Remove document"
      busyLabel="Removing…"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
