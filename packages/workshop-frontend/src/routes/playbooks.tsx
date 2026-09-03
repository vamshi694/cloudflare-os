import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { Exemplar, LearningRun, PlaybookChange, PlaybookDesk, PlaybookEntry, Precedent } from '@gadgets/workshop-shared/legal'
import { logRpcFailure } from '../rpcErrors'
import { WorkshopButton, WorkshopInput, WorkshopInputArea } from '../components/WorkshopControls'
import { useDocumentTitle } from '../useDocumentTitle'
import { useDesk, usePolled } from '../components/firm/useDesk'
import { CASE_TYPES, EmptyLine, Eyebrow, FieldLabel, Notice, Pill, SegmentedTabs, Skeleton, ThreeState, tidy, formatDate } from '../components/legal/primitives'

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

type View = 'playbook' | 'precedents' | 'learning'

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
              { key: 'precedents', label: 'Precedents' },
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
        ) : view === 'precedents' ? (
          <Precedents api={api} />
        ) : (
          <>
          <LearningRuns api={api} references={(list.data ?? []).filter((e) => e.category === 'reference')} />
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
          </>
        )}
      </div>
    </div>
  )
}

/**
 * TEACH THE FIRM from a reference filing: the attorney picks an exemplar from the library and
 * hands it to the counsel in the firm's conversation; the counsel proposes what the playbook
 * should learn as a diff to approve; the run's row here follows that decision and can undo it.
 */
