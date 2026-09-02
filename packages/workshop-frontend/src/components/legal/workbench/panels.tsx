import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, Petition, PetitionVersion } from '@gadgets/workshop-shared/legal'
import { ShieldCheck } from '@phosphor-icons/react'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton, WorkshopInput, WorkshopInputArea } from '../../WorkshopControls'
import { LegalDialog, StatusDot } from '../primitives'
import { SlideOver } from '../ui/SlideOver'
import { SEV_TONE, fmtDateTime, plural } from '../labels'

/**
 * Filing history. Restore is deliberately absent: it rewrote every section and set off redraft
 * work the attorney never asked for. A past version stays reachable; changing the live letter
 * belongs to drafting.
 */
export function HistoryPanel({ open, onClose, versions }: { open: boolean; onClose: () => void; versions: PetitionVersion[] }) {
  return (
    <SlideOver open={open} onClose={onClose} title="Filing history" subtitle="A version is saved when the letter is fully drafted, downloaded, or restored. Small edits do not pile up here." width={360}>
      {versions.length === 0 ? (
        <p className="m-0 text-[13px] text-kumo-subtle">No versions yet. One is saved each time the petition is drafted or revised.</p>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {versions.map((v, i) => (
            <li key={v.id} className="rounded-xl border border-kumo-line px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-[13px] font-medium text-kumo-default">{fmtDateTime(v.at)}</p>
                {i === 0 && <span className="rounded-full bg-kumo-contrast px-1.5 py-0.5 text-[10.5px] text-kumo-inverse">Current</span>}
              </div>
              <p className="tnum m-0 text-[12px] text-kumo-subtle">
                {v.reason.startsWith('revised:') ? `Section revised: ${v.reason.slice(8)}` : v.reason === 'exported' ? 'Downloaded' : `${plural(v.sections, 'section', 'sections')}`} · ≈ {Math.max(1, Math.round(v.words / 450))} pages
              </p>
              <p className="m-0 mt-1 inline-flex items-center gap-1 text-[11.5px] text-kumo-inactive" title="The tamper-evidence record for this version's packet: per-exhibit fingerprints, signed by the firm's key.">
                <ShieldCheck size={12} /> Signed manifest · lands with the packet binder
              </p>
            </li>
          ))}
        </ul>
      )}
    </SlideOver>
  )
}

type Rfe = Awaited<ReturnType<MatterDesk['simulateRfe']>>

