// THE FIRM INBOX — everything waiting on the lawyer, across every matter on their desk: the
// plan approvals, outreach to release, decisions, documents the firm could not read, and the
// queued actions the counsel staged in each matter's conversation. The same cards as the matter's
// needs-you block, so an answer here is the same answer there.
//
// An empty queue means "nothing needs you" — the most reassuring sentence on the screen. It must
// never be what a failed fetch looks like, so a matter whose queue could not be read is named.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { ActionLogEntry, AuthenticatedApi, Overseer } from '@gadgets/workshop-shared/api'
import type { FirmInbox, InboxItem, LegalDesk, MatterDesk, MatterListEntry } from '@gadgets/workshop-shared/legal'
import { useAuthenticatedApi } from '../AuthContext'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { useDesk, usePolled } from '../components/firm/useDesk'
import { NeedsYou } from '../components/legal/needs-you'
import { WorkshopButton } from '../components/WorkshopControls'
import { EmptyLine, Eyebrow, Notice, Pill, Skeleton, plural, relativeTime } from '../components/legal/primitives'
import { matterTitle } from '../components/legal/labels'

export const Route = createFileRoute('/inbox')({ component: InboxPage })

const mintLegalDesk = (api: RpcStub<AuthenticatedApi>) => api.getLegalDesk()
const POLL_MS = 15_000

type PendingAction = Extract<ActionLogEntry, { type: 'action' }>

