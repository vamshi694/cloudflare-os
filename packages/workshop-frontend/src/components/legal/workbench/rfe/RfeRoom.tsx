import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, RfeAsk, RfeResponse, RfeState } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../../rpcErrors'
import { WorkshopButton } from '../../../WorkshopControls'
import { Notice, Pill, StatusDot } from '../../primitives'
import { useDeskData } from '../../useMatterDesk'
import { shortDate } from '../../labels'

/**
 * THE RFE ROOM — the officer's asks, one by one, each with the evidence on the record that touches
 * it and the firm's draft response. The clock sits at the top. Nothing here is sent: an approved
 * response is the attorney's text for the packet; the filing is the attorney's act.
 */
export function RfeRoom({ desk }: { desk: RpcStub<MatterDesk> }) {
  const load = useCallback(() => desk.rfe(), [desk])
  const rfe = useDeskData<RfeState | null>(load, { pollMs: 8000 })
  const [open, setOpen] = useState<string | null>(null)

  if (rfe.data === undefined || (rfe.data === null && !rfe.failed && rfe.data !== null)) return <div className="skeleton h-[320px]" />
  if (rfe.data === null && rfe.failed) return <Notice title="The RFE couldn't be read just now." body="Nothing has changed on the matter — this view keeps retrying." />
  if (rfe.data === null) return <Notice title="No Request for Evidence on the record." body="When one is uploaded, the firm reads its asks and docket its clock here." />
  const r = rfe.data
  const responseFor = (askId: string) => r.responses.find((x) => x.askId === askId) ?? null
  const evidenceFor = (askId: string) => r.evidence.find((e) => e.askId === askId)?.facts ?? []
  const approved = r.responses.filter((x) => x.status === 'approved').length

  return (
    <div className="space-y-4">
      <Clock r={r} approved={approved} desk={desk} reload={rfe.reload} />
      {r.summary && <p className="m-0 max-w-[72ch] text-[14px] leading-[1.6] text-kumo-default">{r.summary}</p>}
      <div className="space-y-2">
        {r.asks.map((ask) => (
          <AskCard
            key={ask.id}
            ask={ask}
            response={responseFor(ask.id)}
            evidence={evidenceFor(ask.id)}
            open={open === ask.id}
            onToggle={() => setOpen(open === ask.id ? null : ask.id)}
            desk={desk}
            reload={rfe.reload}
          />
        ))}
      </div>
    </div>
  )
}

