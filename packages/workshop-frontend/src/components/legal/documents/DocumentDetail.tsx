import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { LegalDocument, LegalFact, MatterDesk } from '@gadgets/workshop-shared/legal'
import { ArrowLeft } from '@phosphor-icons/react'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton } from '../../WorkshopControls'
import { Notice, Pill, confidenceWord } from '../primitives'
import { useDeskData } from '../useMatterDesk'
import { docLabel, plural, shortDate, tidy } from '../labels'
import { documentTitle } from './FirmRead'
import type { Dossiers } from './useDossiers'

/**
 * The detail screen: preview on demand, the rulings, the dossier (how we'll use it, supports,
 * version history) and the facts the firm read from this document.
 */
export function DocumentDetail({
  desk,
  doc,
  total,
  dossiers,
  criteria,
  onBack,
  onOpenViewer,
  onReread,
  onRelevance,
  onRemove,
  onChanged,
  busy,
}: {
  desk: RpcStub<MatterDesk>
  doc: LegalDocument
  total: number
  dossiers: Dossiers
  criteria: { key: string; title: string }[]
  onBack: () => void
  onOpenViewer: () => void
  onReread: () => void
  onRelevance: (next: 'included' | 'excluded') => void
  onRemove: () => void
  onChanged: () => void
  busy: boolean
}) {
  const toasts = useKumoToastManager()
  const [preview, setPreview] = useState<'off' | 'document' | 'text'>('off')
  const [url, setUrl] = useState<string | null>(null)
  const [urlFailed, setUrlFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [supports, setSupports] = useState<string[] | null>(null)
  const dossier = dossiers.get(doc.id)

  useEffect(() => {
    dossiers.ensure([doc.id])
  }, [doc.id, dossiers])

  useEffect(() => {
    if (preview !== 'document' || url) return
    let cancelled = false
    desk
      .fileUrl(doc.id)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch((err) => {
        logRpcFailure('Failed to mint a file URL:', err)
        if (!cancelled) setUrlFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [preview, url, desk, doc.id])

  const loadText = useCallback(() => desk.documentText(doc.id), [desk, doc.id])
  const text = useDeskData<{ text: string; pageCount: number | null }>(preview === 'text' ? loadText : null, { deps: [preview] })
  const loadFacts = useCallback(() => desk.facts({ documentId: doc.id, limit: 200 }), [desk, doc.id])
  const facts = useDeskData<LegalFact[]>(loadFacts, { deps: [doc.id] })

  const current = dossier.kind === 'ready' && dossier.dossier ? dossier.dossier.evidenceFor : []
  const shown = supports ?? current
  const isPdfOrImage = doc.mime === 'application/pdf' || doc.mime.startsWith('image/')

  const saveSupports = async () => {
    if (!supports) return
    try {
      await desk.setSupports(doc.id, supports)
      dossiers.invalidate(doc.id)
      setEditing(false)
      setSupports(null)
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to save the supports:', err)
      toasts.add({ title: 'That correction was not saved — the document is unchanged.', variant: 'error' })
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="press inline-flex cursor-pointer items-center gap-1 text-[13px] text-kumo-subtle hover:text-kumo-default">
        <ArrowLeft size={13} /> All documents ({total})
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[18px] leading-6 font-semibold tracking-[-0.3px] text-kumo-default">{documentTitle(doc)}</h2>
          <p className="tnum m-0 mt-0.5 text-[12.5px] text-kumo-subtle">
            {doc.filename} · {tidy(doc.uploadedBy)} · {shortDate(doc.uploadedAt)}
            {doc.pageCount ? ` · ${plural(doc.pageCount, 'page', 'pages')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <WorkshopButton className="!h-8" onClick={() => setPreview((p) => (p === 'off' ? (isPdfOrImage ? 'document' : 'text') : 'off'))}>
            {preview === 'off' ? 'Preview document' : 'Hide preview'}
          </WorkshopButton>
          <WorkshopButton className="!h-8" onClick={onOpenViewer}>Open ↗</WorkshopButton>
          <WorkshopButton className="!h-8" onClick={onReread} disabled={busy || doc.status === 'reading' || doc.status === 'queued'}>↻ Re-read</WorkshopButton>
          {doc.relevance === 'excluded' ? (
            <WorkshopButton className="!h-8" onClick={() => onRelevance('included')} disabled={busy}>↩ Use this document</WorkshopButton>
          ) : doc.relevance === 'check' ? (
            <>
              <WorkshopButton className="!h-8" onClick={() => onRelevance('included')} disabled={busy}>✓ Keep — it is relevant</WorkshopButton>
              <WorkshopButton className="!h-8" onClick={() => onRelevance('excluded')} disabled={busy}>Set aside</WorkshopButton>
            </>
          ) : (
            <WorkshopButton className="!h-8" onClick={() => onRelevance('excluded')} disabled={busy}>Set aside</WorkshopButton>
          )}
          <WorkshopButton tone="danger" className="!h-8" onClick={onRemove} disabled={busy}>Remove</WorkshopButton>
        </div>
      </div>

      {preview !== 'off' && (
        <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
          <div className="flex items-center gap-1 border-b border-kumo-line px-3 py-2">
            {(['document', 'text'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPreview(k)}
                className={`press cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] font-medium ${preview === k ? 'bg-kumo-fill text-kumo-default' : 'text-kumo-subtle hover:text-kumo-default'}`}
              >
                {k === 'document' ? 'Document' : 'Text'}
              </button>
            ))}
          </div>
          <div className="h-[72vh] min-h-[480px] bg-[#525659]">
            {preview === 'document' && url && doc.mime === 'application/pdf' && <iframe title={doc.filename} src={`${url}#view=FitH`} className="h-full w-full border-0" />}
            {preview === 'document' && url && doc.mime.startsWith('image/') && (
              <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={url} alt={doc.filename} className="max-h-full max-w-full" /></div>
            )}
            {preview === 'document' && !isPdfOrImage && (
              <p className="m-0 p-6 text-center text-[13px] text-white/80">Preview not available for this file type. Use Open ↗ or the Text view.</p>
            )}
            {preview === 'document' && isPdfOrImage && !url && (
              <p className="m-0 p-6 text-center text-[13px] text-white/80">{urlFailed ? 'The file could not be fetched just now. It is unchanged — try again.' : 'Fetching the document…'}</p>
            )}
            {preview === 'text' && (
              <pre className="m-0 h-full overflow-auto bg-kumo-base p-5 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-kumo-default">
                {text.data === null ? (text.failed ? 'The text could not be read just now.' : 'Reading the text…') : text.data.text.trim() === '' ? 'No parsed text.' : text.data.text}
              </pre>
            )}
          </div>
        </div>
      )}

      <div className="shadow-depth rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-kumo-subtle">How we'll use it</p>
        {dossier.kind === 'loading' && <div className="skeleton mt-2 h-10" />}
        {dossier.kind === 'failed' && <p className="m-0 mt-1 text-[13px] text-kumo-subtle">The firm's read couldn't load just now.</p>}
        {dossier.kind === 'ready' && (
          <p className="m-0 mt-1 text-[13.5px] leading-[20px] text-kumo-default">
            {doc.status === 'reading' || doc.status === 'queued'
              ? 'Reading this document…'
              : dossier.dossier?.roleInCase ?? (doc.status === 'ready' ? dossier.dossier?.summary ?? 'The firm has read it; its role in the case lands here once the case knowledge is built.' : 'The firm hasn\'t read this document yet. Hit Re-read.')}
          </p>
        )}
        {doc.status === 'ready' && <p className="m-0 mt-1 text-[12.5px] text-kumo-subtle">Filed as {docLabel(doc.docType)}.</p>}

        <div className="mt-4 flex items-center justify-between">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-kumo-subtle">Supports</p>
          {!editing && criteria.length > 0 && (
            <button type="button" onClick={() => { setSupports(current); setEditing(true) }} className="press cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default">Edit</button>
          )}
        </div>
        {editing ? (
          <div className="mt-2 space-y-2">
            <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">Which sections should this document support? Your choice is final over the machine and takes effect immediately.</p>
            <div className="flex flex-wrap gap-1.5">
              {criteria.map((c) => {
                const on = shown.includes(c.key)
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSupports(on ? shown.filter((k) => k !== c.key) : [...shown, c.key])}
                    className={`press cursor-pointer rounded-full border px-2.5 py-1 text-[12.5px] ${on ? 'border-kumo-success/40 bg-kumo-success-tint/60 text-kumo-success' : 'border-kumo-line text-kumo-subtle hover:text-kumo-default'}`}
                  >
                    {on ? '× ' : '+ '}{c.title}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <WorkshopButton className="!h-8" onClick={() => { setEditing(false); setSupports(null) }}>Cancel</WorkshopButton>
              <WorkshopButton tone="primary" className="!h-8" onClick={() => void saveSupports()}>Save</WorkshopButton>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {shown.length === 0 ? <span className="text-[12.5px] text-kumo-inactive">Not yet placed</span> : shown.map((c) => <Pill key={c} tone="ready">{criteria.find((x) => x.key === c)?.title ?? tidy(c)}</Pill>)}
          </div>
        )}

        {dossier.kind === 'ready' && dossier.dossier && dossier.dossier.versions.length > 0 && (
          <>
            <p className="m-0 mt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-kumo-subtle">Version history</p>
            <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
              {dossier.dossier.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2 text-[12.5px] text-kumo-default">
                  <span className="tnum">v{v.version}</span>
                  <span className="min-w-0 truncate text-kumo-subtle">{v.filename}</span>
                  <span className="tnum text-kumo-inactive">{shortDate(v.uploadedAt)}</span>
                  {v.current && <span className="rounded-full bg-kumo-contrast px-1.5 py-0.5 text-[10.5px] text-kumo-inverse">current</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="shadow-depth rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-kumo-subtle">Facts read from this document</p>
        {facts.data === null && facts.failed && <Notice title="The facts couldn't be read just now." body="Nothing has changed — reload to try again." />}
        {facts.data === null && !facts.failed && <div className="skeleton mt-2 h-16" />}
        {facts.data !== null && facts.data.length === 0 && <p className="m-0 mt-1 text-[13px] text-kumo-subtle">No facts yet.</p>}
        {facts.data !== null && facts.data.length > 0 && (
          <ul className="m-0 mt-2 list-none divide-y divide-kumo-line p-0">
            {facts.data.map((f) => (
              <li key={f.id} className="py-2.5">
                <p className="m-0 text-[13.5px] leading-[20px] text-kumo-default">{f.statement}</p>
                <p className="m-0 mt-1 border-l-[1px] border-kumo-line pl-2.5 text-[12.5px] leading-[18px] text-kumo-subtle">“{f.quote}”</p>
                <p className="tnum m-0 mt-1 text-[11.5px] text-kumo-inactive">
                  {f.page ? `p. ${f.page} · ` : ''}{f.occurredOn ? `${f.occurredOn} · ` : ''}{confidenceWord(f.confidence)}{f.significance ? ` · ${f.significance}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
