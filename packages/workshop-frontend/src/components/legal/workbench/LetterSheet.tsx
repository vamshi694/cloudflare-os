import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Petition, PetitionSection } from '@gadgets/workshop-shared/legal'
import { MarkdownMessage } from '../../../ChatInterface'
import styles from '../../../ChatInterface.module.css'
import { WorkshopButton, WorkshopInputArea } from '../../WorkshopControls'
import { petitionTitle } from '../labels'
import { bodyWithoutTitle, linkExhibits, pageRanges, statusLabel } from './petition-utils'

/**
 * THE LETTER SHEET — paper, not a card. The filing frame renders exactly as the exported letter;
 * every bracketed token is the attorney's to fill before filing. The active section carries the
 * only left stripe in the app, and it is on paper. While the firm rewrites a section its prose
 * recedes under a soft sweep; the new draft materializes once.
 */
export function LetterSheet({
  petition,
  activeKey,
  onSelect,
  onExhibit,
  onFeedback,
}: {
  petition: Petition
  activeKey: string | null
  onSelect: (key: string) => void
  onExhibit: (n: number) => void
  onFeedback: (key: string, quote: string, instruction: string) => Promise<void>
}) {
  const ranges = pageRanges(petition.sections)
  const [selection, setSelection] = useState<{ key: string; quote: string; x: number; y: number } | null>(null)
  const sheet = useRef<HTMLDivElement>(null)

  const onMouseUp = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!sel || text.length < 8 || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    const sectionEl = node?.closest('[data-section-key]') as HTMLElement | null
    if (!sectionEl) return
    const rect = range.getBoundingClientRect()
    setSelection({ key: sectionEl.dataset.sectionKey!, quote: text, x: rect.left + rect.width / 2, y: rect.bottom + 8 })
  }

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest('a[href^="#exhibit-"]') as HTMLAnchorElement | null
    if (a) {
      e.preventDefault()
      const n = Number(a.getAttribute('href')!.replace('#exhibit-', ''))
      if (Number.isFinite(n)) onExhibit(n)
    }
  }

  return (
    <div ref={sheet} className="paper mx-auto max-w-[850px] space-y-12 rounded-[4px] border border-kumo-line px-8 py-12 sm:px-16 sm:py-16" onMouseUp={onMouseUp} onClick={onClick}>
      <div className="space-y-4 text-[14.5px] leading-[1.6]">
        <p className="m-0"><span className="ph-mark">[LETTERHEAD]</span></p>
        <p className="m-0"><span className="ph-mark">[DATE]</span></p>
        <p className="m-0">USCIS<br /><span className="ph-mark">[SERVICE CENTER ADDRESS]</span></p>
        <p className="m-0"><strong><u>Re: {petitionTitle(petition.caseType)}</u></strong><br />Petitioner / Beneficiary: <span className="ph-mark">[BENEFICIARY]</span></p>
        <p className="m-0">Dear Sir or Madam:</p>
      </div>

      {petition.sections.map((s) => (
        <Section key={s.key} section={s} range={ranges.get(s.key) ?? null} active={s.key === activeKey} onSelect={() => onSelect(s.key)} />
      ))}

      <div className="space-y-4 text-[14.5px] leading-[1.6]">
        <p className="m-0">Should additional information be required, please do not hesitate to contact my office.</p>
        <p className="m-0">Sincerely,</p>
        <p className="m-0"><span className="ph-mark">[ATTORNEY NAME]</span><br />Counsel for the Petitioner</p>
      </div>

      {selection && (
        <FeedbackCard
          selection={selection}
          onClose={() => setSelection(null)}
          onSubmit={async (instruction) => {
            await onFeedback(selection.key, selection.quote, instruction)
            setSelection(null)
          }}
        />
      )}
    </div>
  )
}

function Section({ section, range, active, onSelect }: { section: PetitionSection; range: { start: number; end: number } | null; active: boolean; onSelect: () => void }) {
  const [settled, setSettled] = useState(section.body)
  const wordsKey = `${section.key}:${section.words}:${section.version}`
  const [landing, setLanding] = useState(false)
  const prevKey = useRef(wordsKey)
  useEffect(() => {
    if (prevKey.current === wordsKey) return
    prevKey.current = wordsKey
    setSettled(section.body)
    setLanding(true)
    const t = window.setTimeout(() => setLanding(false), 500)
    return () => window.clearTimeout(t)
  }, [wordsKey, section.body])

  const marker = section.status === 'drafting' ? 'the firm is rewriting…' : range ? (range.start === range.end ? `p. ${range.start}` : `pp. ${range.start}-${range.end}`) : statusLabel(section)

  return (
    <section data-section-key={section.key} onClick={onSelect} className={`cursor-text ${active ? '-ml-5 border-l-2 border-neutral-300 pl-5' : ''}`}>
      <div className="relative">
        <h2 className="filing-heading m-0 px-24">{section.title}</h2>
        <span className={`tnum absolute top-0 right-0 font-sans text-[13px] text-neutral-500 ${section.status === 'drafting' ? 'breathe' : ''}`}>{marker}</span>
      </div>
      <div className={`mt-4 text-[14.5px] leading-[1.7] ${section.status === 'drafting' && section.body ? 'rewriting' : ''} ${landing ? 'rise' : ''}`}>
        {section.status === 'drafted' || (section.status === 'drafting' && settled) ? (
          <div className={`prose-paper ${styles.markdownContent}`}>
            <MarkdownMessage message={linkExhibits(bodyWithoutTitle(section.status === 'drafting' ? settled : section.body, section.title))} />
          </div>
        ) : (
          <p className="m-0 font-sans text-[13.5px] italic text-neutral-500">
            {section.status === 'held'
              ? 'Held. Click this section to see why, and what was requested from the client.'
              : section.status === 'drafting'
                ? 'The firm is writing this section now…'
                : 'Not drafted yet. Click this section to see what it needs.'}
          </p>
        )}
      </div>
    </section>
  )
}

/** Highlight-to-feedback: selecting a passage floats a card anchored to the selection. */
function FeedbackCard({ selection, onClose, onSubmit }: { selection: { quote: string; x: number; y: number }; onClose: () => void; onSubmit: (instruction: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    setFailure(null)
    try {
      await onSubmit(text.trim())
    } catch {
      setFailure("The redraft didn't start. This section is unchanged — try again.")
    } finally {
      setBusy(false)
    }
  }
  const left = Math.max(12, Math.min(window.innerWidth - 372, selection.x - 180))
  const top = Math.min(window.innerHeight - 220, selection.y)
  return createPortal(
    <div className="shadow-lift rise fixed z-[1050] w-[360px] rounded-xl border border-kumo-line bg-kumo-base p-3 font-sans" style={{ left, top }}>
      <blockquote className="m-0 max-h-20 overflow-hidden border-l border-kumo-line pl-2 text-[12px] leading-[17px] text-kumo-subtle">{selection.quote}</blockquote>
      <WorkshopInputArea autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell the firm what to change about this…" className="mt-2 w-full" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit() }} />
      {failure && <p className="m-0 mt-1 text-[12px] text-kumo-danger">{failure}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <WorkshopButton className="!h-8" onClick={onClose} disabled={busy}>Cancel</WorkshopButton>
        <WorkshopButton tone="primary" className="!h-8" onClick={() => void submit()} disabled={busy || !text.trim()}>{busy ? 'Working…' : 'Have the firm revise'}</WorkshopButton>
      </div>
    </div>,
    document.body,
  )
}
