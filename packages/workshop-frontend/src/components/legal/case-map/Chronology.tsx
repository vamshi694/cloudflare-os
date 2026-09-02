import { useCallback } from 'react'
import type { RpcStub } from 'capnweb'
import type { Chronology as ChronologyView, MatterDesk } from '@gadgets/workshop-shared/legal'
import { EmptyLine, Notice } from '../primitives'
import { useDeskData } from '../useMatterDesk'

/**
 * THE CHRONOLOGY — every dated fact on the record in order, grouped by year, with the reader's
 * doubt shown as a word ("date uncertain"), never hidden. Undated facts are counted at the foot,
 * never placed on the line.
 */
export function Chronology({ desk }: { desk: RpcStub<MatterDesk> }) {
  const load = useCallback(() => desk.chronology(), [desk])
  const { data, failed } = useDeskData<ChronologyView>(load, { pollMs: 30000 })

  if (data === null) {
    if (failed) return <Notice title="The chronology couldn't be read just now." body="The record is unchanged — this view keeps retrying." />
    return <div className="skeleton h-[320px]" />
  }
  if (data.dated === 0) {
    return <EmptyLine title="No dated facts yet." body="Dates appear here as the firm reads documents that state when things happened." />
  }
  return (
    <div className="space-y-6">
      {failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      {data.years.map((y) => (
        <section key={y.year ?? 'undated'} className="grid gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
          <h3 className="tnum m-0 pt-1 text-[15px] font-semibold text-kumo-default">{y.year}</h3>
          <ol className="m-0 list-none space-y-2 border-l border-kumo-line p-0 pl-4">
            {y.entries.map((e) => (
              <li key={e.factId} className="relative">
                <span aria-hidden className={`absolute -left-[21px] top-[7px] h-2 w-2 rounded-full ${e.ambiguous ? 'border border-kumo-warning bg-kumo-base' : 'bg-kumo-default'}`} />
                <p className="m-0 text-[13.5px] leading-[20px] text-kumo-default">{e.statement}</p>
                <p className="m-0 text-[12px] leading-[18px] text-kumo-subtle">
                  <span className="tnum">{e.when}</span>
                  {e.ambiguous && <span className="ml-2 text-kumo-warning">date uncertain</span>}
                  <span className="mx-1.5">·</span>
                  {e.documentTitle}{e.page ? `, p. ${e.page}` : ''}
                </p>
                <blockquote className="m-0 mt-0.5 border-l-2 border-kumo-line pl-2 text-[12.5px] italic leading-[18px] text-kumo-subtle">“{e.quote}”</blockquote>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="tnum m-0 text-[11.5px] text-kumo-inactive">
        {data.dated} dated facts on the line · {data.undated} undated facts stay off it
      </p>
    </div>
  )
}
