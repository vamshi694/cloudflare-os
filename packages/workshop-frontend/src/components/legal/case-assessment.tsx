import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { CriteriaFindings, GapAudit, IntelRun, MatterDesk } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../rpcErrors'
import { StatusDot } from './primitives'
import { useDeskData } from './useMatterDesk'

/**
 * THE FIRM'S ASSESSMENT — the conversation rail's second card. The reviewer's verdict per section
 * (reading as the officer will), the gaps by priority with the ask in the client's words, and the
 * strategy memo on the desk. Verdicts lead, numbers never appear. Each pass says when it stopped
 * early; a card that is empty says why, never nothing.
 */
export function CaseAssessment({ desk, onOpenDesk }: { desk: RpcStub<MatterDesk>; onOpenDesk: () => void }) {
  const toasts = useKumoToastManager()
  const loadFindings = useCallback(() => desk.criteriaFindings(), [desk])
  const loadGaps = useCallback(() => desk.gapAudit(), [desk])
  const loadRunning = useCallback(() => desk.intelRunning(), [desk])
  const loadDesk = useCallback(() => desk.deskFiles(), [desk])
  const findings = useDeskData<CriteriaFindings>(loadFindings, { pollMs: 15000 })
  const gaps = useDeskData<GapAudit>(loadGaps, { pollMs: 15000 })
  const running = useDeskData<Record<IntelRun, boolean>>(loadRunning, { pollMs: 6000 })
  const files = useDeskData(loadDesk, { pollMs: 30000 })
  const [starting, setStarting] = useState<IntelRun | null>(null)

  const start = async (kind: IntelRun) => {
    setStarting(kind)
    try {
      await desk.runIntel(kind)
      running.reload()
    } catch (err) {
      logRpcFailure('Failed to start a pass:', err)
      toasts.add({ title: "That didn't start. Nothing on the matter changed — try again.", variant: 'error' })
    } finally {
      setStarting(null)
    }
  }
  const busy = (k: IntelRun) => starting === k || running.data?.[k] === true
  const hasMemo = (files.data ?? []).some((f) => f.path === 'strategy.md')
  const f = findings.data
  const g = gaps.data
  const weak = (f?.sections ?? []).filter((s) => s.verdict !== 'strong')

  return (
    <div className="shadow-depth rise divide-y divide-kumo-line rounded-[14px] border border-kumo-line bg-kumo-base">
      <section className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <p className="docket m-0 flex-1">The firm's assessment</p>
          <RunButton label={f?.assessedAt ? 'Assess again' : 'Assess the criteria'} busy={busy('findings')} onClick={() => void start('findings')} />
        </div>
        {f === null ? (
          findings.failed ? <Quiet>The assessment couldn't be read just now. Nothing has changed — it keeps retrying.</Quiet> : <div className="skeleton mt-2 h-[72px]" />
        ) : f.running ? (
          <Quiet><StatusDot tone="working" className="breathe mr-1.5 inline-block" />The firm is reading the claims as the officer will.</Quiet>
        ) : f.sections.length === 0 ? (
          <Quiet>{f.note ?? 'Not assessed yet. The firm assesses after the case knowledge is built.'}</Quiet>
        ) : (
          <>
            {f.note && <p className="m-0 mt-2 text-[12px] leading-[17px] text-kumo-warning">{f.note}</p>}
            {weak.length === 0 ? (
              <Quiet>Every section reads strong on the claims on file.</Quiet>
            ) : (
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                {f.sections.map((s) => (
                  <li key={s.key} className="text-[13px] leading-[19px]">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-kumo-default">{s.title}</span>
                      <span className={`shrink-0 text-[11.5px] ${s.verdict === 'strong' ? 'text-kumo-success' : s.verdict === 'arguable' ? 'text-kumo-default' : s.verdict === 'weak' ? 'text-kumo-warning' : 'text-kumo-inactive'}`}>
                        {s.verdict}
                      </span>
                    </div>
                    {s.officerWouldSeize[0] && s.verdict !== 'strong' && (
                      <p className="m-0 text-[12px] leading-[17px] text-kumo-subtle">An officer would seize on: {s.officerWouldSeize[0]}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <section className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <p className="docket m-0 flex-1">Gaps, by priority</p>
          <RunButton label={g?.auditedAt ? 'Audit again' : 'Audit the gaps'} busy={busy('gaps')} onClick={() => void start('gaps')} />
        </div>
        {g === null ? (
          gaps.failed ? <Quiet>The gap audit couldn't be read just now. Nothing has changed — it keeps retrying.</Quiet> : <div className="skeleton mt-2 h-[56px]" />
        ) : g.running ? (
          <Quiet><StatusDot tone="working" className="breathe mr-1.5 inline-block" />The firm is auditing the record.</Quiet>
        ) : g.items.length === 0 ? (
          <Quiet>{g.note ?? (g.auditedAt ? 'No gaps: the record supports every section.' : 'Not audited yet. Assess the criteria first, then audit.')}</Quiet>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {g.items.slice(0, 5).map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-[12.5px] leading-[18px] text-kumo-default">
                <span className={`tnum mt-[2px] shrink-0 rounded-full px-1.5 text-[10.5px] leading-[14px] ${item.priority === 1 ? 'bg-kumo-danger-tint text-kumo-danger' : item.priority === 2 ? 'bg-kumo-warning-tint text-kumo-warning' : 'bg-kumo-tint text-kumo-subtle'}`}>
                  {item.priority}
                </span>
                <span className="min-w-0"><span className="text-kumo-subtle">{item.title}: </span>{item.missing}</span>
              </li>
            ))}
            {g.items.length > 5 && <li className="text-[12px] text-kumo-inactive">{g.items.length - 5} more on the case map</li>}
          </ul>
        )}
      </section>
      <section className="px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="docket m-0 flex-1">Strategy memo</p>
          <RunButton label={hasMemo ? 'Write it again' : 'Write the memo'} busy={busy('strategy')} onClick={() => void start('strategy')} />
        </div>
        {running.data?.strategy ? (
          <Quiet><StatusDot tone="working" className="breathe mr-1.5 inline-block" />The firm is writing the memo.</Quiet>
        ) : hasMemo ? (
          <button type="button" onClick={onOpenDesk} className="press mt-2 h-8 w-full cursor-pointer rounded-lg border border-kumo-line text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-tint">
            Read the memo on the desk
          </button>
        ) : (
          <Quiet>Written from the assessment and the gaps; it lands on the desk as strategy.md.</Quiet>
        )}
      </section>
    </div>
  )
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="m-0 mt-2 text-[12.5px] leading-[18px] text-kumo-subtle">{children}</p>
}

function RunButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="press h-6 shrink-0 cursor-pointer rounded-md border border-kumo-line px-2 text-[11.5px] text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default disabled:cursor-default disabled:opacity-50"
    >
      {busy ? 'Working…' : label}
    </button>
  )
}
