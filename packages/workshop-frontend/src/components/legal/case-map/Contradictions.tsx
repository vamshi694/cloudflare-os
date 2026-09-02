import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { Contradiction, MatterDesk } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton } from '../../WorkshopControls'
import { EmptyLine, Notice, StatusDot } from '../primitives'
import { useDeskData } from '../useMatterDesk'

type Side = Contradiction['a']

/**
 * CONTRADICTIONS — where the record disagrees with itself, each with both quotes in full and the
 * firm's recommendation first. The serious ones are also on the needs-you rail as decisions; this
 * view is the full list, open first, and where the attorney resolves or dismisses the rest.
 */
export function Contradictions({ desk, running, onRun }: { desk: RpcStub<MatterDesk>; running: boolean; onRun: () => void }) {
  const load = useCallback(() => desk.contradictions(), [desk])
  const { data, failed, reload } = useDeskData<Contradiction[]>(load, { pollMs: running ? 5000 : 30000 })
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<{ id: string; outcome: 'resolved' | 'dismissed' } | null>(null)
  const [note, setNote] = useState('')

  const rule = async (id: string, outcome: 'resolved' | 'dismissed') => {
    setBusy(id)
    try {
      await desk.resolveContradiction(id, outcome, note.trim())
      setNoteFor(null)
      setNote('')
      reload()
    } catch (err) {
      logRpcFailure('Failed to rule on a contradiction:', err)
      toasts.add({ title: "That didn't save — the contradiction is still open.", variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const runButton = (
    <WorkshopButton className="!h-8" onClick={onRun} disabled={running}>
      {running ? 'Checking…' : 'Check the record again'}
    </WorkshopButton>
  )

  if (data === null) {
    if (failed) return <Notice title="The contradictions couldn't be read just now." body="The record is unchanged — this view keeps retrying." />
    return <div className="skeleton h-[240px]" />
  }
  if (data.length === 0) {
    return (
      <div className="space-y-3">
        {running
          ? <p className="m-0 flex items-center gap-2 text-[13.5px] text-kumo-default"><StatusDot tone="working" className="breathe" /> The firm is checking the record for contradictions.</p>
          : <EmptyLine title="No contradictions on file." body="The firm checks the record after it settles; run it again after the record changes." />}
        {runButton}
      </div>
    )
  }
  const open = data.filter((c) => c.status === 'open')
  const settled = data.filter((c) => c.status !== 'open')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="tnum m-0 text-[13px] text-kumo-subtle">{open.length} open · {settled.length} ruled on</p>
        {running && <span className="flex items-center gap-1.5 text-[12.5px] text-kumo-subtle"><StatusDot tone="working" className="breathe" /> checking</span>}
        <span className="ml-auto">{runButton}</span>
      </div>
      {failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      <ul className="m-0 list-none space-y-3 p-0">
        {data.map((c) => (
          <li key={c.id} className={`rounded-[14px] border bg-kumo-base px-4 py-3.5 ${c.status === 'open' ? 'border-kumo-line shadow-depth' : 'border-kumo-line opacity-70'}`}>
            <div className="flex items-start gap-3">
              <span aria-hidden className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${c.severity === 'high' ? 'bg-kumo-danger' : c.severity === 'medium' ? 'bg-kumo-warning' : 'bg-kumo-inactive'}`} />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[14px] font-medium leading-[20px] text-kumo-default">The record disagrees about {c.subject}.</p>
                <p className="m-0 mt-0.5 text-[12.5px] leading-[18px] text-kumo-subtle">{c.explanation}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SideCard side={c.a} />
                  <SideCard side={c.b} />
                </div>
                {c.recommendation && <p className="m-0 mt-3 text-[13px] leading-[19px] text-kumo-default"><span className="text-kumo-subtle">The firm would </span>{c.recommendation}</p>}
                {c.status !== 'open' && (
                  <p className="m-0 mt-2 text-[12.5px] text-kumo-subtle">{c.status === 'resolved' ? 'Resolved' : 'Dismissed'}{c.resolution ? `: ${c.resolution}` : '.'}</p>
                )}
                {c.status === 'open' && (
                  noteFor?.id === c.id ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        autoFocus
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder={noteFor.outcome === 'resolved' ? 'Which version the petition relies on, and why…' : 'Why this is not a contradiction…'}
                        className="w-full rounded-[10px] border border-kumo-line bg-kumo-base px-3 py-2 text-[13.5px] leading-[19px] text-kumo-default outline-none focus:border-kumo-ring"
                      />
                      <div className="flex gap-2">
                        <WorkshopButton tone="primary" className="!h-8" onClick={() => void rule(c.id, noteFor.outcome)} disabled={busy === c.id}>
                          {busy === c.id ? 'Recording…' : noteFor.outcome === 'resolved' ? 'Resolve' : 'Dismiss'}
                        </WorkshopButton>
                        <WorkshopButton className="!h-8" onClick={() => { setNoteFor(null); setNote('') }}>Cancel</WorkshopButton>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <WorkshopButton className="!h-8" onClick={() => setNoteFor({ id: c.id, outcome: 'resolved' })}>Resolve…</WorkshopButton>
                      <WorkshopButton className="!h-8" onClick={() => setNoteFor({ id: c.id, outcome: 'dismissed' })}>Not a contradiction…</WorkshopButton>
                    </div>
                  )
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SideCard({ side }: { side: Side }) {
  return (
    <div className="rounded-[10px] border border-kumo-line bg-kumo-elevated px-3 py-2.5">
      <p className="m-0 text-[12px] font-medium text-kumo-subtle">{side.documentTitle}{side.page ? `, p. ${side.page}` : ''}</p>
      <p className="m-0 mt-1 text-[13px] leading-[19px] text-kumo-default">{side.statement}</p>
      <blockquote className="m-0 mt-1.5 border-l-2 border-kumo-line pl-2 text-[12.5px] italic leading-[18px] text-kumo-subtle">“{side.quote}”</blockquote>
    </div>
  )
}
