import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, MatterDirective, MemoryNote } from '@gadgets/workshop-shared/legal'
import { MarkdownMessage } from '../../ChatInterface'
import styles from '../../ChatInterface.module.css'
import { logRpcFailure } from '../../rpcErrors'
import { EmptyLine, Eyebrow, Notice, Skeleton, ThreeState, relativeTime } from './primitives'
import { useDeskData } from './useMatterDesk'
import { tidy } from './labels'

type DeskFile = { path: string; rev: number; updatedAt: string; updatedBy: string }

/** The firm's internal filing, restated as the lawyer reads it. */
export function deskFileLabel(path: string): string {
  if (path === 'plan.md') return 'The matter plan'
  const parts = path.replace(/\.md$/i, '').split('/').filter(Boolean)
  if (parts[0] === 'delegations' && parts.length >= 3) {
    return `${tidy(parts[1])} — ${tidy(parts.slice(2).join(' '))}`
  }
  // A specialist's work product: delegations/<role>-<scope>.md ("drafter-awards" → "Drafter · Awards").
  if (parts[0] === 'delegations' && parts.length === 2) {
    const role = ['gap-analyst', 'forms-filler', 'letter-writer', 'drafter', 'officer'].find((r) => parts[1] === r || parts[1].startsWith(`${r}-`))
    if (role) {
      const scope = parts[1].slice(role.length + 1)
      const roleLabel = role === 'officer' ? "Officer's review" : tidy(role)
      return scope && scope !== 'matter' ? `${roleLabel} · ${tidy(scope)}` : roleLabel
    }
  }
  return tidy(parts[parts.length - 1] ?? path)
}

type Group = 'plan' | 'notes' | 'delegations' | 'deliverables' | 'other'
const GROUP_ORDER: Group[] = ['plan', 'notes', 'delegations', 'deliverables', 'other']
const GROUP_LABEL: Record<Group, string> = {
  plan: 'The plan',
  notes: 'Notes',
  delegations: 'Delegated work',
  deliverables: 'Written by the firm',
  other: 'Other files',
}

export function deskGroupOf(path: string): Group {
  if (path === 'plan.md') return 'plan'
  if (path.startsWith('delegations/')) return 'delegations'
  if (path.startsWith('deliverables/')) return 'deliverables'
  if (path.startsWith('notes/') || /note/i.test(path)) return 'notes'
  return 'other'
}

/**
 * THE DESK — the attorney's read-only window into the workspace the agents work on: the living
 * plan, working notes, and each specialist's full work product. Transparency, not control;
 * directing the work happens in Conversation.
 */
