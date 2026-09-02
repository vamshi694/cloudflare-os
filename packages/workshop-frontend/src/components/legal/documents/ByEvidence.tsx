import { useEffect, useMemo, useState } from 'react'
import type { LegalDocument, SectionReadiness } from '@gadgets/workshop-shared/legal'
import { StatusDot } from '../primitives'
import { docLabel, tidy } from '../labels'
import { FirmRead, documentTitle } from './FirmRead'
import type { Dossiers } from './useDossiers'

const UNPLACED = 'Not yet placed'

/**
 * BY EVIDENCE — the same documents re-bucketed under the visa criteria they support, so the
 * lawyer reads the record the way the petition argues it. Three panes, one group at a time: the
 * criteria index (the case's argument in one glance), the chosen group's documents, the selected
 * document's firm's-read. Scroll lives inside the group.
 */
export function ByEvidence({
  docs,
  dossiers,
  sections,
  onOpenViewer,
  onDetails,
  onKeep,
  onUse,
}: {
  docs: LegalDocument[]
  dossiers: Dossiers
  sections: SectionReadiness[] | null
  onOpenViewer: (doc: LegalDocument) => void
  onDetails: (doc: LegalDocument) => void
  onKeep: (doc: LegalDocument) => void
  onUse: (doc: LegalDocument) => void
}) {
  useEffect(() => {
    dossiers.ensure(docs.map((d) => d.id))
  }, [docs, dossiers])

  const buckets = useMemo(() => {
    const map = new Map<string, LegalDocument[]>()
    for (const doc of docs) {
      const s = dossiers.get(doc.id)
      const supports = s.kind === 'ready' && s.dossier ? s.dossier.evidenceFor : []
      if (supports.length === 0) {
        map.set(UNPLACED, [...(map.get(UNPLACED) ?? []), doc])
        continue
      }
      for (const c of supports) map.set(c, [...(map.get(c) ?? []), doc])
    }
    const entries = [...map.entries()].filter(([k]) => k !== UNPLACED).sort((a, b) => b[1].length - a[1].length)
    if (map.has(UNPLACED)) entries.push([UNPLACED, map.get(UNPLACED)!])
    return entries
  }, [docs, dossiers])

  const [group, setGroup] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const activeGroup = group && buckets.some(([k]) => k === group) ? group : buckets[0]?.[0] ?? null
  const groupDocs = buckets.find(([k]) => k === activeGroup)?.[1] ?? []
  const selectedDoc = groupDocs.find((d) => d.id === selected) ?? groupDocs[0] ?? null

  const titleOf = (key: string) => (key === UNPLACED ? key : sections?.find((s) => s.key === key)?.title ?? tidy(key))

  if (buckets.length === 0) {
    return <p className="m-0 text-[13px] text-kumo-subtle">Nothing to group yet — the record is placed under criteria as the firm reads it.</p>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)_320px]">
      <nav aria-label="What the record proves" className="lg:sticky lg:top-4 lg:self-start">
        <p className="docket m-0 mb-2">What the record proves</p>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {buckets.map(([key, list]) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => {
                  setGroup(key)
                  setSelected(null)
                }}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                  key === activeGroup ? 'bg-kumo-fill font-medium text-kumo-default' : 'text-kumo-default hover:bg-kumo-tint'
                }`}
              >
                <span className="min-w-0 truncate">{titleOf(key)}</span>
                <span className="tnum shrink-0 text-[12px] text-kumo-inactive">{list.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <ul className="m-0 max-h-[62vh] list-none divide-y divide-kumo-line overflow-y-auto rounded-xl border border-kumo-line bg-kumo-base p-0">
        {groupDocs.map((doc) => (
          <li
            key={doc.id}
            onClick={() => setSelected(doc.id)}
            onDoubleClick={() => onOpenViewer(doc)}
            className={`cursor-pointer px-4 py-3 transition-colors ${selectedDoc?.id === doc.id ? 'bg-kumo-tint/60' : 'hover:bg-kumo-tint/30'}`}
          >
            <div className="flex items-center gap-2">
              <StatusDot tone={doc.status === 'ready' ? 'ready' : doc.status === 'failed' ? 'paused' : 'quiet'} />
              <span className="min-w-0 truncate text-[13.5px] font-medium text-kumo-default">{documentTitle(doc)}</span>
            </div>
            <p className="m-0 mt-0.5 pl-4 text-[12px] text-kumo-subtle">{doc.status === 'ready' ? docLabel(doc.docType) : 'Not read yet'}</p>
          </li>
        ))}
      </ul>
      <aside className="rounded-xl border border-kumo-line bg-kumo-base lg:sticky lg:top-4 lg:self-start">
        {selectedDoc ? (
          <FirmRead
            doc={selectedDoc}
            state={dossiers.get(selectedDoc.id)}
            onOpen={() => onOpenViewer(selectedDoc)}
            onDetails={() => onDetails(selectedDoc)}
            onKeep={() => onKeep(selectedDoc)}
            onUse={() => onUse(selectedDoc)}
          />
        ) : (
          <p className="m-0 px-4 py-4 text-[12.5px] text-kumo-subtle">Pick a document to read the firm's take on it.</p>
        )}
      </aside>
    </div>
  )
}