export function RfePanel({ open, onClose, desk, caseType, onFix }: { open: boolean; onClose: () => void; desk: RpcStub<MatterDesk>; caseType: string | null; onFix: (section: string, instruction: string) => void }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'working' } | { kind: 'failed' } | { kind: 'ready'; rfe: Rfe }>({ kind: 'idle' })
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ kind: 'working' })
    desk
      .simulateRfe()
      .then((rfe) => {
        if (!cancelled) setState({ kind: 'ready', rfe })
      })
      .catch((err) => {
        logRpcFailure('The RFE simulation failed:', err)
        if (!cancelled) setState({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [open, desk])

  const riskTone = { high: 'bg-kumo-danger-tint text-kumo-danger', medium: 'bg-kumo-warning-tint text-kumo-warning', low: 'bg-kumo-success-tint text-kumo-success' }
  return (
    <SlideOver open={open} onClose={onClose} title="The RFE an adjudicator would send" subtitle={`Grounded in current ${caseType ?? 'immigration'} adjudication practice. Fix issues before USCIS raises them.`} width={420}>
      {state.kind === 'working' && (
        <p className="m-0 flex items-center gap-2 text-[13px] text-kumo-default"><StatusDot tone="working" className="breathe" /> An adjudicator is reading the letter…</p>
      )}
      {state.kind === 'failed' && <p className="m-0 text-[13px] text-kumo-subtle">The RFE read couldn't run just now. The letter is unchanged — close and try again.</p>}
      {state.kind === 'ready' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${riskTone[state.rfe.risk]}`}>{state.rfe.risk} risk</span>
            {state.rfe.cached && <span className="text-[12px] text-kumo-inactive">· unchanged record</span>}
          </div>
          <p className="m-0 text-[13px] leading-[19px] text-kumo-default">{state.rfe.summary}</p>
          {state.rfe.issues.length === 0 ? (
            <p className="m-0 text-[13px] text-kumo-success">No plausible RFE issues found. The letter reads airtight as written.</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {state.rfe.issues.map((iss, i) => (
                <li key={i} className="rounded-xl border border-kumo-line px-3 py-2.5 text-[12.5px] leading-[18px] text-kumo-default">
                  <p className="m-0"><span className={`font-medium ${SEV_TONE[iss.severity]}`}>{iss.severity}</span> · {iss.section}</p>
                  <p className="m-0 mt-1">{iss.issue}</p>
                  <p className="m-0 mt-1 text-kumo-subtle">USCIS would ask: {iss.uscisWouldAsk}</p>
                  <p className="m-0 mt-1 text-kumo-subtle">Fix: {iss.fix}</p>
                  <WorkshopButton className="!h-7 mt-2" onClick={() => { onFix(iss.section, `${iss.issue} ${iss.fix}`); onClose() }}>Have the firm fix this</WorkshopButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SlideOver>
  )
}

export function DirectiveDialog({ open, onClose, desk, petition, onSaved }: { open: boolean; onClose: () => void; desk: RpcStub<MatterDesk>; petition: Petition; onSaved: () => void }) {
  const [text, setText] = useState(petition.directive?.text ?? '')
  const [pages, setPages] = useState(petition.directive?.targetPages ? String(petition.directive.targetPages) : '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setText(petition.directive?.text ?? '')
    setPages(petition.directive?.targetPages ? String(petition.directive.targetPages) : '')
    setFailure(null)
  }, [open, petition.directive])

  const save = async (rebalance: boolean) => {
    setBusy(true)
    setFailure(null)
    const n = pages.trim() ? Number(pages) : null
    const directive = text.trim() || n ? { targetPages: n && Number.isFinite(n) && n > 0 ? Math.round(n) : null, text: text.trim() } : null
    try {
      await desk.setDirective(directive, { rebalance })
      onSaved()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setFailure(rebalance ? 'Your instruction was saved, but we could not start the redraft. The petition is unchanged. Use Redraft again when you are ready.' : `Your instruction wasn't saved${msg ? `: ${msg}` : '.'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <LegalDialog
      open={open}
      busy={busy}
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Shape the whole letter"
      description="Tell the firm how the entire petition should read: a target length, a standing instruction, or both. It reshapes every section: the strongest evidence keeps its depth, the weakest gets cut. You can also just say it in Conversation ('make the whole petition 15 pages'). Same result."
      footer={
        <>
          <WorkshopButton className="!h-9" onClick={() => { setText(''); setPages('') }} disabled={busy}>Clear</WorkshopButton>
          <WorkshopButton className="!h-9" onClick={() => void save(false)} disabled={busy}>Save</WorkshopButton>
          <WorkshopButton tone="primary" className="!h-9" onClick={() => void save(true)} disabled={busy}>{busy ? 'Working…' : 'Save & rebalance now'}</WorkshopButton>
        </>
      }
    >
      <div className="space-y-3">
        <WorkshopInputArea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Keep it tight and factual. Prioritize the prongs over background." className="w-full" />
        <label className="block text-[12.5px] text-kumo-subtle">
          Target length
          <div className="mt-1 flex items-center gap-2">
            <WorkshopInput type="number" min={1} value={pages} onChange={(e) => setPages(e.target.value)} className="!h-8 w-24" />
            <span>pages (blank = no limit)</span>
          </div>
        </label>
        {failure && <p role="alert" className="m-0 text-[12.5px] text-kumo-danger">{failure}</p>}
      </div>
    </LegalDialog>
  )
}
