import { useEffect, useState, type ChangeEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, NeedsYouItem } from '@gadgets/workshop-shared/legal'
import { File as FileIcon } from '@phosphor-icons/react'
import { MarkdownMessage } from '../../ChatInterface'
import styles from '../../ChatInterface.module.css'
import { classifyRpcError, logRpcFailure } from '../../rpcErrors'
import { WorkshopButton, WorkshopInputArea } from '../WorkshopControls'
import { RadioRow, StatusDot } from './primitives'
import { SlideOver } from './ui/SlideOver'
import { Spinner } from './ui/motion'
import { plural, stripMarkdown } from './labels'

const DEFAULT_OPTIONS = ['Approve — proceed as recommended', 'Deny — do not do this', 'Hold — not now']

/** Three branches, each honest about what did and did not happen. */
function failureCopy(err: unknown): string {
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
 * THE NEEDS-YOU BLOCK — always visible above the tabs. Compact by default (one row per item), one
 * expands at a time (the queue stays a queue, not a wall). Top two, the rest fold. "Not now" defers
 * on the client only; a real decline is its own gesture with a reason.
 */
export function NeedsYou({
  desk,
  items,
  onChanged,
  onOpenDocuments,
}: {
  desk: RpcStub<MatterDesk>
  items: NeedsYouItem[]
  onChanged: () => void
  onOpenDocuments: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [deferred, setDeferred] = useState<Set<string>>(new Set())
  const live = items.filter((i) => !deferred.has(i.id))

  useEffect(() => {
    if (expanded && !items.some((i) => i.id === expanded)) setExpanded(null)
  }, [items, expanded])

  if (items.length === 0) return null
  if (live.length === 0) {
    return (
      <p className="m-0 text-[12.5px] leading-[18px] italic text-kumo-subtle">
        {plural(deferred.size, 'decision', 'decisions')} set aside for now — they stay on the matter's rail until you decide.
      </p>
    )
  }

  const shown = showAll ? live : live.slice(0, 2)
  const rest = live.length - shown.length

  return (
    <div className="space-y-2">
      <div className={showAll ? 'max-h-[min(60vh,560px)] space-y-2 overflow-y-auto' : 'space-y-2'}>
        {shown.map((item) => (
          <NeedsYouCard
            key={item.id}
            item={item}
            desk={desk}
            expanded={expanded === item.id}
            onToggle={() => setExpanded((cur) => (cur === item.id ? null : item.id))}
            onDefer={() => setDeferred((s) => new Set(s).add(item.id))}
            onChanged={onChanged}
            onOpenDocuments={onOpenDocuments}
          />
        ))}
      </div>
      {(rest > 0 || showAll) && live.length > 2 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="press cursor-pointer px-1 text-[12.5px] font-medium text-kumo-subtle hover:text-kumo-default"
        >
          {showAll ? 'Show fewer' : `${rest} more need you`}
        </button>
      )}
    </div>
  )
}

function NeedsYouCard({
  item,
  desk,
  expanded,
  onToggle,
  onDefer,
  onChanged,
  onOpenDocuments,
}: {
  item: NeedsYouItem
  desk: RpcStub<MatterDesk>
  expanded: boolean
  onToggle: () => void
  onDefer: () => void
  onChanged: () => void
  onOpenDocuments: () => void
}) {
  const title = stripMarkdown(item.title)
  const clipped = title.length > 140 ? `${title.slice(0, 140)}…` : title
  return (
    <div className="shadow-depth rise rounded-[13px] border border-kumo-danger/20 bg-kumo-base px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        {item.kind === 'plan' ? (
          <FileIcon size={14} className="mt-[3px] shrink-0 text-kumo-subtle" />
        ) : (
          <StatusDot tone="needsYou" className="mt-[7px] !h-1.5 !w-1.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13.5px] leading-[20px] tracking-[-0.25px] text-kumo-default">
            {item.kind === 'outreach' ? 'Client outreach — awaiting your release' : expanded ? title : clipped}
          </p>
          {item.kind === 'outreach' && (
            <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Goes to the client's inbox · you are CC'd on the send</p>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="press shrink-0 cursor-pointer text-[12.5px] font-medium text-kumo-subtle hover:text-kumo-default"
        >
          {expanded ? 'Close' : 'Review'}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-kumo-line pt-3">
          {item.kind === 'decision' && <DecisionBody item={item} desk={desk} onDefer={onDefer} onChanged={onChanged} />}
          {item.kind === 'plan' && <PlanBody item={item} desk={desk} onDefer={onDefer} onChanged={onChanged} />}
          {item.kind === 'outreach' && <OutreachBody item={item} desk={desk} onDefer={onDefer} onChanged={onChanged} />}
          {item.kind === 'unreadable_document' && (
            <div className="space-y-2">
              {item.detail && <Detail markdown={item.detail} />}
              <WorkshopButton className="!h-8" onClick={onOpenDocuments}>
                Open documents
              </WorkshopButton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ markdown }: { markdown: string }) {
  return (
    <div className={`min-w-0 text-[13px] leading-[19px] text-kumo-default ${styles.markdownContent}`}>
      <MarkdownMessage message={markdown} />
    </div>
  )
}

function useSubmit(onChanged: () => void) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'failed'; copy: string } | { kind: 'done' }>({ kind: 'idle' })
  const run = async (fn: () => Promise<void>) => {
    setState({ kind: 'busy' })
    try {
      await fn()
      setState({ kind: 'done' })
      onChanged()
    } catch (err) {
      logRpcFailure('A decision failed to record:', err, { reportSite: 'legal.needsYou' })
      setState({ kind: 'failed', copy: failureCopy(err) })
    }
  }
  return { state, run }
}

function StatusLine({ state }: { state: ReturnType<typeof useSubmit>['state'] }) {
  if (state.kind === 'idle') return null
  return (
    <p className={`m-0 flex items-center gap-1.5 text-[12.5px] leading-[18px] ${state.kind === 'failed' ? 'text-kumo-danger' : 'text-kumo-subtle'}`}>
      {state.kind === 'busy' && <Spinner />}
      {state.kind === 'busy' && 'Recording your decision and handing it to the firm…'}
      {state.kind === 'done' && 'Recorded — the firm is acting on it.'}
      {state.kind === 'failed' && state.copy}
    </p>
  )
}

function DecisionBody({ item, desk, onDefer, onChanged }: { item: NeedsYouItem; desk: RpcStub<MatterDesk>; onDefer: () => void; onChanged: () => void }) {
  const options = item.options.length > 0 ? item.options : DEFAULT_OPTIONS
  const [choice, setChoice] = useState(() => options.find((o) => o === item.recommendation) ?? options[0])
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const { state, run } = useSubmit(onChanged)
  const busy = state.kind === 'busy'
  return (
    <div className="space-y-3">
      {item.detail && <Detail markdown={item.detail} />}
      {item.recommendation && (
        <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">Recommended: {item.recommendation}</p>
      )}
      <div className="space-y-0.5">
        {options.map((o) => (
          <RadioRow key={o} name={`needs-${item.id}`} value={o} checked={choice === o} onChange={setChoice} disabled={busy}>
            {o}
          </RadioRow>
        ))}
      </div>
      {declining ? (
        <div className="space-y-2">
          <WorkshopInputArea
            autoFocus
            rows={2}
            value={reason}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
            placeholder="Tell the firm why — it re-plans from your words."
            className="w-full"
          />
          <div className="flex justify-end gap-2">
            <WorkshopButton className="!h-8" onClick={() => setDeclining(false)} disabled={busy}>Cancel</WorkshopButton>
            <WorkshopButton tone="danger" className="!h-8" disabled={busy || !reason.trim()} onClick={() => void run(() => desk.declineItem(item.id, reason.trim()))}>
              {busy ? 'Working…' : 'Decline'}
            </WorkshopButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusLine state={state} />
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setDeclining(true)} disabled={busy} className="press cursor-pointer text-[12.5px] text-kumo-subtle hover:text-kumo-danger">Decline…</button>
            <WorkshopButton className="!h-8" onClick={onDefer} disabled={busy}>Decide later</WorkshopButton>
            <WorkshopButton tone="primary" className="!h-8" disabled={busy || state.kind === 'done'} onClick={() => void run(() => desk.answerDecision(item.id, choice))}>
              {busy ? 'Working…' : 'Continue'}
            </WorkshopButton>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The plan card: a document-grade artifact. Its phases (## headings of plan.md) preview as a todo
 * list; View plan opens the full plan in a right panel. Editing the plan from here awaits a
 * lawyer-side desk write on the contract; direct the counsel in Conversation for changes.
 */
function PlanBody({ item, desk, onDefer, onChanged }: { item: NeedsYouItem; desk: RpcStub<MatterDesk>; onDefer: () => void; onChanged: () => void }) {
  const [plan, setPlan] = useState<{ kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | { kind: 'ready'; content: string }>({ kind: 'loading' })
  const [open, setOpen] = useState(false)
  const { state, run } = useSubmit(onChanged)
  const busy = state.kind === 'busy'

  useEffect(() => {
    let cancelled = false
    desk
      .deskRead('plan.md')
      .then((r) => {
        if (!cancelled) setPlan(r ? { kind: 'ready', content: r.content } : { kind: 'missing' })
      })
      .catch(() => {
        if (!cancelled) setPlan({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [desk])

  const phases = plan.kind === 'ready' ? plan.content.split('\n').filter((l) => /^##\s+/.test(l)).map((l) => l.replace(/^##\s+/, '').trim()).slice(0, 8) : []
  const approve = () => void run(() => desk.answerDecision(item.id, 'Approve the plan — execute it'))

  return (
    <div className="space-y-3">
      {item.detail && <Detail markdown={item.detail} />}
      {plan.kind === 'ready' && phases.length > 0 && (
        <div>
          <p className="m-0 mb-1.5 text-[12px] text-kumo-subtle">{plural(phases.length, 'phase', 'phases')}</p>
          <ul className="m-0 list-none space-y-1 p-0">
            {phases.map((p) => (
              <li key={p} className="flex items-center gap-2 text-[13px] text-kumo-default">
                <span aria-hidden className="h-[13px] w-[13px] shrink-0 rounded-full border-[1.5px] border-kumo-interact" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.kind === 'missing' && <p className="m-0 text-[12.5px] text-kumo-subtle">The counsel hasn't written the plan yet — it lands here the moment it does.</p>}
      <StatusLine state={state} />
      <div className="grid grid-cols-2 gap-2">
        <WorkshopButton className="!h-9 justify-center" onClick={() => setOpen(true)}>View plan</WorkshopButton>
        <WorkshopButton tone="primary" className="!h-9 justify-center" disabled={busy || state.kind === 'done'} onClick={approve}>
          {busy ? 'Working…' : 'Approve plan'}
        </WorkshopButton>
      </div>
      <button type="button" onClick={onDefer} disabled={busy} className="press cursor-pointer text-[12.5px] text-kumo-subtle hover:text-kumo-default">Decide later</button>
      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="The execution plan"
        width={560}
        actions={
          <WorkshopButton tone="primary" className="!h-7" disabled={busy || state.kind === 'done'} onClick={approve}>
            Approve plan
          </WorkshopButton>
        }
      >
        {plan.kind === 'loading' && <div className="skeleton h-40" />}
        {plan.kind === 'missing' && <p className="m-0 text-[13px] text-kumo-subtle">The counsel hasn't written the plan yet — it lands here the moment it does.</p>}
        {plan.kind === 'failed' && <p className="m-0 text-[13px] text-kumo-subtle">The plan couldn't load. Close and try again.</p>}
        {plan.kind === 'ready' && <Detail markdown={plan.content} />}
        <p className="mt-4 mb-0 text-[12px] leading-[17px] text-kumo-inactive">To change the plan, tell the counsel in Conversation; it rewrites the plan and asks again.</p>
      </SlideOver>
    </div>
  )
}

/** APPROVE WHAT YOU SEE: the exact letter the client receives, in full. */
function OutreachBody({ item, desk, onDefer, onChanged }: { item: NeedsYouItem; desk: RpcStub<MatterDesk>; onDefer: () => void; onChanged: () => void }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const { state, run } = useSubmit(onChanged)
  const busy = state.kind === 'busy'
  return (
    <div className="space-y-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-kumo-subtle">Message to your client — sent exactly as shown</p>
      <div className="max-h-56 overflow-y-auto rounded-lg bg-kumo-tint/60 px-4 py-3">
        <Detail markdown={item.detail ?? item.title} />
      </div>
      <p className="m-0 text-[12px] leading-4 text-kumo-inactive">The firm is working ahead as if this goes out. Declining tells it to re-plan.</p>
      {declining ? (
        <div className="space-y-2">
          <WorkshopInputArea autoFocus rows={2} value={reason} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)} placeholder="Tell the firm why — it re-plans from your words." className="w-full" />
          <div className="flex justify-end gap-2">
            <WorkshopButton className="!h-8" onClick={() => setDeclining(false)} disabled={busy}>Cancel</WorkshopButton>
            <WorkshopButton tone="danger" className="!h-8" disabled={busy || !reason.trim()} onClick={() => void run(() => desk.declineItem(item.id, reason.trim()))}>
              {busy ? 'Working…' : 'Decline outreach'}
            </WorkshopButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusLine state={state} />
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setDeclining(true)} disabled={busy} className="press cursor-pointer text-[12.5px] text-kumo-subtle hover:text-kumo-danger">Decline…</button>
            <WorkshopButton className="!h-8" onClick={onDefer} disabled={busy}>Not now</WorkshopButton>
            <WorkshopButton tone="primary" className="!h-8" disabled={busy || state.kind === 'done'} onClick={() => void run(() => desk.releaseOutreach(item.id))}>
              {busy ? 'Working…' : 'Release & send'}
            </WorkshopButton>
          </div>
        </div>
      )}
    </div>
  )
}
