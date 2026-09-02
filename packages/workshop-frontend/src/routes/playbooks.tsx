import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { PlaybookChange, PlaybookDesk, PlaybookEntry } from '@gadgets/workshop-shared/legal'
import { useDocumentTitle } from '../useDocumentTitle'
import { useDesk, usePolled } from '../components/firm/useDesk'
import { EmptyLine, Eyebrow, Notice, Pill, SegmentedTabs, Skeleton, ThreeState, tidy, formatDate } from '../components/legal/primitives'

export const Route = createFileRoute('/playbooks')({
  component: PlaybooksPage,
})

const mintPlaybookDesk = (api: RpcStub<AuthenticatedApi>) => api.getPlaybookDesk()

const CATEGORY_LABEL: Record<PlaybookEntry['category'], string> = {
  firm: 'The whole firm',
  'case-type': 'By visa category',
  'work-type': 'Kinds of documents',
  reference: 'Reference filings',
}
const CATEGORY_ORDER: PlaybookEntry['category'][] = ['case-type', 'firm', 'work-type', 'reference']

type View = 'playbook' | 'learning'

/**
 * THE PLAYBOOK — how this firm practices, one document at a time: the law and criteria per visa,
 * the drafting playbook, the petition style, the house voice, the standing rules the attorneys
 * taught it. Teach the firm is the ledger of what it learned.
 */
function PlaybooksPage() {
  useDocumentTitle('Playbook')
  const desk = useDesk<PlaybookDesk>(mintPlaybookDesk, 'the playbooks')
  const api = desk.kind === 'ready' ? desk.stub : null
  const [view, setView] = useState<View>('playbook')

  const readList = useCallback(() => (api ? api.list() : Promise.reject(new Error('no desk'))), [api])
  const readChanges = useCallback(() => (api ? api.changes(100) : Promise.reject(new Error('no desk'))), [api])
  const list = usePolled<PlaybookEntry[]>(api ? readList : null, 0)
  const changes = usePolled<PlaybookChange[]>(api && view === 'learning' ? readChanges : null, 0, [view])

  const grouped = useMemo(() => {
    if (!list.data) return null
    const byCat = new Map<PlaybookEntry['category'], Map<string, PlaybookEntry[]>>()
    for (const e of list.data) {
      const scopes = byCat.get(e.category) ?? new Map<string, PlaybookEntry[]>()
      const arr = scopes.get(e.scope) ?? []
      scopes.set(e.scope, [...arr, e])
      byCat.set(e.category, scopes)
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      scopes: [...byCat.get(c)!.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }))
  }, [list.data])

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 sm:px-10">
      <header className="px-3 pb-5 pt-6 sm:pt-10">
        <h1 className="text-[28px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default">Playbook</h1>
        <p className="mt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          How this firm practices. The counsel reads these before it advises or drafts; your edits are your own copy
          until an admin makes them the firm&apos;s.
        </p>
        <div className="mt-4">
          <SegmentedTabs<View>
            ariaLabel="Playbook views"
            value={view}
            onChange={setView}
            tabs={[
              { key: 'playbook', label: 'Playbook' },
              { key: 'learning', label: 'Teach the firm' },
            ]}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 px-3 pb-10">
        {desk.kind === 'disabled' ? (
          <Notice
            tone="info"
            title="The firm's playbooks aren't turned on for this deployment."
            body="The firm gatekeeper is disabled. Nothing is lost — an admin can enable it under Gatekeepers."
          />
        ) : desk.kind === 'failed' ? (
          <Notice title="The playbooks couldn't be opened." body="Nothing has changed in the firm's method. Reload to try again." />
        ) : view === 'playbook' ? (
          <ThreeState
            items={grouped}
            failed={list.failed}
            skeleton={
              <div className="space-y-3">
                <Skeleton className="h-[56px]" />
                <Skeleton className="h-[56px]" />
                <Skeleton className="h-[56px]" />
              </div>
            }
            neverLoaded={{
              title: "The playbooks couldn't be loaded.",
              body: "This is a display problem — the firm's method is unchanged. Reload to try again.",
            }}
            stale="Not updating right now — showing the last view that loaded."
            empty={<EmptyLine title="No playbooks yet" body="The firm's library is empty. Documents appear here once the firm's method is installed." />}
          >
            {(groups) => (
              <div className="space-y-8">
                {groups.map((g) => (
                  <section key={g.category}>
                    <Eyebrow>{CATEGORY_LABEL[g.category]}</Eyebrow>
                    <div className="mt-2 space-y-5">
                      {g.scopes.map(([scope, entries]) => (
                        <div key={scope || '(firm)'}>
                          {scope && (
                            <p className="m-0 mb-1.5 text-[13px] leading-[18px] font-medium tracking-[-0.2px] text-kumo-default">
                              {scope}
                            </p>
                          )}
                          <ul className="m-0 list-none divide-y divide-kumo-line rounded-xl border border-kumo-line bg-kumo-base p-0">
                            {entries.map((e) => (
                              <li key={e.slug}>
                                <Link
                                  to="/playbooks/$slug"
                                  params={{ slug: e.slug }}
                                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-kumo-tint"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="m-0 flex flex-wrap items-center gap-2 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">
                                      <span className="truncate">{e.title}</span>
                                      {e.layer === 'personal' && <Pill tone="warning">your copy</Pill>}
                                    </p>
                                    {e.description && (
                                      <p className="m-0 mt-0.5 line-clamp-2 text-[12.5px] leading-4 text-kumo-subtle">{e.description}</p>
                                    )}
                                  </div>
                                  <span className="shrink-0 text-[11.5px] leading-5 text-kumo-inactive" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {formatDate(e.updatedAt)}
                                  </span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </ThreeState>
        ) : (
          <ThreeState
            items={changes.data}
            failed={changes.failed}
            skeleton={
              <div className="space-y-3">
                <Skeleton className="h-[44px]" />
                <Skeleton className="h-[44px]" />
              </div>
            }
            neverLoaded={{
              title: "The learning ledger couldn't be loaded.",
              body: "Nothing the firm learned is lost. Reload to try again.",
            }}
            stale="Not updating right now — showing the last view that loaded."
            empty={
              <EmptyLine
                title="The firm hasn't learned anything yet"
                body="When you give the counsel standing guidance on a kind of matter and agree to keep it, the rule lands here and in the playbook."
              />
            }
          >
            {(items) => (
              <ul className="m-0 list-none divide-y divide-kumo-line rounded-xl border border-kumo-line bg-kumo-base p-0">
                {items.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                    <Pill tone={c.kind === 'learn' ? 'ready' : 'neutral'}>{c.kind === 'learn' ? 'Learned' : tidy(c.kind)}</Pill>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[13.5px] leading-5 text-kumo-default">{c.summary}</p>
                      <p className="m-0 mt-0.5 text-[12px] leading-4 text-kumo-subtle">
                        <Link to="/playbooks/$slug" params={{ slug: c.slug }} className="hover:underline">
                          {c.slug}
                        </Link>{' '}
                        · {c.by} · {formatDate(c.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ThreeState>
        )}
      </div>
    </div>
  )
}
