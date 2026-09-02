import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, Readiness } from '@gadgets/workshop-shared/legal'
import { useDeskData } from './useMatterDesk'
import { plural } from './labels'

/**
 * THE CASE AT A GLANCE — the conversation tab's quiet right rail. Only what a lawyer acts on: which
 * sections of THIS visa have thin or missing evidence, and what to get from the client. No scores,
 * no counts, no lists of things that are fine. ONE JUDGMENT PER SIGNAL: the sufficiency gate is THE
 * evidence verdict; this rail never adds a heuristic of its own.
 */
export function CaseGlance({
  desk,
  onOpenPetition,
  pollMs = 15000,
}: {
  desk: RpcStub<MatterDesk>
  onOpenPetition: () => void
  pollMs?: number
}) {
  const load = useCallback(() => desk.readiness(), [desk])
  const { data, failed } = useDeskData<Readiness>(load, { pollMs })
  const [showAll, setShowAll] = useState(false)

  if (data === null) {
    if (failed) return null
    return <div className="skeleton h-[220px] w-full" />
  }
  const sections = data.sections.filter((s) => s.key)
  if (sections.length === 0 && data.gate === 'undecided') {
    return (
      <div className="shadow-depth rise rounded-[14px] border border-kumo-line bg-kumo-base px-4 py-4">
        <p className="docket m-0">The case at a glance</p>
        <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">
          The counsel has not committed a case type yet. Once it does, this rail shows which sections the record supports.
        </p>
      </div>
    )
  }
  const needy = sections.filter((s) => s.evidence !== 'sufficient')
  const stillNeeded = data.stillNeeded
  const shownNeeds = showAll ? stillNeeded : stillNeeded.slice(0, 4)

  return (
    <div className="shadow-depth rise divide-y divide-kumo-line rounded-[14px] border border-kumo-line bg-kumo-base">
      <section className="px-4 py-3.5">
        <p className="docket m-0">Evidence by section</p>
        {needy.length === 0 ? (
          <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">Every section is well supported.</p>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {sections.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    s.evidence === 'sufficient' ? 'bg-kumo-success' : s.evidence === 'thin' ? 'bg-kumo-warning' : 'border border-kumo-interact'
                  }`}
                />
                <span className={`min-w-0 flex-1 truncate text-[13.5px] ${s.evidence === 'none' ? 'text-kumo-subtle' : 'text-kumo-default'}`}>{s.title}</span>
                {s.evidence !== 'sufficient' && (
                  <span className="shrink-0 text-[11.5px] text-kumo-inactive">{s.evidence === 'none' ? 'nothing yet' : 'needs more'}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {failed && <p className="mt-2 mb-0 text-[11.5px] italic text-kumo-inactive">Not updating right now.</p>}
      </section>
      <section className="px-4 py-3.5">
        <p className="docket m-0">Still needed from the client</p>
        {stillNeeded.length === 0 ? (
          <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">Nothing outstanding.</p>
        ) : (
          <>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
              {shownNeeds.map((n) => (
                <li key={n} className="flex items-start gap-2 text-[12.5px] leading-[18px] text-kumo-default">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-kumo-warning" />
                  <span className="min-w-0">{n}</span>
                </li>
              ))}
            </ul>
            {stillNeeded.length > 4 && (
              <button type="button" onClick={() => setShowAll((s) => !s)} className="press mt-2 cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default">
                {showAll ? 'Show fewer' : `Show all ${stillNeeded.length}`}
              </button>
            )}
          </>
        )}
      </section>
      <section className="px-4 py-3">
        <button
          type="button"
          onClick={onOpenPetition}
          className="press h-8 w-full cursor-pointer rounded-lg border border-kumo-line text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-tint"
        >
          Open the petition
        </button>
        {data.gate !== 'undecided' && (
          <p className="tnum mt-2 mb-0 text-center text-[11.5px] text-kumo-inactive">
            {plural(data.sufficient, 'section', 'sections')} sufficient of {data.required} required
          </p>
        )}
      </section>
    </div>
  )
}