function Clock({ r, approved, desk, reload }: { r: RfeState; approved: number; desk: RpcStub<MatterDesk>; reload: () => void }) {
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState(false)
  const days = r.responseDue ? Math.round((Date.parse(r.responseDue) - Date.now()) / 86_400_000) : null
  const tone = days === null ? 'text-kumo-subtle' : days < 0 ? 'text-kumo-danger' : days <= 14 ? 'text-kumo-warning' : 'text-kumo-default'
  const close = async () => {
    setBusy(true)
    try { await desk.closeRfe('responded'); reload() }
    catch (err) { logRpcFailure('Failed to close the RFE:', err); toasts.add({ title: "That didn't save — the RFE is still open.", variant: 'error' }) }
    finally { setBusy(false) }
  }
  return (
    <div className="shadow-depth flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-kumo-line bg-kumo-base px-5 py-4">
      <div className="min-w-0">
        <p className="m-0 font-serif text-[17px] text-kumo-default">Request for Evidence{r.documentTitle ? <span className="text-kumo-subtle"> · {r.documentTitle}</span> : null}</p>
        <p className={`tnum m-0 mt-1 text-[13px] ${tone}`}>
          {r.responseDue
            ? days !== null && days < 0
              ? `Response was due ${shortDate(r.responseDue)} · ${Math.abs(days)}d overdue`
              : `Response due ${shortDate(r.responseDue)}${days !== null ? ` · ${days}d` : ''}`
            : 'The notice states no response date; docket one from the notice.'}
          {r.receivedOn ? ` · received ${shortDate(r.receivedOn)}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Pill>{approved} of {r.asks.length} responses approved</Pill>
        {r.status === 'open' && (
          <WorkshopButton className="!h-8" onClick={() => void close()} disabled={busy || approved < r.asks.length} title={approved < r.asks.length ? 'Approve every response first' : 'Mark the RFE as responded'}>
            Mark as responded
          </WorkshopButton>
        )}
        {r.status !== 'open' && <Pill>{r.status === 'responded' ? 'Responded' : 'Closed'}</Pill>}
      </div>
    </div>
  )
}

function AskCard({ ask, response, evidence, open, onToggle, desk, reload }: {
  ask: RfeAsk
  response: RfeResponse | null
  evidence: { id: string; statement: string; documentTitle: string; exhibitNo: number | null; page: number | null }[]
  open: boolean
  onToggle: () => void
  desk: RpcStub<MatterDesk>
  reload: () => void
}) {
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState<'draft' | 'save' | 'approve' | null>(null)
  const [text, setText] = useState<string | null>(null)
  const body = text ?? response?.body ?? ''

  const draft = async () => {
    setBusy('draft')
    try { await desk.draftRfeResponse(ask.id); toasts.add({ title: 'The firm is drafting the response — it lands here.', variant: 'success' }); reload() }
    catch (err) { logRpcFailure('Failed to start the RFE draft:', err); toasts.add({ title: "The draft didn't start. This ask is unchanged — try again.", variant: 'error' }) }
    finally { setBusy(null) }
  }
  const save = async () => {
    setBusy('save')
    try { await desk.saveRfeResponse(ask.id, body); setText(null); reload() }
    catch (err) { logRpcFailure('Failed to save the RFE response:', err); toasts.add({ title: "Your wording wasn't saved. The draft is unchanged — try again.", variant: 'error' }) }
    finally { setBusy(null) }
  }
  const approve = async () => {
    setBusy('approve')
    try { await desk.approveRfeResponse(ask.id); reload() }
    catch (err) { logRpcFailure('Failed to approve the RFE response:', err); toasts.add({ title: err instanceof Error ? err.message : "That didn't save — the response is still a draft.", variant: 'error' }) }
    finally { setBusy(null) }
  }

  const state = !response ? 'No response yet' : response.status === 'approved' ? 'Approved' : response.unverified > 0 ? `Draft · ${response.unverified} quote${response.unverified === 1 ? '' : 's'} not in the record` : 'Draft · every quote verifies'

  return (
    <div className="rounded-[14px] border border-kumo-line bg-kumo-base">
      <button type="button" onClick={onToggle} className="flex w-full cursor-pointer items-start gap-3 px-5 py-3.5 text-left">
        <span className="tnum mt-0.5 w-6 shrink-0 text-[12.5px] text-kumo-inactive">{ask.n}.</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-kumo-default">{ask.title}</span>
          <span className="mt-0.5 block text-[12.5px] text-kumo-subtle">{ask.criterion ? `Targets ${ask.criterion.replace(/_/g, ' ')} · ` : ''}{state}</span>
        </span>
        <StatusDot tone={!response ? 'hollow' : response.status === 'approved' ? 'ready' : response.unverified > 0 ? 'paused' : 'working'} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-kumo-line px-5 py-4">
          <section>
            <p className="docket m-0 mb-1">The officer's ask</p>
            <p className="m-0 text-[14px] leading-[1.6] text-kumo-default whitespace-pre-wrap">{ask.ask}</p>
            {ask.evidenceRequested && <p className="m-0 mt-1 text-[12.5px] text-kumo-subtle">Evidence requested: {ask.evidenceRequested}</p>}
          </section>
          <section>
            <p className="docket m-0 mb-1">On the record</p>
            {evidence.length === 0 ? (
              <p className="m-0 text-[13px] text-kumo-subtle">Nothing on the record touches this ask yet. The response will say what the firm will supply.</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {evidence.map((f) => (
                  <li key={f.id} className="text-[13px] leading-[1.5] text-kumo-default">
                    {f.exhibitNo ? <span className="tnum mr-1.5 text-kumo-subtle">Exhibit {f.exhibitNo}</span> : null}{f.statement}
                    <span className="text-kumo-inactive"> · {f.documentTitle}{f.page ? ` p. ${f.page}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <p className="docket m-0 mb-1">The response</p>
            <textarea
              value={body}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(18, Math.max(6, body.split('\n').length + 2))}
              placeholder="No draft yet. Ask the firm to draft it from the record, or write it here."
              className="w-full resize-y rounded-[10px] border border-kumo-line bg-kumo-elevated px-3 py-2 font-serif text-[14.5px] leading-[1.6] text-kumo-default outline-none focus:border-kumo-ring"
              disabled={response?.status === 'approved'}
            />
            {response && response.unverified > 0 && (
              <p className="m-0 mt-1 text-[12.5px] text-kumo-warning">{response.unverified} quoted passage{response.unverified === 1 ? '' : 's'} could not be found in the record. Approval waits until every quote verifies.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <WorkshopButton className="!h-8" onClick={() => void draft()} disabled={busy !== null || response?.status === 'approved'}>{busy === 'draft' ? 'Working…' : response ? 'Draft again' : 'Have the firm draft it'}</WorkshopButton>
              <WorkshopButton className="!h-8" onClick={() => void save()} disabled={busy !== null || text === null || !body.trim()}>{busy === 'save' ? 'Working…' : 'Save my wording'}</WorkshopButton>
              <WorkshopButton tone="primary" className="!h-8" onClick={() => void approve()} disabled={busy !== null || !response || response.status === 'approved' || response.unverified > 0 || text !== null}>{busy === 'approve' ? 'Working…' : response?.status === 'approved' ? 'Approved' : 'Approve'}</WorkshopButton>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
