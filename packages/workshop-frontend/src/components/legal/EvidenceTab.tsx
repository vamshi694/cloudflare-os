import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { LegalFact, MatterDesk } from '@gadgets/workshop-shared/legal'
import { logRpcFailure } from '../../rpcErrors'
import {
  EmptyLine,
  Eyebrow,
  Skeleton,
  ThreeState,
  confidenceWord,
  formatDate,
  plural,
} from './primitives'

/** Facts arrive in pages; nothing is silently cut off — a full page offers the next one. */
const PAGE = 200

/**
 * THE EVIDENCE — every fact the firm drew from the record, each with its verbatim quote, grouped
 * by the document it came from. Confidence is a word, never a decimal.
 */
export function EvidenceTab({ desk }: { desk: RpcStub<MatterDesk> }) {
  const [facts, setFacts] = useState<LegalFact[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [moreAvailable, setMoreAvailable] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(
    async (offset: number) => {
      try {
        const page = await desk.facts({ limit: PAGE, offset })
        setFacts((prev) => (offset === 0 || prev === null ? page : [...prev, ...page]))
        setMoreAvailable(page.length === PAGE)
        setFailed(false)
      } catch (err) {
        logRpcFailure("Failed to load the matter's evidence:", err)
        setFailed(true)
      }
    },
    [desk],
  )

  useEffect(() => {
    setFacts(null)
    void load(0)
  }, [load])

  const handleMore = async () => {
    setLoadingMore(true)
    await load(facts?.length ?? 0)
    setLoadingMore(false)
  }

  return (
    <ThreeState
      items={facts}
      failed={failed}
      skeleton={
        <div className="space-y-2">
          <Skeleton className="h-[84px]" />
          <Skeleton className="h-[84px]" />
          <Skeleton className="h-[84px]" />
        </div>
      }
      neverLoaded={{
        title: "The evidence couldn't be read just now.",
        body: 'What the firm knows is unchanged — this is a display problem. Reload to try again.',
      }}
      stale="Not updating right now — showing the last view that loaded."
      empty={
        <EmptyLine
          title="No evidence yet."
          body="Facts appear here as the firm reads the matter's documents — each one with the passage it came from."
        />
      }
    >
      {(items) => (
        <div className="space-y-6">
          {groupByDocument(items).map((group) => (
            <section key={group.documentId}>
              <div className="mb-2 flex items-baseline gap-3 px-1">
                <Eyebrow>{group.title}</Eyebrow>
                <span
                  className="text-[11px] leading-4 font-semibold text-kumo-inactive"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {plural(group.facts.length, 'fact', 'facts')}
                </span>
              </div>
              <ul className="m-0 list-none divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line bg-kumo-base p-0">
                {group.facts.map((fact) => (
                  <FactRow key={fact.id} fact={fact} />
                ))}
              </ul>
            </section>
          ))}
          {moreAvailable && (
            <button
              type="button"
              onClick={() => void handleMore()}
              disabled={loadingMore}
              className="press inline-flex h-8 cursor-pointer items-center rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-elevated disabled:opacity-50"
            >
              {loadingMore ? 'Loading more…' : 'Show more facts'}
            </button>
          )}
        </div>
      )}
    </ThreeState>
  )
}

function groupByDocument(facts: LegalFact[]) {
  const groups: { documentId: string; title: string; facts: LegalFact[] }[] = []
  const index = new Map<string, number>()
  for (const fact of facts) {
    const at = index.get(fact.documentId)
    if (at === undefined) {
      index.set(fact.documentId, groups.length)
      groups.push({ documentId: fact.documentId, title: fact.documentTitle, facts: [fact] })
    } else {
      groups[at] = { ...groups[at], facts: [...groups[at].facts, fact] }
    }
  }
  return groups
}

function FactRow({ fact }: { fact: LegalFact }) {
  const meta: string[] = []
  if (fact.page !== null) meta.push(`p. ${fact.page}`)
  if (fact.occurredOn) meta.push(fact.dateAmbiguous ? `${formatDate(fact.occurredOn)} (date uncertain)` : formatDate(fact.occurredOn))
  meta.push(confidenceWord(fact.confidence))
  if (fact.verifiedBy) meta.push(`verified by ${fact.verifiedBy}`)

  return (
    <li className="px-4 py-3">
      <p className="m-0 text-[14px] leading-[21px] tracking-[-0.25px] text-kumo-default">
        {fact.statement}
      </p>
      {fact.quote.trim() !== '' && (
        <blockquote className="mt-2 mb-0 border-l-2 border-kumo-line pl-3 text-[13px] leading-[19px] tracking-[-0.2px] text-kumo-subtle">
          “{fact.quote}”
        </blockquote>
      )}
      <p
        className="mt-1.5 mb-0 text-[12px] leading-4 tracking-[-0.1px] text-kumo-inactive"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {meta.join(' · ')}
        {fact.significance && ` · ${fact.significance}`}
      </p>
    </li>
  )
}
