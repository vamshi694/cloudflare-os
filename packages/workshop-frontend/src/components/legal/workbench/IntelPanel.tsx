import { useEffect, useState } from 'react'
import type { PetitionSection } from '@gadgets/workshop-shared/legal'
import { WorkshopButton, WorkshopInputArea } from '../../WorkshopControls'
import { SEV_TONE, plural, reviewVerdict } from '../labels'
import { statusLabel } from './petition-utils'

/**
 * THE INTELLIGENCE PANEL — condensed on purpose: readiness, sources, the reviewer's actionable
 * notes and the rewrite box at a glance; everything explanatory one disclosure deeper. The two
 * verdicts are never blended: evidence in the record is the gate's; the score is the reviewer's,
 * reading as the officer will.
 */
export function IntelPanel({
  section,
  caseType,
  onRedraft,
}: {
  section: PetitionSection
  caseType: string | null
  onRedraft: (key: string, instruction: string, remember: boolean) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showExhibits, setShowExhibits] = useState(false)

  useEffect(() => {
    setText('')
    setRemember(false)
    setFailure(null)
    setShowAll(false)
  }, [section.key])

  const send = async (instruction: string) => {
    setBusy(true)
    setFailure(null)
    try {
      await onRedraft(section.key, instruction, remember)
      setText('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setFailure(msg ? `The redraft didn't start: ${msg}` : "The redraft didn't start. This section is unchanged — try again.")
    } finally {
      setBusy(false)
    }
  }

  const review = section.review
  const weaknesses = review?.weaknesses ?? []
  const shownWeak = showAll ? weaknesses : weaknesses.slice(0, 2)
  const undrafted = section.status !== 'drafted'

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div>
        <p className="m-0 text-[14px] font-medium text-kumo-default">{section.title}</p>
        <p className={`m-0 text-[12.5px] ${undrafted ? 'text-kumo-warning' : 'text-kumo-subtle'}`}>{statusLabel(section)}</p>
      </div>

      {section.status === 'drafting' && (
        <p className="m-0 rounded-lg bg-kumo-tint px-3 py-2 text-[12.5px] leading-[18px] text-kumo-default"><strong>The firm is rewriting this section.</strong> It lands here when the reviewer clears it.</p>
      )}

      <div className="space-y-2 rounded-xl border border-kumo-line px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-kumo-subtle">Evidence in the record</span>
          <span className={`text-[12.5px] font-medium ${section.evidence === 'sufficient' ? 'text-kumo-success' : 'text-kumo-warning'}`}>
            {section.evidence === 'sufficient' ? 'sufficient' : section.evidence === 'thin' ? 'thin — more needed' : 'nothing yet'}
          </span>
        </div>
        {review && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[12.5px] font-medium ${reviewVerdict(review.score).tone}`}>{reviewVerdict(review.score).label}</span>
              <span className="tnum text-[11.5px] text-kumo-subtle">{review.score}/100</span>
            </div>
            <div className="mt-1 h-[3px] w-full rounded-full bg-kumo-fill"><div className="h-full rounded-full bg-kumo-default/70" style={{ width: `${Math.max(2, Math.min(100, review.score))}%` }} /></div>
            {section.evidence === 'sufficient' && review.score < 60 && (
              <p className="m-0 mt-1.5 text-[11.5px] leading-4 text-kumo-subtle">These two disagree on purpose: the record supports this claim, but the reviewer — reading as the USCIS officer will — scores this draft's argument low. Its notes below name exactly what an examiner would seize on; each one is a one-tap redraft instruction.</p>
            )}
          </div>
        )}
      </div>

      {section.evidence === 'thin' && section.status === 'drafted' && (
        <p className="m-0 rounded-lg border border-kumo-warning/30 bg-kumo-warning-tint/40 px-3 py-2 text-[12.5px] leading-[18px] text-kumo-default"><strong>The evidence here is thin.</strong> The writing reads well, but the firm judges the underlying record insufficient for this section. The client request covers what would strengthen it.</p>
      )}

      {section.uncitedExhibits.length > 0 && (
        <div className="text-[12.5px] leading-[18px] text-kumo-subtle">
          {section.uncitedExhibits.length <= 8 || showExhibits ? (
            <p className="m-0">{plural(section.uncitedExhibits.length, 'exhibit is', 'exhibits are')} routed to this section but never cited in the draft (Exhibit {section.uncitedExhibits.join(', ')}). Mention in your feedback what should be argued.</p>
          ) : (
            <p className="m-0">{section.uncitedExhibits.length} exhibits are routed to this section but never cited in the draft (e.g. Exhibit {section.uncitedExhibits.slice(0, 3).join(', ')}…). <button type="button" onClick={() => setShowExhibits(true)} className="cursor-pointer underline">Show all</button> — or mention in your feedback what should be argued.</p>
          )}
        </div>
      )}

      {section.unverifiedQuotes.length > 0 && (
        <div className="rounded-lg border border-kumo-warning/30 bg-kumo-warning-tint/40 px-3 py-2 text-[12.5px] leading-[18px] text-kumo-default">
          <p className="m-0"><strong>{plural(section.unverifiedQuotes.length, 'quote', 'quotes')} couldn't be verified against the record.</strong> An export before this clears is stamped DRAFT.</p>
          <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
            {section.unverifiedQuotes.slice(0, 3).map((q, i) => (
              <li key={i} className="text-[12px] text-kumo-subtle">
                “{q.quote.length > 140 ? `${q.quote.slice(0, 140)}…` : q.quote}”{q.exhibitNo ? ` — cited to Exhibit ${q.exhibitNo}` : ''}
                {q.reason === 'wrong_exhibit' && q.foundIn ? ` (these words are in Exhibit ${q.foundIn})` : ''}
                {q.reason === 'unverifiable' ? ' (the cited document was only partially readable — not necessarily wrong)' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="docket m-0 mb-1.5">Your feedback</p>
        <WorkshopInputArea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell the firm how to rewrite this section…" className="w-full" disabled={busy} />
        <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] text-kumo-subtle">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-kumo-brand" />
          Remember for all {caseType ?? 'matters of this type'}
        </label>
        {failure && <p className="m-0 mt-1 text-[12px] text-kumo-danger">{failure}</p>}
        <WorkshopButton tone="primary" className="!h-8 mt-2" onClick={() => void send(text.trim())} disabled={busy || !text.trim()}>{busy ? 'Working…' : 'Redraft'}</WorkshopButton>
      </div>

      {section.builtFrom.length > 0 && (
        <div>
          <p className="docket m-0 mb-1.5">Built from</p>
          <div className="flex flex-wrap gap-1">
            {section.builtFrom.map((b) => (
              <span key={b.documentId} title={`${b.title}: ${plural(b.citedFacts, 'cited fact', 'cited facts')}`} className="max-w-full truncate rounded-full bg-kumo-tint px-2 py-0.5 text-[11.5px] text-kumo-default">{b.title}</span>
            ))}
          </div>
        </div>
      )}

      {weaknesses.length > 0 && (
        <div>
          <p className="docket m-0 mb-1.5">AI reviewer</p>
          <ul className="m-0 list-none space-y-2 p-0">
            {shownWeak.map((w, i) => (
              <li key={i} className="text-[12.5px] leading-[18px] text-kumo-default">
                <span className={`font-medium ${SEV_TONE[w.severity]}`}>{w.severity}</span> · {w.issue}
                <button type="button" onClick={() => void send(`Address the reviewer's note: ${w.issue}. ${w.fix}`)} disabled={busy} className="press ml-2 cursor-pointer rounded-full border border-kumo-line px-2 py-0.5 text-[11.5px] text-kumo-subtle hover:text-kumo-default disabled:opacity-50">Fix this</button>
              </li>
            ))}
          </ul>
          {weaknesses.length > 2 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="press mt-1.5 cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default">{showAll ? 'Show fewer' : `${weaknesses.length - 2} more notes`}</button>
          )}
        </div>
      )}

      {section.status === 'held' && (
        <div>
          <p className="docket m-0 mb-1.5 !text-kumo-warning">Why it's held</p>
          <p className="m-0 text-[12.5px] leading-[18px] text-kumo-default">Deliberate. The evidence is too thin to draft without weakening the petition. Requested from the client:</p>
          <ul className="m-0 mt-1 list-disc pl-4 text-[12.5px] leading-[18px] text-kumo-default">
            {section.heldReasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="m-0 mt-1 text-[12px] text-kumo-subtle">The firm drafts it automatically when the evidence arrives.</p>
        </div>
      )}
      {section.status === 'not_drafted' && (
        <div>
          <p className="docket m-0 mb-1.5">Why it isn't drafted</p>
          <p className="m-0 text-[12.5px] leading-[18px] text-kumo-default">The record doesn't yet support it. This section argues: {section.purpose}</p>
          <p className="m-0 mt-1 text-[12px] text-kumo-subtle">The firm drafts it automatically once the evidence lands, or tell it in Conversation to proceed anyway.</p>
        </div>
      )}

      <details className="text-[12.5px] leading-[18px] text-kumo-subtle">
        <summary className="cursor-pointer text-kumo-default">About this section</summary>
        <div className="mt-1.5 space-y-1.5">
          <p className="m-0">{section.purpose}</p>
          <p className="m-0">Maps to the “{section.criterion}” regulatory criterion.</p>
          {section.guidance && <p className="m-0">Your standing guidance: “{section.guidance}”</p>}
          <p className="m-0">Drafted from this matter's evidence and your firm's playbook. Every claim traces to the case record. Redrafts land as new versions in the filing history.</p>
          <p className="m-0">Tip: highlight any passage in the letter to give the firm feedback on exactly that text.</p>
        </div>
      </details>
    </div>
  )
}
