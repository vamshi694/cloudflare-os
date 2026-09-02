import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk } from '@gadgets/workshop-shared/legal'
import { MarkdownMessage } from '../../ChatInterface'
import styles from '../../ChatInterface.module.css'
import { logRpcFailure } from '../../rpcErrors'
import { EmptyLine, Eyebrow, Notice, Skeleton, ThreeState, relativeTime, tidy } from './primitives'

type DeskFile = { path: string; rev: number; updatedAt: string; updatedBy: string }

/** The firm's internal filing, restated as the lawyer reads it. */
export function deskFileLabel(path: string): string {
  if (path === 'plan.md') return 'The matter plan'
  const parts = path.replace(/\.md$/i, '').split('/').filter(Boolean)
  if (parts[0] === 'delegations' && parts.length >= 3) {
    return `${tidy(parts[1])} — ${tidy(parts.slice(2).join(' '))}`
  }
  return tidy(parts[parts.length - 1] ?? path)
}

type Group = 'plan' | 'notes' | 'delegations' | 'other'
const GROUP_ORDER: Group[] = ['plan', 'notes', 'delegations', 'other']
const GROUP_LABEL: Record<Group, string> = {
  plan: 'The plan',
  notes: 'Notes',
  delegations: 'Delegated work',
  other: 'Other files',
}

function groupOf(path: string): Group {
  if (path === 'plan.md') return 'plan'
  if (path.startsWith('delegations/')) return 'delegations'
  if (path.startsWith('notes/') || /note/i.test(path)) return 'notes'
  return 'other'
}

/**
 * THE DESK — the attorney's read-only window into the workspace the agents work on: the living
 * plan, working notes, and each specialist's full work product. Transparency, not control;
 * directing the work happens in Conversation.
 */
export function DeskTab({ desk }: { desk: RpcStub<MatterDesk> }) {
  const [files, setFiles] = useState<DeskFile[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    desk
      .deskFiles()
      .then((list) => {
        if (cancelled) return
        setFiles(list)
        setFailed(false)
        // The plan opens by default when it exists.
        setSelected((cur) => cur ?? (list.some((f) => f.path === 'plan.md') ? 'plan.md' : list[0]?.path ?? null))
      })
      .catch((err) => {
        logRpcFailure('Failed to list the matter desk:', err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [desk])

  return (
    <ThreeState
      items={files}
      failed={failed}
      skeleton={
        <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[320px]" />
        </div>
      }
      neverLoaded={{
        title: 'The desk could not be loaded right now.',
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
        <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="Desk files" className="space-y-4">
            {GROUP_ORDER.map((group) => {
              const inGroup = items.filter((f) => groupOf(f.path) === group)
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
                            className={[
                              'flex w-full cursor-pointer flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors',
                              active ? 'bg-kumo-fill' : 'hover:bg-kumo-tint',
                            ].join(' ')}
                          >
                            <span
                              className={`w-full truncate text-[13px] leading-[18px] tracking-[-0.25px] ${
                                active ? 'font-medium text-kumo-strong' : 'text-kumo-default'
                              }`}
                            >
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
            {selected ? (
              <DeskReader key={selected} desk={desk} path={selected} />
            ) : (
              <EmptyLine title="Pick a file to read." />
            )}
          </div>
        </div>
      )}
    </ThreeState>
  )
}

function DeskReader({ desk, path }: { desk: RpcStub<MatterDesk>; path: string }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'failed' } | { kind: 'missing' } | { kind: 'ready'; content: string }
  >({ kind: 'loading' })

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
    <article className="rounded-xl border border-kumo-line bg-kumo-base px-6 py-5">
      <h2 className="m-0 mb-3 text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">
        {deskFileLabel(path)}
      </h2>
      {state.kind === 'loading' && <p className="m-0 text-[13px] text-kumo-subtle">Loading the desk…</p>}
      {state.kind === 'failed' && (
        <Notice
          title="This file could not be read right now."
          body="The file itself is unchanged — try another, or reload."
        />
      )}
      {state.kind === 'missing' && (
        <p className="m-0 text-[13px] text-kumo-subtle">This file is no longer on the desk.</p>
      )}
      {state.kind === 'ready' && (
        <div className={`min-w-0 text-[14px] leading-[1.7] text-kumo-default ${styles.markdownContent}`}>
          <MarkdownMessage message={state.content} />
        </div>
      )}
    </article>
  )
}
