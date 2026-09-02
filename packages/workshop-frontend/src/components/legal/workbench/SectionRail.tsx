import type { Petition } from '@gadgets/workshop-shared/legal'
import { StatusDot } from '../primitives'
import { AnimatedNumber } from '../ui/motion'
import { plural, reviewVerdict } from '../labels'
import { draftedCount, highRiskCount, overallScore, pageRanges, totalPages, weakest } from './petition-utils'

/**
 * THE DOSSIER COVER: the rail opens like a case file — typewriter docket line, then the letter's
 * live size (a spring odometer: as the firm reshapes the letter the page count physically settles
 * to its new value), the whole-letter verdict, the filing actions, workspace files, and a real
 * table of contents with dotted leaders and start pages. Contents is the one internally-scrolling
 * region, so the filing actions are ALWAYS on screen.
 */
export function SectionRail({
  petition,
  activeKey,
  onSelect,
  onOpenDirective,
  onOpenHistory,
  onOpenRfe,
  onExport,
  exporting,
  deliverables,
  onOpenDeliverable,
}: {
  petition: Petition
  activeKey: string | null
  onSelect: (key: string) => void
  onOpenDirective: () => void
  onOpenHistory: () => void
  onOpenRfe: () => void
  onExport: () => void
  exporting: boolean
  deliverables: { path: string; updatedAt: string }[]
  onOpenDeliverable: (path: string) => void
}) {
  const { drafted, total } = draftedCount(petition)
  const pages = totalPages(petition.sections)
  const ranges = pageRanges(petition.sections)
  const score = overallScore(petition)
  const risky = highRiskCount(petition)
  const weak = weakest(petition)

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div>
        <p className="docket m-0">Matter workspace</p>
        <button type="button" onClick={onOpenDirective} className="press mt-1 cursor-pointer text-left text-[13.5px] leading-5 text-kumo-default hover:underline" title="Set a target length or a standing instruction">
          <span className="tnum">{drafted} of {total} sections</span> · ≈ <AnimatedNumber value={pages} /> {pages === 1 ? 'page' : 'pages'} ▾
        </button>
        {pages >= 20 && !petition.directive && (
          <p className="m-0 mt-1 text-[11.5px] leading-4 text-kumo-subtle">Too long? Click the page count and set a target. The firm reshapes the whole letter. Or just tell it in Conversation.</p>
        )}
        {petition.directive && (
          <p className="m-0 mt-1 truncate text-[11.5px] leading-4 text-kumo-subtle" title={petition.directive.text}>
            Standing: {petition.directive.targetPages ? `target ≈${petition.directive.targetPages} pages` : 'no target'}{petition.directive.text ? ` · “${petition.directive.text}”` : ''}
          </p>
        )}
      </div>

      {score !== null && (
        <div className="rounded-xl border border-kumo-line bg-kumo-base px-3 py-2.5">
          <p className="docket m-0">The whole letter</p>
          <p className={`m-0 mt-1 text-[13px] font-medium ${reviewVerdict(score).tone}`}>{reviewVerdict(score).label}</p>
          <p className="tnum m-0 text-[12px] text-kumo-subtle">{plural(risky, 'point', 'points')} an officer would seize on</p>
          {weak.length > 0 && (
            <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0">
              {weak.map((s) => (
                <li key={s.key}>
                  <button type="button" onClick={() => onSelect(s.key)} className="press cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default">↓ {s.title}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <p className="docket m-0 mb-1.5">The filing</p>
        <div className="space-y-1">
          <button type="button" disabled title="The filing-ready packet (cover, contents, letter, approved forms, every numbered exhibit) is assembled server-side; that binder is not wired on this deployment yet." className="w-full cursor-not-allowed rounded-lg border border-kumo-line px-3 py-1.5 text-left text-[12.5px] text-kumo-inactive">
            Download the USCIS packet (PDF) · not yet
          </button>
          <button type="button" onClick={onExport} disabled={exporting} title="The letter alone, as Markdown." className="press w-full cursor-pointer rounded-lg border border-kumo-line px-3 py-1.5 text-left text-[12.5px] text-kumo-default hover:bg-kumo-tint disabled:opacity-60">
            {exporting ? 'Preparing the letter…' : 'Letter (Markdown)'}
          </button>
          <button type="button" onClick={onOpenHistory} className="press w-full cursor-pointer rounded-lg border border-kumo-line px-3 py-1.5 text-left text-[12.5px] text-kumo-default hover:bg-kumo-tint">Filing history</button>
          <button type="button" onClick={onOpenRfe} className="press w-full cursor-pointer rounded-lg border border-kumo-line px-3 py-1.5 text-left text-[12.5px] text-kumo-default hover:bg-kumo-tint">Simulate the RFE</button>
        </div>
      </div>

      {deliverables.length > 0 && (
        <div>
          <p className="docket m-0 mb-1.5">Workspace files</p>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {deliverables.map((d) => (
              <li key={d.path}>
                <button type="button" onClick={() => onOpenDeliverable(d.path)} className="press w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-[12.5px] text-kumo-default hover:bg-kumo-tint">
                  {d.path.replace(/^deliverables\//, '').replace(/\.md$/, '')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <p className="docket m-0 mb-1.5">Contents</p>
        <ol className="m-0 max-h-[40vh] list-none space-y-1 overflow-y-auto p-0">
          {petition.sections.map((s) => {
            const r = ranges.get(s.key)
            const active = s.key === activeKey
            return (
              <li key={s.key}>
                <button type="button" onClick={() => onSelect(s.key)} className={`flex w-full cursor-pointer items-end gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] ${active ? 'bg-kumo-fill text-kumo-default' : 'text-kumo-default hover:bg-kumo-tint'}`}>
                  <StatusDot tone={s.status === 'drafting' ? 'working' : s.status === 'drafted' ? 'ready' : s.status === 'held' ? 'paused' : 'hollow'} className={`mb-1 ${s.status === 'drafting' ? 'breathe' : ''} ${s.status === 'drafted' ? '!bg-kumo-contrast' : ''}`} />
                  <span className="min-w-0 truncate">{s.title}</span>
                  <span aria-hidden className="mb-1 min-w-3 flex-1 border-b border-dotted border-kumo-interact" />
                  <span className="tnum shrink-0 text-kumo-inactive">{r ? r.start : '—'}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
