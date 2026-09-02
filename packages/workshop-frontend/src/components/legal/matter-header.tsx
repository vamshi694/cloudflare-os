import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, MatterOverviewView } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { ArrowLeft, Pause, Play } from '@phosphor-icons/react'
import { logRpcFailure } from '../../rpcErrors'
import { WorkshopButton } from '../WorkshopControls'
import { LegalDialog, Pill, StatusDot, type DotTone } from './primitives'
import { TextShimmer } from './ui/motion'
import { DeadlineChip } from './deadline-chip'
import { PHASE_LABEL, caseTypeLabel, matterTitle, narrateLane, plural } from './labels'

export function BackLink() {
  return (
    <Link
      to="/matters"
      className="inline-flex items-center gap-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle transition-colors hover:text-kumo-default"
    >
      <ArrowLeft size={13} />
      Matters
    </Link>
  )
}

/**
 * The status row: one row, two truths. The narration says what the firm is DOING (left), the
 * docket chip says what the CALENDAR holds (right). Priority ladder on the left: paused → stale →
 * phase/narrative.
 */
function statusOf(view: MatterOverviewView, stale: boolean): { tone: DotTone; text: string; working: boolean } {
  if (view.status === 'paused') return { tone: 'paused', text: 'Paused. The firm is standing down until you resume', working: false }
  if (view.status === 'closed') return { tone: 'quiet', text: 'Closed', working: false }
  if (stale) return { tone: 'quiet', text: 'This view is paused — showing the last state that loaded', working: false }
  const line = view.statusLine
  if (line) {
    // A lane in flight narrates itself from the record's counts ("Reading 12 of 40 documents"),
    // never from a timer; the activity line and the phase label follow when nothing is running.
    const lane = narrateLane(line.lane ?? null)
    const text = lane || line.narrative?.trim() || PHASE_LABEL[line.phase] || 'Up to date'
    const working = line.working || lane !== null
    return { tone: working ? 'working' : line.phase === 'review' || line.phase === 'clearance' ? 'needsYou' : 'quiet', text, working }
  }
  if (view.record.reading > 0 || view.record.stillArriving) {
    const n = view.record.reading
    return { tone: 'working', text: n > 0 ? `Reading ${plural(n, 'document', 'documents')}` : 'Documents still arriving', working: true }
  }
  if (view.record.failed > 0) {
    return { tone: 'paused', text: `${plural(view.record.failed, 'document needs', 'documents need')} a clearer copy`, working: false }
  }
  return { tone: 'quiet', text: 'Up to date', working: false }
}

export function MatterHeader({
  desk,
  overview,
  stale,
  loadedAt,
  onChanged,
}: {
  desk: RpcStub<MatterDesk>
  overview: MatterOverviewView
  stale: boolean
  loadedAt: number | null
  onChanged: () => void
}) {
  const status = statusOf(overview, stale)
  const needs = overview.needsYouItems?.length ?? overview.needsYou.openDecisions + overview.needsYou.unreadableDocuments
  const staleMinutes = loadedAt ? Math.max(1, Math.round((Date.now() - loadedAt) / 60_000)) : null

  return (
    <header>
      <BackLink />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="m-0 truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] text-kumo-default">
              {matterTitle(overview.title, overview.caseType)}
            </h1>
            <Pill>{caseTypeLabel(overview.caseType)}</Pill>
            <NeedsYouBell count={needs} />
          </div>
          <p className="mt-0.5 mb-0 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">{overview.clientName}</p>
        </div>
        <KillSwitch desk={desk} paused={overview.status === 'paused'} onChanged={onChanged} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 flex min-w-0 items-center gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
          <StatusDot tone={status.tone} className={status.working ? 'breathe' : ''} />
          {status.working ? <TextShimmer>{status.text}</TextShimmer> : <span className={overview.status === 'paused' ? 'text-kumo-warning' : ''}>{status.text}</span>}
        </p>
        <DeadlineChip desk={desk} next={overview.statusLine?.nextDeadline ?? null} />
      </div>

      {stale && (
        <p className="mt-2 mb-0 text-[12.5px] leading-[18px] italic tracking-[-0.2px] text-kumo-subtle">
          This view is paused — the firm is still working on the server (heavy reading slows the screen, never the
          work). Showing the state from {staleMinutes ? plural(staleMinutes, 'minute', 'minutes') : 'a moment'} ago; it
          reconnects by itself.
        </p>
      )}
    </header>
  )
}

/**
 * THE OPT-IN, NOT A PROMPT ON LOAD. The count pill plus a "Notify me" offer that appears only while
 * permission is undecided; the number sitting next to the offer is what explains why to turn it on.
 */
export function NeedsYouBell({ count }: { count: number }) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  if (count === 0 && permission !== 'default') return null
  const ask = async () => {
    if (typeof Notification === 'undefined') return
    try {
      setPermission(await Notification.requestPermission())
    } catch {
      /* the browser refused to ask; the offer stays */
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      {count > 0 && (
        <span aria-live="polite">
          <Pill tone="needsYou">{count === 1 ? '1 needs you' : `${count} need you`}</Pill>
        </span>
      )}
      {permission === 'default' && count > 0 && (
        <button
          type="button"
          onClick={() => void ask()}
          className="press cursor-pointer text-[12px] leading-4 text-kumo-subtle underline-offset-2 hover:text-kumo-default hover:underline"
        >
          Notify me
        </button>
      )}
    </span>
  )
}

export function KillSwitch({
  desk,
  paused,
  onChanged,
}: {
  desk: RpcStub<MatterDesk>
  paused: boolean
  onChanged: () => void
}) {
  const toasts = useKumoToastManager()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (paused) setConfirming(false)
  }, [paused])

  const set = async (status: 'open' | 'paused') => {
    setBusy(true)
    try {
      await desk.setStatus(status)
      setConfirming(false)
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to change the matter status:', err, { reportSite: 'legal.setStatus' })
      toasts.add({
        title:
          status === 'paused'
            ? "Couldn't stop the firm — it is still working. Try again."
            : "Couldn't resume the firm — it is still paused. Try again.",
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  if (paused) {
    return (
      <button
        type="button"
        onClick={() => void set('open')}
        disabled={busy}
        className="press inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-kumo-warning/35 bg-kumo-warning-tint/60 px-3 text-[13px] font-medium text-kumo-warning transition-colors hover:bg-kumo-warning-tint disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play size={13} />
        {busy ? 'Resuming…' : 'Resume the firm'}
      </button>
    )
  }

  return (
    <>
      <WorkshopButton className="shrink-0 gap-1.5" onClick={() => setConfirming(true)} disabled={busy}>
        <Pause size={13} />
        Stop all work
      </WorkshopButton>
      <LegalDialog
        open={confirming}
        busy={busy}
        onOpenChange={setConfirming}
        title="Stop all work on this matter?"
        description="Agents halt immediately. Nothing is lost, and you can resume anytime."
        footer={
          <>
            <WorkshopButton className="!h-9" onClick={() => setConfirming(false)} disabled={busy}>
              Keep working
            </WorkshopButton>
            <WorkshopButton tone="danger" className="!h-9" onClick={() => void set('paused')} disabled={busy}>
              {busy ? 'Stopping…' : 'Stop all work'}
            </WorkshopButton>
          </>
        }
      />
    </>
  )
}