function LearningRuns({ api, references }: { api: RpcStub<PlaybookDesk> | null; references: PlaybookEntry[] }) {
  const navigate = useNavigate()
  const readRuns = useCallback(() => (api ? api.learningRuns() : Promise.reject(new Error('no desk'))), [api])
  const runs = usePolled<LearningRun[]>(api ? readRuns : null, 20_000)
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const start = async () => {
    if (!api || !reference || busy) return
    setBusy('start')
    setNote(null)
    try {
      const { seed } = await api.startLearningRun(reference)
      runs.refresh()
      void navigate({ to: '/', search: { prompt: seed } })
    } catch (err) {
      logRpcFailure('Failed to start a learning run:', err)
      setNote(`The run didn't start: ${err instanceof Error ? err.message : 'try again'}. Nothing has changed.`)
    } finally {
      setBusy(null)
    }
  }

  const revert = async (id: string) => {
    if (!api || busy) return
    setBusy(id)
    setNote(null)
    try {
      await api.revertLearningRun(id)
      setNote('Reverted. The document is back to the text it had before the run.')
      runs.refresh()
    } catch (err) {
      logRpcFailure('Failed to revert a learning run:', err)
      setNote(`That didn't revert: ${err instanceof Error ? err.message : 'try again'}. The playbook is unchanged.`)
    } finally {
      setBusy(null)
    }
  }

  const STATUS: Record<LearningRun['status'], { label: string; tone: 'ready' | 'neutral' | 'warning' }> = {
    queued: { label: 'Handed to the counsel', tone: 'warning' },
    proposed: { label: 'Awaiting your approval', tone: 'warning' },
    adopted: { label: 'Adopted', tone: 'ready' },
    reverted: { label: 'Reverted', tone: 'neutral' },
    declined: { label: 'Declined', tone: 'neutral' },
  }

  return (
    <section className="mb-6 rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
      <Eyebrow>Learning runs</Eyebrow>
      <p className="m-0 mt-1 text-[12.5px] leading-4 text-kumo-subtle">
        Pick a reference filing from the library. The counsel reads it, compares it with the playbook, and proposes what to learn; you approve the exact change.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={reference} onChange={(e) => setReference(e.target.value)} disabled={!api || busy !== null} className="h-8 min-w-[240px] rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default">
          <option value="">Choose a reference filing…</option>
          {references.map((r) => <option key={r.slug} value={r.slug}>{r.title}</option>)}
        </select>
        <WorkshopButton className="!h-8" tone="primary" disabled={!api || !reference || busy !== null} onClick={() => void start()}>
          {busy === 'start' ? 'Starting…' : 'Start a run'}
        </WorkshopButton>
        {references.length === 0 && <span className="text-[12.5px] text-kumo-subtle">No reference filings in the library yet; add one under the Playbook.</span>}
      </div>
      {note && <p className="m-0 mt-2 text-[12.5px] leading-4 text-kumo-subtle">{note}</p>}
      <div className="mt-3">
        {runs.data === null ? (
          runs.failed ? <p className="m-0 text-[12.5px] italic text-kumo-subtle">The runs couldn&apos;t be read just now — this list may be out of date.</p> : <Skeleton className="h-[40px]" />
        ) : runs.data.length === 0 ? (
          <p className="m-0 text-[13px] text-kumo-subtle">No runs yet.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-kumo-line rounded-xl border border-kumo-line p-0">
            {runs.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="m-0 text-[13.5px] leading-5 text-kumo-default">{r.referenceTitle}</p>
                  <p className="m-0 mt-0.5 text-[12px] leading-4 text-kumo-subtle">
                    {r.summary ?? 'Nothing proposed yet.'}{r.changedSlug ? <> · <Link to="/playbooks/$slug" params={{ slug: r.changedSlug }} className="hover:underline">{r.changedSlug}</Link></> : null} · {r.startedBy} · {formatDate(r.startedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                  {r.status === 'adopted' && (
                    <WorkshopButton className="!h-7" disabled={busy !== null} onClick={() => void revert(r.id)}>{busy === r.id ? 'Reverting…' : 'Revert'}</WorkshopButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * THE PRECEDENT LIBRARY (WP-14): the firm's past filings, read into exemplar passages per criterion
 * the way the case type's playbook names them. The drafter quotes two of these for structure and
 * voice; they are never evidence.
 */
function Precedents({ api }: { api: RpcStub<PlaybookDesk> | null }) {
  const readPrecedents = useCallback(() => (api ? api.precedents() : Promise.reject(new Error('no desk'))), [api])
  const precedents = usePolled<Precedent[]>(api ? readPrecedents : null, 0)
  const [title, setTitle] = useState('')
  const [caseType, setCaseType] = useState(CASE_TYPES[0].value)
  const [outcome, setOutcome] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [browse, setBrowse] = useState(CASE_TYPES[0].value)
  const readExemplars = useCallback(() => (api ? api.exemplars(browse) : Promise.reject(new Error('no desk'))), [api, browse])
  const exemplars = usePolled<Exemplar[]>(api ? readExemplars : null, 0, [browse, precedents.data?.length])

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
    void f.text().then(setText)
  }

  const upload = async () => {
    if (!api || busy) return
    setBusy('upload')
    setNote(null)
    try {
      const p = await api.uploadPrecedent({ title, caseType, text, outcome: outcome || null })
      setNote(p.exemplars === 0
        ? `Added "${p.title}". No exemplar passages matched the ${p.caseType} playbook's criteria; the filing is still searchable and usable for Teach the firm.`
        : `Added "${p.title}" with ${p.exemplars} exemplar passage${p.exemplars === 1 ? '' : 's'}.`)
      setTitle(''); setOutcome(''); setText('')
      precedents.refresh()
    } catch (err) {
      logRpcFailure('Failed to upload a precedent:', err)
      setNote(`That didn't save: ${err instanceof Error ? err.message : 'try again'}. The library is unchanged.`)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (slug: string) => {
    if (!api || busy) return
    setBusy(slug)
    setNote(null)
    try {
      await api.removePrecedent(slug)
      precedents.refresh()
    } catch (err) {
      logRpcFailure('Failed to remove a precedent:', err)
      setNote(`That didn't remove: ${err instanceof Error ? err.message : 'try again'}.`)
    } finally {
      setBusy(null)
    }
  }

  const grouped = useMemo(() => {
    const by = new Map<string, Exemplar[]>()
    for (const e of exemplars.data ?? []) by.set(e.heading, [...(by.get(e.heading) ?? []), e])
    return [...by.entries()]
  }, [exemplars.data])

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <Eyebrow>Add a past filing</Eyebrow>
        <p className="m-0 mt-1 text-[12.5px] leading-4 text-kumo-subtle">
          Paste or upload the petition letter (markdown or plain text). The firm reads it into one passage per criterion it argued; the drafter quotes them for structure and voice, never for facts.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div><FieldLabel>Title</FieldLabel><WorkshopInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dr. Example, I-140 (2025)" /></div>
          <div>
            <FieldLabel>Case type</FieldLabel>
            <select value={caseType} onChange={(e) => setCaseType(e.target.value)} className="h-8 w-full rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default">
              {CASE_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div><FieldLabel hint="optional">Outcome</FieldLabel><WorkshopInput value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="approved · RFE then approved · denied" /></div>
        </div>
        <div className="mt-3">
          <FieldLabel>The filing</FieldLabel>
          <WorkshopInputArea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Paste the petition letter here, or choose a file below." />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={onFile} className="text-[12.5px] text-kumo-subtle" />
          <WorkshopButton className="!h-8" tone="primary" disabled={!api || busy !== null || !title.trim() || text.trim().length < 200} onClick={() => void upload()}>
            {busy === 'upload' ? 'Reading…' : 'Add to the library'}
          </WorkshopButton>
        </div>
        {note && <p className="m-0 mt-2 text-[12.5px] leading-4 text-kumo-subtle">{note}</p>}
      </section>

      <section>
        <Eyebrow>On file</Eyebrow>
        <div className="mt-2">
          {precedents.data === null ? (
            precedents.failed ? <p className="m-0 text-[12.5px] italic text-kumo-subtle">The precedents couldn&apos;t be read just now.</p> : <Skeleton className="h-[40px]" />
          ) : precedents.data.length === 0 ? (
            <EmptyLine title="No precedents yet" body="Add a past filing above. Its passages become the examples the drafter writes from." />
          ) : (
            <ul className="m-0 list-none divide-y divide-kumo-line rounded-xl border border-kumo-line bg-kumo-base p-0">
              {precedents.data.map((p) => (
                <li key={p.slug} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-[14px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">
                      <Link to="/playbooks/$slug" params={{ slug: p.slug }} className="truncate hover:underline">{p.title}</Link>
                      <Pill tone="neutral">{p.caseType}</Pill>
                      {p.outcome && <Pill tone={/denied|revok/i.test(p.outcome) ? 'warning' : 'ready'}>{p.outcome}</Pill>}
                    </p>
                    <p className="m-0 mt-0.5 text-[12px] leading-4 text-kumo-subtle">
                      {p.exemplars} exemplar passage{p.exemplars === 1 ? '' : 's'} · {p.uploadedBy} · {formatDate(p.uploadedAt)}
                    </p>
                  </div>
                  <WorkshopButton className="!h-7" disabled={busy !== null} onClick={() => void remove(p.slug)}>{busy === p.slug ? 'Removing…' : 'Remove'}</WorkshopButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Exemplars by criterion</Eyebrow>
          <select value={browse} onChange={(e) => setBrowse(e.target.value)} className="h-8 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default">
            {CASE_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="mt-2">
          {exemplars.data === null ? (
            exemplars.failed ? <p className="m-0 text-[12.5px] italic text-kumo-subtle">The exemplars couldn&apos;t be read just now.</p> : <Skeleton className="h-[40px]" />
          ) : grouped.length === 0 ? (
            <p className="m-0 text-[13px] text-kumo-subtle">No exemplar passages for {browse} yet.</p>
          ) : (
            <div className="space-y-4">
              {grouped.map(([heading, items]) => (
                <div key={heading}>
                  <p className="m-0 mb-1.5 text-[13px] leading-[18px] font-medium tracking-[-0.2px] text-kumo-default">{heading}</p>
                  <ul className="m-0 list-none divide-y divide-kumo-line rounded-xl border border-kumo-line bg-kumo-base p-0">
                    {items.map((e) => (
                      <li key={e.precedentSlug + e.heading} className="px-4 py-3">
                        <p className="m-0 text-[12px] leading-4 text-kumo-subtle">{e.precedentTitle}{e.outcome ? ` · ${e.outcome}` : ''}</p>
                        <p className="m-0 mt-1 whitespace-pre-wrap text-[13px] leading-5 text-kumo-default">{e.passage}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
