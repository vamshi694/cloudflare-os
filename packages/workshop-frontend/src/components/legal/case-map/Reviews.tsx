import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, ReviewPair, ReviewState } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton } from '../../WorkshopControls'
import { EmptyLine, Notice, StatusDot } from '../primitives'
import { useDeskData } from '../useMatterDesk'

/**
 * THE FIRM'S REVIEWS — duplicate entities and evidence conflicts are the firm's chore, not the
 * lawyer's: the counsel adjudicates pairs on its own pass, ledgered and undoable from the dossier.
 * What it left pending, or got wrong, the attorney rules on here in one tap.
 */
export function Reviews({ desk, running, onRun, onChanged }: {
  desk: RpcStub<MatterDesk>
  running: { duplicate: boolean; conflict: boolean }
  onRun: (kind: 'duplicate' | 'conflict') => void
  onChanged: () => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ReviewPanel desk={desk} kind="duplicate" running={running.duplicate} onRun={() => onRun('duplicate')} onChanged={onChanged} />
      <ReviewPanel desk={desk} kind="conflict" running={running.conflict} onRun={() => onRun('conflict')} onChanged={onChanged} />
    </div>
  )
}

const COPY = {
  duplicate: {
    title: 'Duplicate entities',
    intro: 'Two names the record may use for one entity. Merging keeps the first and folds the second into it.',
    empty: 'No duplicates to review.',
    yes: 'Merge', no: 'Keep both', verdict: 'merge' as const,
  },
  conflict: {
    title: 'How the evidence is filed',
    intro: 'Two claims in the same section that disagree. Setting the second aside removes it from every brief; it stays reversible.',
    empty: 'No conflicts to review.',
    yes: 'Set the second aside', no: 'Both stand', verdict: 'set_aside' as const,
  },
}

function ReviewPanel({ desk, kind, running, onRun, onChanged }: {
  desk: RpcStub<MatterDesk>
  kind: 'duplicate' | 'conflict'
  running: boolean
  onRun: () => void
  onChanged: () => void
}) {
  const load = useCallback(() => desk.review(kind), [desk, kind])
  const { data, failed, reload } = useDeskData<ReviewState>(load, { pollMs: running ? 5000 : 30000 })
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState<string | null>(null)
  const copy = COPY[kind]

  const decide = async (pair: ReviewPair, verdict: 'merge' | 'set_aside' | 'keep') => {
    setBusy(pair.id)
    try {
      await desk.decideReview(pair.id, verdict)
      reload()
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to rule on a review pair:', err)
      toasts.add({ title: "That didn't save — the pair is still pending.", variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-[14px] border border-kumo-line bg-kumo-base">
      <header className="flex items-center gap-3 border-b border-kumo-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] font-medium text-kumo-default">{copy.title}</p>
          <p className="m-0 text-[12px] leading-[17px] text-kumo-subtle">{copy.intro}</p>
        </div>
        <WorkshopButton className="!h-8 shrink-0" onClick={onRun} disabled={running}>{running ? 'Reviewing…' : 'Review now'}</WorkshopButton>
      </header>
      <div className="px-4 py-3">
        {data === null ? (
          failed ? <Notice title="This review couldn't be read just now." body="Nothing has changed — it keeps retrying." /> : <div className="skeleton h-[120px]" />
        ) : (
          <>
            {running && <p className="m-0 mb-2 flex items-center gap-2 text-[12.5px] text-kumo-subtle"><StatusDot tone="working" className="breathe" /> The firm is reviewing.</p>}
            {data.note && <p className="m-0 mb-2 text-[12.5px] leading-[18px] text-kumo-warning">{data.note}</p>}
            {data.pairs.length === 0 ? (
              <EmptyLine title={copy.empty} body={data.status === 'never' ? 'The firm reviews after the case knowledge is built; run it now to check.' : `Reviewed ${data.finishedAt ? new Date(data.finishedAt).toLocaleString() : ''}.`} />
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {data.pairs.map((p) => (
                  <li key={p.id} className={`rounded-[10px] border border-kumo-line px-3 py-2.5 ${p.verdict === 'pending' ? 'bg-kumo-elevated' : 'bg-kumo-base'}`}>
                    <p className="m-0 text-[13px] leading-[19px] text-kumo-default"><span className="text-kumo-subtle">A </span>{p.aName}</p>
                    <p className="m-0 text-[13px] leading-[19px] text-kumo-default"><span className="text-kumo-subtle">B </span>{p.bName}</p>
                    <p className="m-0 mt-1 text-[12px] leading-[17px] text-kumo-subtle">{p.reason}</p>
                    {p.verdict === 'pending' ? (
                      <div className="mt-2 flex gap-2">
                        <WorkshopButton tone="primary" className="!h-7" onClick={() => void decide(p, copy.verdict)} disabled={busy === p.id}>{copy.yes}</WorkshopButton>
                        <WorkshopButton className="!h-7" onClick={() => void decide(p, 'keep')} disabled={busy === p.id}>{copy.no}</WorkshopButton>
                      </div>
                    ) : (
                      <p className="m-0 mt-1.5 text-[12px] text-kumo-subtle">
                        {p.verdict === 'keep' ? 'Both stand' : p.verdict === 'merge' ? 'Merged' : 'Second set aside'} · by {p.decidedBy === 'attorney' ? 'you' : 'the firm'}
                        {p.overrideId && ' · undo from the dossier'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  )
}