export function DeskTab({ desk }: { desk: RpcStub<MatterDesk> }) {
  const load = useCallback(() => desk.deskFiles(), [desk])
  const { data: files, failed } = useDeskData<DeskFile[]>(load, { pollMs: 10000 })
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!files) return
    setSelected((cur) => (cur && files.some((f) => f.path === cur) ? cur : files.some((f) => f.path === 'plan.md') ? 'plan.md' : files[0]?.path ?? null))
  }, [files])

  return (
    <div className="space-y-6">
    <ProcessPanels desk={desk} />
    <ThreeState
      items={files}
      failed={failed}
      skeleton={
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[320px]" />
        </div>
      }
      neverLoaded={{
        title: 'The workspace could not be loaded right now.',
        body: "The firm's working files are unchanged — this is a display problem. Reload to try again.",
      }}
      stale="Not updating right now — showing the last view that loaded."
      empty={
        <EmptyLine
          title="Nothing on the desk yet."
          body="As the firm works this matter, its plan, working notes, and each specialist's full work product will appear here — the work itself, not just the reports."
        />
      }
    >
      {(items) => (
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Desk files" className="space-y-4">
            {GROUP_ORDER.map((group) => {
              const inGroup = items.filter((f) => deskGroupOf(f.path) === group)
              if (inGroup.length === 0) return null
              return (
                <div key={group}>
                  <div className="mb-1.5 px-1">
                    <Eyebrow>{GROUP_LABEL[group]}</Eyebrow>
                  </div>
                  <ul className="m-0 list-none space-y-0.5 p-0">
                    {inGroup.map((file) => {
                      const active = file.path === selected
                      return (
                        <li key={file.path}>
                          <button
                            type="button"
                            onClick={() => setSelected(file.path)}
                            className={`flex w-full cursor-pointer flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors ${active ? 'bg-kumo-fill' : 'hover:bg-kumo-tint'}`}
                          >
                            <span className={`w-full truncate text-[13px] leading-[18px] tracking-[-0.25px] ${active ? 'font-medium text-kumo-strong' : 'text-kumo-default'}`}>
                              {deskFileLabel(file.path)}
                            </span>
                            <span className="text-[11.5px] leading-4 text-kumo-inactive">
                              {tidy(file.updatedBy)} · {relativeTime(file.updatedAt)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </nav>
          <div className="min-w-0">
            {selected ? <DeskReader key={selected} desk={desk} path={selected} /> : <EmptyLine title="Pick a file to read." />}
          </div>
        </div>
      )}
    </ThreeState>
    </div>
  )
}

/**
 * WP-8: the two things on the desk the attorney writes, not just reads. Standing directives are
 * instructions the counsel reads every turn on this matter alone; memory notes are what the firm
 * keeps outside the record (never evidence). Both are plain rows: add, read, withdraw.
 */
function ProcessPanels({ desk }: { desk: RpcStub<MatterDesk> }) {
  const loadDirectives = useCallback(() => desk.directives(), [desk])
  const loadNotes = useCallback(() => desk.memoryNotes(), [desk])
  const directives = useDeskData<MatterDirective[]>(loadDirectives, { pollMs: 20000 })
  const notes = useDeskData<MemoryNote[]>(loadNotes, { pollMs: 20000 })
  const [directiveText, setDirectiveText] = useState('')
  const [scope, setScope] = useState<MatterDirective['scope']>('matter')
  const [noteText, setNoteText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    setFailure(null)
    try {
      await work()
    } catch (err) {
      logRpcFailure(`Desk write failed (${key}):`, err)
      setFailure(`That didn't save: ${err instanceof Error ? err.message : 'try again'}. Nothing has changed.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-[14px] border border-kumo-line bg-kumo-base px-5 py-4">
        <Eyebrow>Standing directives</Eyebrow>
        <p className="m-0 mt-1 text-[12.5px] leading-4 text-kumo-subtle">The counsel reads these every turn on this matter. They outrank the playbook here and nowhere else.</p>
        {directives.data === null ? (
          directives.failed ? <p className="m-0 mt-2 text-[12.5px] italic text-kumo-subtle">The directives couldn&apos;t be read just now. Nothing has changed.</p> : <Skeleton className="mt-2 h-[40px]" />
        ) : directives.data.length === 0 ? (
          <p className="m-0 mt-2 text-[13px] text-kumo-subtle">None yet.</p>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {directives.data.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 rounded-lg border border-kumo-line px-3 py-2">
                <div className="min-w-0">
                  <p className="m-0 text-[13.5px] leading-5 text-kumo-default">{d.text}</p>
                  <p className="m-0 mt-0.5 text-[11.5px] leading-4 text-kumo-inactive">{tidy(d.scope)} · {d.createdBy} · {relativeTime(d.createdAt)}</p>
                </div>
                <button type="button" disabled={busy !== null} onClick={() => void run(`d:${d.id}`, async () => { await desk.removeDirective(d.id); directives.reload() })} className="shrink-0 cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default hover:underline disabled:opacity-40">
                  {busy === `d:${d.id}` ? 'Withdrawing…' : 'Withdraw'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <textarea value={directiveText} onChange={(e) => setDirectiveText(e.target.value)} rows={2} placeholder="e.g. Do not draft the awards section until the client sends the selection letter." className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-[13.5px] leading-5 text-kumo-default outline-none focus:border-kumo-ring" disabled={busy !== null} />
          <div className="flex flex-wrap items-center gap-2">
            <select value={scope} onChange={(e) => setScope(e.target.value as MatterDirective['scope'])} disabled={busy !== null} className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default">
              <option value="matter">The whole matter</option>
              <option value="drafting">Drafting</option>
              <option value="client">The client</option>
              <option value="evidence">Evidence</option>
            </select>
            <button type="button" disabled={busy !== null || !directiveText.trim()} onClick={() => void run('add-directive', async () => { await desk.addDirective(directiveText, scope); setDirectiveText(''); directives.reload() })} className="press inline-flex h-8 cursor-pointer items-center rounded-lg bg-kumo-brand px-3 text-[13px] font-medium text-white disabled:opacity-40">
              {busy === 'add-directive' ? 'Saving…' : 'Give the directive'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[14px] border border-kumo-line bg-kumo-base px-5 py-4">
        <Eyebrow>Memory notes</Eyebrow>
        <p className="m-0 mt-1 text-[12.5px] leading-4 text-kumo-subtle">What the firm keeps on this matter outside the record: judgments, preferences, things to remember. Never evidence.</p>
        {notes.data === null ? (
          notes.failed ? <p className="m-0 mt-2 text-[12.5px] italic text-kumo-subtle">The notes couldn&apos;t be read just now. Nothing has changed.</p> : <Skeleton className="mt-2 h-[40px]" />
        ) : notes.data.length === 0 ? (
          <p className="m-0 mt-2 text-[13px] text-kumo-subtle">Nothing noted yet.</p>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {notes.data.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 rounded-lg border border-kumo-line px-3 py-2">
                <div className="min-w-0">
                  <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-5 text-kumo-default">{n.text}</p>
                  <p className="m-0 mt-0.5 text-[11.5px] leading-4 text-kumo-inactive">{n.createdBy === 'agent' ? 'the counsel' : 'you'} · {relativeTime(n.createdAt)}</p>
                </div>
                <button type="button" disabled={busy !== null} onClick={() => void run(`n:${n.id}`, async () => { await desk.removeMemoryNote(n.id); notes.reload() })} className="shrink-0 cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default hover:underline disabled:opacity-40">
                  {busy === `n:${n.id}` ? 'Dropping…' : 'Drop'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} placeholder="e.g. The client prefers email over the portal; his co-author is unreachable until March." className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-[13.5px] leading-5 text-kumo-default outline-none focus:border-kumo-ring" disabled={busy !== null} />
          <div>
            <button type="button" disabled={busy !== null || !noteText.trim()} onClick={() => void run('add-note', async () => { await desk.addMemoryNote(noteText); setNoteText(''); notes.reload() })} className="press inline-flex h-8 cursor-pointer items-center rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default hover:bg-kumo-elevated disabled:opacity-40">
              {busy === 'add-note' ? 'Saving…' : 'Keep the note'}
            </button>
          </div>
        </div>
      </section>
      {failure && <p className="m-0 text-[12.5px] leading-4 text-kumo-danger lg:col-span-2">{failure}</p>}
    </div>
  )
}

export function DeskReader({ desk, path }: { desk: RpcStub<MatterDesk>; path: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'failed' } | { kind: 'missing' } | { kind: 'ready'; content: string }>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    desk
      .deskRead(path)
      .then((result) => {
        if (cancelled) return
        setState(result ? { kind: 'ready', content: result.content } : { kind: 'missing' })
      })
      .catch((err) => {
        logRpcFailure('Failed to read a desk file:', err)
        if (!cancelled) setState({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [desk, path])

  return (
    <article className="shadow-depth rounded-[14px] border border-kumo-line bg-kumo-base px-6 py-5">
      <h2 className="m-0 mb-3 text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">{deskFileLabel(path)}</h2>
      {state.kind === 'loading' && <p className="m-0 text-[13px] text-kumo-subtle">Loading the desk…</p>}
      {state.kind === 'failed' && <Notice title="This file could not be read right now." body="The file itself is unchanged — try another, or reload." />}
      {state.kind === 'missing' && <p className="m-0 text-[13px] text-kumo-subtle">This file is no longer on the desk.</p>}
      {state.kind === 'ready' && (
        <div className={`min-w-0 text-[14px] leading-[1.7] text-kumo-default ${styles.markdownContent}`}>
          <MarkdownMessage message={state.content} />
        </div>
      )}
    </article>
  )
}