function InboxPage() {
  useDocumentTitle('Inbox')
  const desk = useDesk<LegalDesk>(mintLegalDesk, 'the inbox')
  const api = desk.kind === 'ready' ? desk.stub : null
  const readInbox = useCallback(() => (api ? api.inbox() : Promise.reject(new Error('no desk'))), [api])
  const readMatters = useCallback(() => (api ? api.listMatters() : Promise.reject(new Error('no desk'))), [api])
  const inbox = usePolled<FirmInbox>(api ? readInbox : null, POLL_MS)
  const matters = usePolled<MatterListEntry[]>(api ? readMatters : null, 60_000)

  const byMatter = useMemo(() => {
    if (!inbox.data) return null
    const groups = new Map<string, { matterId: string; matterTitle: string; caseType: string | null; items: InboxItem[] }>()
    for (const it of inbox.data.items) {
      const g = groups.get(it.matterId) ?? { matterId: it.matterId, matterTitle: it.matterTitle, caseType: it.caseType, items: [] }
      g.items.push(it)
      groups.set(it.matterId, g)
    }
    return [...groups.values()]
  }, [inbox.data])

  const total = inbox.data?.items.length ?? 0

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 sm:px-10">
      <header className="px-3 pb-5 pt-6 sm:pt-10">
        <h1 className="text-[28px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default">Inbox</h1>
        <p className="mt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          Everything waiting on you, across every matter. Answer here or on the matter; it is the same answer.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-6 px-3 pb-10">
        {desk.kind === 'disabled' && (
          <Notice tone="info" title="Matters aren't turned on for this deployment." body="The Matters gatekeeper is disabled. An admin can enable it under The firm → Platform." />
        )}
        {desk.kind === 'failed' && (
          <Notice title="The inbox couldn't be opened." body="Nothing has changed on any matter. Reload to try again." />
        )}
        {api && inbox.data === null && (
          inbox.failed
            ? <Notice title="What needs you couldn't be checked just now — this list may be out of date." body="It keeps retrying. Nothing has changed on any matter." />
            : <div className="space-y-3"><Skeleton className="h-[72px]" /><Skeleton className="h-[72px]" /></div>
        )}
        {api && inbox.data !== null && (
          <>
            {inbox.failed && <Notice tone="stale" title="Not updating right now — showing the last view that loaded." />}
            {inbox.data.unreachable.length > 0 && (
              <Notice
                tone="stale"
                title={`Not checked: ${inbox.data.unreachable.map((u) => matterTitle(u.matterTitle, null)).join(', ')} — this list may be incomplete.`}
                body="Those matters' queues could not be read just now. It keeps retrying."
              />
            )}
            <p className="m-0 text-[13px] leading-[18px] text-kumo-subtle">
              {total === 0 ? 'Nothing needs you right now.' : `${plural(total, 'item', 'items')} waiting · checked ${relativeTime(inbox.data.readAt)}`}
            </p>
            {byMatter && byMatter.length === 0 && inbox.data.unreachable.length === 0 && (
              <EmptyLine title="Nothing needs you right now." body="Decisions, approvals and releases land here the moment a matter raises them." />
            )}
            {byMatter?.map((g) => (
              <MatterGroup key={g.matterId} desk={api} group={g} workspaceId={matters.data?.find((m) => m.id === g.matterId)?.workspaceId ?? null} onChanged={() => inbox.refresh()} />
            ))}
            {matters.data && (
              <PendingActions
                matters={matters.data.filter((m) => m.workspaceId && !byMatter?.some((g) => g.matterId === m.id))}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** One matter's queue, with the same cards the matter screen shows, plus its staged actions. */
function MatterGroup({ desk, group, workspaceId, onChanged }: {
  desk: RpcStub<LegalDesk>
  group: { matterId: string; matterTitle: string; caseType: string | null; items: InboxItem[] }
  workspaceId: string | null
  onChanged: () => void
}) {
  const [matter, setMatter] = useState<{ stub: RpcStub<MatterDesk> } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let stub: RpcStub<MatterDesk> | null = null
    desk.openMatter(group.matterId)
      .then((s) => {
        if (cancelled) { s[Symbol.dispose]?.(); return }
        stub = s
        setMatter({ stub: s })
      })
      .catch((err) => {
        logRpcFailure('Failed to open a matter for the inbox:', err)
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true; stub?.[Symbol.dispose]?.() }
  }, [desk, group.matterId])

  return (
    <section className="rounded-2xl border border-kumo-line bg-kumo-base px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link to="/matter/$id" params={{ id: group.matterId }} className="flex min-w-0 items-center gap-2 text-[15px] leading-5 font-semibold tracking-[-0.3px] text-kumo-default hover:underline">
          <span className="truncate">{matterTitle(group.matterTitle, group.caseType)}</span>
          <Pill tone="neutral">{group.caseType ?? 'Strategy pending'}</Pill>
        </Link>
        <span className="text-[12.5px] text-kumo-subtle">{plural(group.items.length, 'item', 'items')}</span>
      </div>
      {failed && <Notice title="This matter's queue couldn't be opened." body="Open the matter to answer there; nothing has changed." />}
      {!failed && !matter && <Skeleton className="h-[56px]" />}
      {matter && (
        <NeedsYou
          desk={matter.stub}
          items={group.items}
          onChanged={onChanged}
          onOpenDocuments={() => { window.location.assign(`/matter/${group.matterId}?tab=documents`) }}
        />
      )}
      {workspaceId && <ActionQueue workspaceId={workspaceId} />}
    </section>
  )
}

/** Matters with no needs-you items may still hold staged actions in their conversation. */
function PendingActions({ matters }: { matters: MatterListEntry[] }) {
  if (matters.length === 0) return null
  return (
    <section className="space-y-3">
      <Eyebrow>Awaiting your release</Eyebrow>
      {matters.map((m) => (
        <div key={m.id} className="rounded-2xl border border-kumo-line bg-kumo-base px-5 py-3">
          <Link to="/matter/$id" params={{ id: m.id }} className="text-[14px] font-medium text-kumo-default hover:underline">{matterTitle(m.title, m.caseType)}</Link>
          <ActionQueue workspaceId={m.workspaceId!} quietWhenEmpty />
        </div>
      ))}
    </section>
  )
}

/**
 * The queued actions the counsel staged in a matter's conversation (a playbook change, an outward
 * act), released or declined in place. The overseer is opened for the read and disposed after.
 */
function ActionQueue({ workspaceId, quietWhenEmpty = false }: { workspaceId: string; quietWhenEmpty?: boolean }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const overseerRef = useRef<RpcStub<Overseer> | null>(null)
  const [entries, setEntries] = useState<PendingAction[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      if (!overseerRef.current) overseerRef.current = authenticatedApi.openGadget(workspaceId)
      const page = await overseerRef.current.listActions({ filter: 'pending' })
      setEntries(page.entries.filter((e): e is PendingAction => e.type === 'action'))
      setFailed(false)
    } catch (err) {
      logRpcFailure('Failed to list pending actions:', err)
      setFailed(true)
    }
  }, [authenticatedApi, workspaceId])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    return () => {
      window.clearInterval(id)
      overseerRef.current?.[Symbol.dispose]?.()
      overseerRef.current = null
    }
  }, [load])

  const decide = async (id: number, approve: boolean) => {
    if (!overseerRef.current || busy !== null) return
    setBusy(id)
    setNote(null)
    try {
      if (approve) await overseerRef.current.approveAction(id)
      else await overseerRef.current.rejectAction(id)
      setNote(approve ? 'Released — the firm is acting on it.' : 'Declined. The counsel re-plans from here.')
      await load()
    } catch (err) {
      logRpcFailure('Failed to decide an action:', err)
      setNote(`That didn't go through: ${err instanceof Error ? err.message : 'try again'}.`)
    } finally {
      setBusy(null)
    }
  }

  if (entries === null) {
    return failed ? <p className="m-0 mt-2 text-[12.5px] italic text-kumo-subtle">Staged actions couldn't be checked just now — this list may be incomplete.</p> : null
  }
  if (entries.length === 0) return quietWhenEmpty ? <p className="m-0 mt-1 text-[12.5px] text-kumo-subtle">Nothing staged.</p> : null

  return (
    <ul className="m-0 mt-3 list-none space-y-2 p-0">
      {entries.map((e) => (
        <li key={e.id} className="rounded-xl border border-kumo-line bg-kumo-elevated px-4 py-3">
          <p className="m-0 text-[13.5px] leading-5 font-medium text-kumo-default">{e.description.title}</p>
          <p className="m-0 mt-1 whitespace-pre-wrap text-[13px] leading-[18px] text-kumo-subtle">{e.description.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <WorkshopButton className="!h-8" tone="primary" disabled={busy !== null} onClick={() => void decide(e.id, true)}>
              {busy === e.id ? 'Working…' : 'Release'}
            </WorkshopButton>
            <WorkshopButton className="!h-8" disabled={busy !== null} onClick={() => void decide(e.id, false)}>Decline</WorkshopButton>
            <span className="text-[12px] text-kumo-inactive">{e.resourceTitle} · {relativeTime(new Date(e.createdAt).toISOString())}</span>
          </div>
        </li>
      ))}
      {note && <li className="text-[12.5px] leading-4 text-kumo-subtle">{note}</li>}
    </ul>
  )
}
