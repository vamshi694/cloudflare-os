import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { Deadline, MatterDesk } from '@gadgets/workshop-shared/legal'
import { CalendarBlank, Check } from '@phosphor-icons/react'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../WorkshopControls'
import { useDeskData } from './useMatterDesk'
import { plural, shortDate } from './labels'

const TONE: Record<Deadline['urgency'], string> = {
  overdue: 'border-kumo-danger/30 bg-kumo-danger-tint/50 text-kumo-danger',
  in_window: 'border-kumo-warning/35 bg-kumo-warning-tint/50 text-kumo-warning',
  later: 'border-kumo-line bg-kumo-base text-kumo-subtle',
}

function chipText(d: Deadline): string {
  if (d.daysLeft < 0) return `${d.title} · ${Math.abs(d.daysLeft)}d overdue`
  if (d.daysLeft === 0) return `${d.title} · today`
  return `${d.title} · ${shortDate(d.dueOn)} · ${d.daysLeft}d`
}

/** The static chip: the calendar's own tones, never a red the rail invents. */
export function DeadlineChipStatic({ d, compact = false }: { d: Deadline; compact?: boolean }) {
  return (
    <span className={`tnum inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] leading-4 font-medium ${TONE[d.urgency]}`}>
      <CalendarBlank size={12} />
      {compact ? `${shortDate(d.dueOn)} · ${d.daysLeft}d` : chipText(d)}
    </span>
  )
}

/**
 * The docket chip: the calendar's next date, and behind it the whole docket (list, add, mark met).
 * Renders nothing when the docket is genuinely empty; says so when it cannot be read.
 */
export function DeadlineChip({ desk, next }: { desk: RpcStub<MatterDesk>; next: Deadline | null }) {
  const [open, setOpen] = useState(false)
  const load = useCallback(() => desk.deadlines(), [desk])
  const { data, failed, reload } = useDeskData<Deadline[]>(open ? load : null, { deps: [open] })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = next ? chipText(next) : 'Docket'
  const tone = next ? TONE[next.urgency] : TONE.later

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={next ? 'The docket for this matter' : 'Nothing docketed yet'}
        className={`tnum press inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] leading-4 font-medium transition-colors ${tone}`}
      >
        <CalendarBlank size={12} />
        {label}
      </button>
      {open && (
        <div className="shadow-lift rise absolute right-0 z-30 mt-2 w-[340px] rounded-xl border border-kumo-line bg-kumo-base">
          <div className="border-b border-kumo-line px-4 py-2.5">
            <p className="docket m-0">The docket</p>
          </div>
          <div className="max-h-[300px] overflow-y-auto px-2 py-2">
            {data === null && !failed && <p className="m-0 px-2 py-2 text-[12.5px] text-kumo-subtle">Reading the docket…</p>}
            {data === null && failed && (
              <p className="m-0 px-2 py-2 text-[12.5px] text-kumo-subtle">
                The docket could not be read just now. Deadlines are unchanged; this is a display problem.
              </p>
            )}
            {data !== null && failed && (
              <p className="m-0 px-2 pb-1 text-[12px] italic text-kumo-subtle">Not updating right now — this list may be out of date.</p>
            )}
            {data !== null && data.length === 0 && <p className="m-0 px-2 py-2 text-[12.5px] text-kumo-subtle">Nothing docketed.</p>}
            {data !== null &&
              data.map((d) => <DeadlineRow key={d.id} d={d} desk={desk} onChanged={reload} />)}
          </div>
          <AddDeadline desk={desk} onAdded={reload} />
        </div>
      )}
    </div>
  )
}

function DeadlineRow({ d, desk, onChanged }: { d: Deadline; desk: RpcStub<MatterDesk>; onChanged: () => void }) {
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState(false)
  const met = async () => {
    setBusy(true)
    try {
      await desk.markDeadlineMet(d.id)
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to mark the deadline met:', err)
      toasts.add({ title: "That didn't save — the deadline is still open.", variant: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`flex items-start gap-2.5 rounded-lg px-2 py-2 ${d.met ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[13px] leading-[18px] text-kumo-default">{d.title}</p>
        <p className="tnum m-0 text-[11.5px] leading-4 text-kumo-inactive">
          {shortDate(d.dueOn)} · {d.met ? 'met' : d.daysLeft < 0 ? `${Math.abs(d.daysLeft)}d overdue` : `${d.daysLeft}d`} · {d.source}
        </p>
      </div>
      {!d.met && (
        <button
          type="button"
          onClick={() => void met()}
          disabled={busy}
          title="Mark met"
          className="press inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default disabled:opacity-50"
        >
          <Check size={13} />
        </button>
      )}
    </div>
  )
}

function AddDeadline({ desk, onAdded }: { desk: RpcStub<MatterDesk>; onAdded: () => void }) {
  const toasts = useKumoToastManager()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (!title.trim() || !date) return
    setBusy(true)
    try {
      await desk.addDeadline({ title: title.trim(), dueOn: date, kind: 'other' })
      setTitle('')
      setDate('')
      onAdded()
    } catch (err) {
      logRpcFailure('Failed to add a deadline:', err)
      toasts.add({ title: "That deadline wasn't saved. Nothing was docketed — try again.", variant: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-1.5 border-t border-kumo-line px-3 py-2.5">
      <WorkshopInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deadline" className="min-w-0 flex-1 !h-8" />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-8 rounded-md border border-kumo-line bg-kumo-base px-2 text-[12.5px] text-kumo-default"
        aria-label="Due on"
      />
      <WorkshopButton tone="primary" className="!h-8" onClick={() => void add()} disabled={busy || !title.trim() || !date}>
        {busy ? '…' : 'Add'}
      </WorkshopButton>
    </div>
  )
}

export function deadlineSummary(list: Deadline[]): string {
  const open = list.filter((d) => !d.met)
  return open.length === 0 ? 'Nothing open' : plural(open.length, 'open deadline', 'open deadlines')
}
