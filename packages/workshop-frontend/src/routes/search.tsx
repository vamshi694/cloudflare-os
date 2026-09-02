// SEARCH ACROSS THE DESK — facts and documents from every matter on the lawyer's desk that
// mention the query, best first, each linking into its matter. A fact shows its verbatim quote,
// never a paraphrase; a document shows what the firm filed it as.

import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { LegalDesk, SearchResult } from '@gadgets/workshop-shared/legal'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { useDesk } from '../components/firm/useDesk'
import { WorkshopInput } from '../components/WorkshopControls'
import { EmptyLine, Notice, Pill, Skeleton, plural } from '../components/legal/primitives'
import { matterTitle } from '../components/legal/labels'

export const Route = createFileRoute('/search')({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
  }),
})

const mintLegalDesk = (api: RpcStub<AuthenticatedApi>) => api.getLegalDesk()

type State = { kind: 'idle' } | { kind: 'searching' } | { kind: 'failed' } | { kind: 'ready'; hits: SearchResult[]; query: string }

function SearchPage() {
  useDocumentTitle('Search')
  const { q } = Route.useSearch()
  const desk = useDesk<LegalDesk>(mintLegalDesk, 'search')
  const api = desk.kind === 'ready' ? desk.stub : null
  const [query, setQuery] = useState(q ?? '')
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    const term = query.trim()
    if (!api || term.length < 3) { setState({ kind: 'idle' }); return }
    let cancelled = false
    setState({ kind: 'searching' })
    const timer = window.setTimeout(() => {
      api.search(term, { limit: 60 })
        .then((hits) => { if (!cancelled) setState({ kind: 'ready', hits, query: term }) })
        .catch((err) => { logRpcFailure('Search failed:', err); if (!cancelled) setState({ kind: 'failed' }) })
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [api, query])

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 sm:px-10">
      <header className="px-3 pb-5 pt-6 sm:pt-10">
        <h1 className="text-[28px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default">Search</h1>
        <p className="mt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          Facts and documents across every matter on your desk. Every fact shows the words it rests on.
        </p>
        <div className="mt-4">
          <WorkshopInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A name, an award, a journal, a date…"
            className="w-full"
            autoFocus
            aria-label="Search the desk"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 px-3 pb-10">
        {desk.kind === 'failed' && <Notice title="Search couldn't be opened." body="Nothing has changed on any matter. Reload to try again." />}
        {desk.kind === 'disabled' && <Notice tone="info" title="Matters aren't turned on for this deployment." />}
        {state.kind === 'idle' && api && (
          <p className="m-0 text-[13px] leading-[18px] text-kumo-subtle">Type at least three characters.</p>
        )}
        {state.kind === 'searching' && <div className="space-y-2"><Skeleton className="h-[64px]" /><Skeleton className="h-[64px]" /></div>}
        {state.kind === 'failed' && <Notice title="The search didn't complete." body="Nothing has changed. Try again." />}
        {state.kind === 'ready' && state.hits.length === 0 && (
          <EmptyLine title={`Nothing on the desk mentions "${state.query}".`} body="The search reads the facts the firm drew from the record and the documents' titles. A document the firm has not read yet is not searchable." />
        )}
        {state.kind === 'ready' && state.hits.length > 0 && (
          <>
            <p className="m-0 mb-3 text-[12.5px] text-kumo-subtle">{plural(state.hits.length, 'hit', 'hits')} for "{state.query}"</p>
            <ul className="m-0 list-none divide-y divide-kumo-line rounded-xl border border-kumo-line bg-kumo-base p-0">
              {state.hits.map((h) => (
                <li key={`${h.kind}:${h.matterId}:${h.documentId}:${h.title}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={h.kind === 'document' ? 'ready' : 'neutral'}>{h.kind === 'document' ? 'Document' : 'Fact'}</Pill>
                    <Link to="/matter/$id" params={{ id: h.matterId }} search={{ tab: 'documents' }} className="text-[12.5px] text-kumo-subtle hover:underline">
                      {matterTitle(h.matterTitle, null)}
                    </Link>
                    {h.page !== null && <span className="text-[12px] text-kumo-inactive">p. {h.page}</span>}
                  </div>
                  <p className="m-0 mt-1 text-[14px] leading-5 text-kumo-default">{h.title}</p>
                  <p className="m-0 mt-1 border-l border-kumo-line pl-3 text-[13px] leading-[18px] text-kumo-subtle">
                    {h.kind === 'fact' ? `“${h.snippet}”` : h.snippet}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
