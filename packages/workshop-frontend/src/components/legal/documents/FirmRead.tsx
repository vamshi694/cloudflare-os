import type { LegalDocument } from '@gadgets/workshop-shared/legal'
import { WorkshopButton } from '../../WorkshopControls'
import { Pill } from '../primitives'
import { docLabel, tidy } from '../labels'

export type Dossier = {
  filedAs: string | null
  evidenceFor: string[]
  roleInCase: string | null
  summary: string | null
  versions: { id: string; version: number; filename: string; uploadedAt: string; current: boolean }[]
}

export type DossierState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; dossier: Dossier | null }

/** The document's name as the lawyer knows it. */
export function documentTitle(doc: LegalDocument): string {
  return doc.displayTitle?.trim() || doc.filename
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-kumo-subtle">{label}</p>
      <div className="mt-1 text-[13px] leading-[19px] text-kumo-default">{children}</div>
    </div>
  )
}

/**
 * THE FIRM'S READ, one renderer, two homes: why this document exists on the matter (filed as,
 * evidence for, how it's used, what it says), identical in the reader's rail and the evidence
 * browser's detail panel. The ruling buttons sit at the point of doubt: a flagged or set-aside
 * document contributes nothing until the attorney rules.
 */
export function FirmRead({
  doc,
  state,
  onKeep,
  onUse,
  onOpen,
  onDetails,
  busy = false,
}: {
  doc: LegalDocument
  state: DossierState
  onKeep?: () => void
  onUse?: () => void
  onOpen?: () => void
  onDetails?: () => void
  busy?: boolean
}) {
  const dossier = state.kind === 'ready' ? state.dossier : null
  const read = doc.status === 'ready' || doc.status === 'empty'
  return (
    <div className="space-y-4 px-4 py-4">
      <Section label="Filed as">
        <div className="flex flex-wrap items-center gap-2">
          <span>{read ? docLabel(dossier?.filedAs ?? doc.docType) : 'Not read yet'}</span>
          {doc.relevance === 'check' && <Pill tone="warning">Flagged</Pill>}
          {doc.relevance === 'excluded' && <Pill>Set aside</Pill>}
        </div>
        {doc.relevance === 'check' && <p className="m-0 mt-1 text-[12.5px] text-kumo-subtle">Flagged — the firm thinks this may not belong to this matter.</p>}
        {doc.relevance === 'excluded' && <p className="m-0 mt-1 text-[12.5px] text-kumo-subtle">Set aside — not used as evidence.</p>}
      </Section>
      {state.kind === 'loading' && <div className="skeleton h-16" />}
      {state.kind === 'failed' && <p className="m-0 text-[12.5px] text-kumo-subtle">The firm's read couldn't load just now. The document is unchanged.</p>}
      {state.kind === 'ready' && !dossier && (
        <p className="m-0 text-[12.5px] leading-[18px] text-kumo-subtle">
          The firm hasn't written this document's dossier yet — it lands here once the record is read.
        </p>
      )}
      {dossier && (
        <>
          <Section label="Evidence for">
            {dossier.evidenceFor.length === 0 ? (
              <span className="text-kumo-subtle">Not yet placed</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {dossier.evidenceFor.map((c) => (
                  <Pill key={c} tone="ready">{tidy(c)}</Pill>
                ))}
              </div>
            )}
          </Section>
          {dossier.roleInCase && <Section label="How the firm uses it">{dossier.roleInCase}</Section>}
          {dossier.summary && <Section label="What it says">{dossier.summary}</Section>}
        </>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {doc.relevance === 'excluded' && onUse && (
          <WorkshopButton className="!h-8" onClick={onUse} disabled={busy}>↩ Use this document</WorkshopButton>
        )}
        {doc.relevance === 'check' && onKeep && (
          <WorkshopButton className="!h-8" onClick={onKeep} disabled={busy}>✓ Keep — it is relevant</WorkshopButton>
        )}
        {onOpen && <WorkshopButton className="!h-8" onClick={onOpen}>Open the document</WorkshopButton>}
        {onDetails && (
          <button type="button" onClick={onDetails} className="press cursor-pointer px-1 text-[12.5px] font-medium text-kumo-subtle hover:text-kumo-default">
            Full details & rulings
          </button>
        )}
      </div>
    </div>
  )
}
