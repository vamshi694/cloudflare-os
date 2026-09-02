import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { LegalDecision, MatterDesk } from '@gadgets/workshop-shared/legal'
import { classifyRpcError, logRpcFailure } from '../../rpcErrors'
import { WorkshopButton } from '../WorkshopControls'
import {
  EmptyLine,
  Eyebrow,
  RadioRow,
  Skeleton,
  StatusDot,
  ThreeState,
  formatDate,
  plural,
} from './primitives'

const POLL_MS = 10_000

/** Three branches, each honest about what did and did not happen. */
function answerFailureCopy(err: unknown): string {
  const cls = classifyRpcError(err)
  if (cls === 'connection' || cls === 'do-reset') {
    return "We could not reach the firm's systems, so your decision was not recorded. Nothing has changed. Please try again."
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/not found|not open|already answered|no such/i.test(message)) {
    return 'This decision is no longer open — it may have been answered already. Refreshing will show the current state.'
  }
  return 'Something went wrong on our side and your decision was not recorded. Nothing has changed. Please try again, and tell us if it keeps happening.'
}

/**
 * THE DECISIONS — the questions the firm has for the lawyer, open ones first with their options as
 * rows to read; answered ones fold away underneath.
 */
export function DecisionsTab({
  desk,
  onChanged,
}: {
  desk: RpcStub<MatterDesk>
  onChanged?: () => void
}) {
  const [decisions, setDecisions] = useState<LegalDecision[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await desk.decisions()
      setDecisions(list)
      setFailed(false)
    } catch (err) {
      logRpcFailure("Failed to load the matter's decisions:", err)
      setFailed(true)
    }
  }, [desk])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const handleAnswer = async (id: string, answer: string) => {
    await desk.answerDecision(id, answer)
    await load()
    onChanged?.()
  }

  return (
    <ThreeState
      items={decisions}
      failed={failed}
      skeleton={
        <div className="space-y-2">
          <Skeleton className="h-[120px]" />
          <Skeleton className="h-[120px]" />
        </div>
      }
      neverLoaded={{
        title: "What needs you couldn't be checked just now.",
        body: 'Nothing has changed on the matter — this list may be out of date. It keeps retrying; reload if it stays empty.',
      }}
      stale="What needs you couldn't be checked just now — this list may be out of date. It keeps retrying."
      empty={
        <EmptyLine
          title="Nothing needs you right now."
          body="When the firm has a question about this matter, it appears here with its options."
        />
      }
    >
      {(items) => {
        const open = items.filter((d) => d.status === 'open')
        const answered = items.filter((d) => d.status !== 'open')
        return (
          <div className="space-y-6">
            {open.length > 0 ? (
              <section className="space-y-3">
                <Eyebrow>{plural(open.length, 'question for you', 'questions for you')}</Eyebrow>
                {open.map((decision) => (
                  <OpenDecision key={decision.id} decision={decision} onAnswer={handleAnswer} />
                ))}
              </section>
            ) : (
              <EmptyLine title="Nothing needs you right now." />
            )}
            {answered.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none px-1 text-[12.5px] leading-4 font-medium tracking-[-0.2px] text-kumo-subtle hover:text-kumo-default">
                  {plural(answered.length, 'answered question', 'answered questions')}
                  <span className="ml-1 text-kumo-inactive group-open:hidden">· show</span>
                </summary>
                <ul className="m-0 mt-2 list-none divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line bg-kumo-base p-0">
                  {answered.map((decision) => (
                    <li key={decision.id} className="px-4 py-3">
                      <p className="m-0 text-[13.5px] leading-5 tracking-[-0.25px] text-kumo-default">
                        {decision.question}
                      </p>
                      <p className="mt-1 mb-0 text-[12.5px] leading-[18px] tracking-[-0.2px] text-kumo-subtle">
                        <span className="font-medium text-kumo-default">{decision.answer ?? '—'}</span>
                        {decision.answeredAt && ` · ${formatDate(decision.answeredAt)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )
      }}
    </ThreeState>
  )
}

function OpenDecision({
  decision,
  onAnswer,
}: {
  decision: LegalDecision
  onAnswer: (id: string, answer: string) => Promise<void>
}) {
  const [choice, setChoice] = useState<string>(decision.options[0] ?? '')
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'failed'; copy: string } | { kind: 'done' }
  >({ kind: 'idle' })

  const submit = async () => {
    if (!choice) return
    setState({ kind: 'busy' })
    try {
      await onAnswer(decision.id, choice)
      setState({ kind: 'done' })
    } catch (err) {
      logRpcFailure('Failed to record the decision:', err, { reportSite: 'legal.answerDecision' })
      setState({ kind: 'failed', copy: answerFailureCopy(err) })
    }
  }

  const busy = state.kind === 'busy'
  return (
    <div className="rounded-xl border border-kumo-line bg-kumo-base">
      <div className="flex items-start gap-2.5 border-b border-kumo-line px-4 py-3">
        <StatusDot tone="needsYou" className="mt-[7px]" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] leading-[21px] tracking-[-0.25px] text-kumo-default">
            {decision.question}
          </p>
          <p className="mt-0.5 mb-0 text-[12px] leading-4 text-kumo-inactive">
            Raised {formatDate(decision.raisedAt)}
          </p>
        </div>
      </div>
      {decision.options.length > 0 ? (
        <div className="space-y-0.5 px-2 py-2">
          {decision.options.map((option) => (
            <RadioRow
              key={option}
              name={`decision-${decision.id}`}
              value={option}
              checked={choice === option}
              onChange={setChoice}
              disabled={busy}
            >
              {option}
            </RadioRow>
          ))}
        </div>
      ) : (
        <p className="m-0 px-4 py-3 text-[12.5px] text-kumo-subtle">
          This question has no options to choose from — answer it in the Conversation.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-kumo-line px-4 py-2.5">
        <p
          className={`m-0 min-w-0 text-[12.5px] leading-[18px] tracking-[-0.2px] ${
            state.kind === 'failed' ? 'text-kumo-danger' : 'text-kumo-subtle'
          }`}
        >
          {state.kind === 'busy' && 'Recording your decision and handing it to the firm…'}
          {state.kind === 'done' && 'Recorded — the firm is acting on it.'}
          {state.kind === 'failed' && state.copy}
        </p>
        {decision.options.length > 0 && (
          <WorkshopButton
            tone="primary"
            className="!h-8"
            onClick={() => void submit()}
            disabled={busy || !choice || state.kind === 'done'}
          >
            {busy ? 'Working…' : 'Answer'}
          </WorkshopButton>
        )}
      </div>
    </div>
  )
}
