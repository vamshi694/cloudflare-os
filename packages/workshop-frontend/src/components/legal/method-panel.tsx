import { useCallback, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { RpcStub } from 'capnweb'
import type { MatterDesk, MatterMethod } from '@gadgets/workshop-shared/legal'
import { useDeskData } from './useMatterDesk'

/**
 * THE METHOD — what governs this matter: the playbook documents the counsel reads before it
 * advises or drafts (the case type's law, playbook and style, plus the firm-wide voice and
 * letter guides) and the standing rules the attorneys taught it. Each is a link into the Playbook,
 * so a lawyer who disagrees with how the firm argues can change the method, not just this matter.
 */
export function useMethod(desk: RpcStub<MatterDesk>, pollMs = 60000) {
  const load = useCallback(() => desk.method(), [desk])
  return useDeskData<MatterMethod>(load, { pollMs })
}

const CATEGORY_LABEL: Record<MatterMethod['documents'][number]['category'], string> = {
  'case-type': 'For this visa',
  firm: 'The whole firm',
  'work-type': 'Kinds of documents',
  reference: 'Reference filings',
}

export function MethodPanel({ desk }: { desk: RpcStub<MatterDesk> }) {
  const { data, failed } = useMethod(desk)
  const [showRules, setShowRules] = useState(false)

  if (data === null) {
    if (failed) {
      return (
        <div className="shadow-depth rounded-[14px] border border-kumo-line bg-kumo-base px-4 py-3.5">
          <p className="docket m-0">The method</p>
          <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">The firm&apos;s playbook couldn&apos;t be read just now. The counsel still works from it; this view keeps retrying.</p>
        </div>
      )
    }
    return <div className="skeleton h-[160px] w-full" />
  }

  if (!data.available) {
    return (
      <div className="shadow-depth rounded-[14px] border border-kumo-line bg-kumo-base px-4 py-3.5">
        <p className="docket m-0">The method</p>
        <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">The firm&apos;s playbook isn&apos;t connected on this deployment. The counsel works from the catalog alone until it is.</p>
      </div>
    )
  }

  const caseDocs = data.documents.filter((d) => d.category === 'case-type')
  const firmDocs = data.documents.filter((d) => d.category !== 'case-type')
  const rules = data.rules
  const shownRules = showRules ? rules : rules.slice(0, 3)

  return (
    <div className="shadow-depth rise divide-y divide-kumo-line rounded-[14px] border border-kumo-line bg-kumo-base">
      <section className="px-4 py-3.5">
        <p className="docket m-0">The method</p>
        {data.caseType === null ? (
          <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">Once the counsel commits a case type, its playbook and style guide govern this matter. The firm-wide guides apply already.</p>
        ) : caseDocs.length === 0 ? (
          <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">The firm has no playbook for {data.caseType} yet. The counsel works from the catalog; add one under Playbook.</p>
        ) : null}
        {caseDocs.length > 0 && <DocList label={CATEGORY_LABEL['case-type']} docs={caseDocs} />}
        {firmDocs.length > 0 && <DocList label={CATEGORY_LABEL.firm} docs={firmDocs} />}
        {failed && <p className="mt-2 mb-0 text-[11.5px] italic text-kumo-inactive">Not updating right now.</p>}
      </section>
      <section className="px-4 py-3.5">
        <p className="docket m-0">Standing rules</p>
        {rules.length === 0 ? (
          <p className="mt-2 mb-0 text-[12.5px] leading-[18px] text-kumo-subtle">None yet. Tick &ldquo;Remember for all&rdquo; on a redraft, or tell the counsel a rule, and it lands here and in the playbook.</p>
        ) : (
          <>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
              {shownRules.map((r, i) => (
                <li key={`${r.slug}-${i}`} className="text-[12.5px] leading-[18px] text-kumo-default">
                  <span>{r.rule}</span>
                  {r.why && <span className="text-kumo-inactive"> · {r.why}</span>}
                </li>
              ))}
            </ul>
            {rules.length > 3 && (
              <button type="button" onClick={() => setShowRules((s) => !s)} className="press mt-2 cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default">
                {showRules ? 'Show fewer' : `Show all ${rules.length}`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function DocList({ label, docs }: { label: string; docs: MatterMethod['documents'] }) {
  return (
    <div className="mt-2.5">
      <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-kumo-inactive">{label}</p>
      <ul className="m-0 mt-1 list-none space-y-1 p-0">
        {docs.map((d) => (
          <li key={d.slug} className="flex items-center gap-2">
            <Link to="/playbooks/$slug" params={{ slug: d.slug }} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-kumo-default hover:underline" title={d.title}>
              {d.title}
            </Link>
            {d.layer === 'personal' && <span className="shrink-0 rounded-full bg-kumo-warning-tint px-1.5 py-px text-[10.5px] text-kumo-warning">your copy</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The playbook passage a petition section follows, for the intelligence panel. */
export function SectionMethod({ desk, sectionKey }: { desk: RpcStub<MatterDesk>; sectionKey: string }) {
  const { data } = useMethod(desk)
  const [open, setOpen] = useState(false)
  if (!data || !data.available) return null
  const g = data.guidance.find((x) => x.key === sectionKey)
  const rules = data.rules
  if (!g && rules.length === 0) return null
  const doc = data.documents.find((d) => /-playbook$/.test(d.slug))
  const short = g ? (g.guidance.length > 520 && !open ? `${g.guidance.slice(0, 520).trimEnd()}…` : g.guidance) : null
  return (
    <div>
      <p className="docket m-0 mb-1.5">The firm&apos;s read of this section</p>
      {g ? (
        <div className="rounded-lg bg-kumo-tint px-3 py-2 text-[12.5px] leading-[18px] text-kumo-default">
          <p className="m-0 text-[11.5px] text-kumo-subtle">
            From{' '}
            {doc ? (
              <Link to="/playbooks/$slug" params={{ slug: doc.slug }} className="hover:underline">{doc.title}</Link>
            ) : (
              'the playbook'
            )}
            {' · '}{g.heading}
          </p>
          <p className="m-0 mt-1 whitespace-pre-wrap">{short}</p>
          {g.guidance.length > 520 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="press mt-1 cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default">
              {open ? 'Show less' : 'Read the whole passage'}
            </button>
          )}
        </div>
      ) : (
        <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">The playbook has no passage for this section; the counsel argues it from the criterion&apos;s purpose.</p>
      )}
      {rules.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-1 p-0">
          {rules.slice(0, 4).map((r, i) => (
            <li key={`${r.slug}-${i}`} className="text-[12px] leading-[17px] text-kumo-subtle">
              <span className="text-kumo-default">Rule:</span> {r.rule}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
