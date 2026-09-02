import { useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { CaseClaim, CaseEntity, CaseMap, MatterDesk } from '@gadgets/workshop-shared/legal'
import { PushPin } from '@phosphor-icons/react'
import { useKumoToastManager } from '@cloudflare/kumo'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../../WorkshopControls'
import { ConfirmModal } from '../ui/ConfirmModal'
import { plural, tidy } from '../labels'
import { colorOf } from './layout'

const CLAIMS_SHOWN = 12

/**
 * THE DOSSIER — nothing selected: the map's own explanation and the override ledger, split into
 * two never-blended groups (WHO made an edit is part of the truth). Selected: the entity, its
 * claims, and the corrections that outrank the machine and stick forever.
 */
export function Dossier({
  desk,
  map,
  selected,
  criteria,
  onSelect,
  onChanged,
}: {
  desk: RpcStub<MatterDesk>
  map: CaseMap
  selected: CaseEntity | null
  criteria: { key: string; title: string }[]
  onSelect: (id: string) => void
  onChanged: () => void
}) {
  const toasts = useKumoToastManager()
  const undo = async (id: string) => {
    try {
      await desk.revertOverride(id)
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to undo an override:', err)
      toasts.add({ title: "That undo didn't go through — the correction stands. Try again.", variant: 'error' })
    }
  }

  if (!selected) {
    const live = map.overrides.filter((o) => !o.reverted)
    const yours = live.filter((o) => o.by === 'attorney')
    const firms = live.filter((o) => o.by === 'firm')
    return (
      <div className="space-y-5 px-4 py-4">
        <div>
          <p className="m-0 text-[14px] font-medium text-kumo-default">The case, as the firm knows it</p>
          <p className="m-0 mt-1 text-[12.5px] leading-[18px] text-kumo-subtle">
            {map.entities.length} entities bound by {map.claims.filter((c) => !c.removed).length} legal claims, built from the matter's documents. Size is how much the record says about an entity; a line means one claim involves both. Click anything to read its dossier and correct it. Your corrections outrank the machine and stick forever.
          </p>
        </div>
        <Ledger title="Your corrections" rows={yours} onUndo={undo} empty="None yet." />
        <Ledger title="The firm's tidy-ups" hint="Duplicate entities the firm merged on its own — undo any you disagree with." rows={firms} onUndo={undo} empty="None yet." />
      </div>
    )
  }
  return <Selected desk={desk} map={map} entity={selected} criteria={criteria} onSelect={onSelect} onChanged={onChanged} />
}

function Ledger({ title, hint, rows, onUndo, empty }: { title: string; hint?: string; rows: CaseMap['overrides']; onUndo: (id: string) => void; empty: string }) {
  return (
    <div>
      <p className="docket m-0">{title}</p>
      {hint && <p className="m-0 mt-1 text-[12px] leading-[17px] text-kumo-subtle">{hint}</p>}
      {rows.length === 0 ? (
        <p className="m-0 mt-1.5 text-[12.5px] text-kumo-inactive">{empty}</p>
      ) : (
        <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
          {rows.map((o) => (
            <li key={o.id} className="flex items-start justify-between gap-2 text-[12.5px] leading-[18px] text-kumo-default">
              <span className="min-w-0">{o.summary}</span>
              <button type="button" onClick={() => onUndo(o.id)} className="press shrink-0 cursor-pointer text-kumo-subtle hover:text-kumo-default">Undo</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Selected({ desk, map, entity, criteria, onSelect, onChanged }: { desk: RpcStub<MatterDesk>; map: CaseMap; entity: CaseEntity; criteria: { key: string; title: string }[]; onSelect: (id: string) => void; onChanged: () => void }) {
  const toasts = useKumoToastManager()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(entity.name)
  const [showAll, setShowAll] = useState(false)
  const claims = map.claims.filter((c) => c.entityIds.includes(entity.id))
  const live = claims.filter((c) => !c.removed)
  const sections = [...new Set(live.flatMap((c) => c.criteria))]
  const titleOf = (k: string) => criteria.find((c) => c.key === k)?.title ?? tidy(k)
  const byId = new Map(map.entities.map((e) => [e.id, e]))

  const rename = async () => {
    if (!name.trim() || name.trim() === entity.name) {
      setRenaming(false)
      return
    }
    try {
      await desk.renameEntity(entity.id, name.trim())
      setRenaming(false)
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to rename the entity:', err)
      toasts.add({ title: "The rename didn't save — the entity is unchanged.", variant: 'error' })
    }
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[11.5px] font-medium text-white" style={{ background: colorOf(entity.kind) }}>{tidy(entity.kind)}</span>
          {entity.locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-kumo-tint px-2 py-0.5 text-[11.5px] text-kumo-subtle"><PushPin size={11} /> yours</span>
          )}
        </div>
        {renaming ? (
          <div className="mt-2 flex items-center gap-1.5">
            <WorkshopInput value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 !h-8" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setRenaming(false) }} />
            <WorkshopButton tone="primary" className="!h-8" onClick={() => void rename()}>Save</WorkshopButton>
          </div>
        ) : (
          <button type="button" onClick={() => setRenaming(true)} title="Rename" className="press mt-1.5 cursor-pointer text-left text-[17px] leading-6 font-semibold tracking-[-0.3px] text-kumo-default hover:underline">
            {entity.name}
          </button>
        )}
        <p className="tnum m-0 mt-0.5 text-[12px] text-kumo-inactive">{plural(live.length, 'claim', 'claims')} in the record</p>
      </div>
      {entity.description && <p className="m-0 text-[13px] leading-[19px] text-kumo-default">{entity.description}</p>}
      <div>
        <p className="docket m-0">Where it helps</p>
        {sections.length === 0 ? (
          <p className="m-0 mt-1.5 text-[12.5px] text-kumo-inactive">No petition section yet.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {sections.map((s) => (
              <span key={s} className="rounded-full bg-kumo-tint px-2 py-0.5 text-[12px] text-kumo-default">{titleOf(s)}</span>
            ))}
          </div>
        )}
        <p className="m-0 mt-1.5 text-[11.5px] leading-4 text-kumo-inactive">Edit any claim below to change which sections its evidence argues in.</p>
      </div>
      <div>
        <p className="docket m-0">Claims it appears in</p>
        <ul className="m-0 mt-1.5 list-none space-y-2 p-0">
          {(showAll ? claims : claims.slice(0, CLAIMS_SHOWN)).map((c) => (
            <ClaimRow key={c.id} desk={desk} claim={c} entity={entity} byId={byId} criteria={criteria} onSelect={onSelect} onChanged={onChanged} />
          ))}
        </ul>
        {claims.length > CLAIMS_SHOWN && !showAll && (
          <button type="button" onClick={() => setShowAll(true)} className="press mt-2 cursor-pointer text-[12.5px] text-kumo-subtle hover:text-kumo-default">+ {claims.length - CLAIMS_SHOWN} more claims</button>
        )}
      </div>
      <p className="m-0 text-[11.5px] leading-4 text-kumo-inactive">Duplicate-entity cleanup is the firm's chore, not yours: the counsel adjudicates ambiguous pairs on its next working pass (ledgered, undoable).</p>
    </div>
  )
}

function ClaimRow({ desk, claim, entity, byId, criteria, onSelect, onChanged }: { desk: RpcStub<MatterDesk>; claim: CaseClaim; entity: CaseEntity; byId: Map<string, CaseEntity>; criteria: { key: string; title: string }[]; onSelect: (id: string) => void; onChanged: () => void }) {
  const toasts = useKumoToastManager()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const titleOf = (k: string) => criteria.find((c) => c.key === k)?.title ?? tidy(k)
  const others = claim.entityIds.filter((id) => id !== entity.id).map((id) => byId.get(id)).filter((e): e is CaseEntity => !!e)

  const retag = async (next: string[]) => {
    try {
      await desk.retagClaim(claim.id, next)
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to retag the claim:', err)
      toasts.add({ title: "That retag didn't save — the claim is unchanged.", variant: 'error' })
    }
  }
  const setRemoved = async (removed: boolean) => {
    await desk.setClaimRemoved(claim.id, removed)
    setConfirming(false)
    onChanged()
  }

  return (
    <li className={`rounded-lg border border-kumo-line px-3 py-2 ${claim.removed ? 'opacity-50' : ''}`}>
      <p className="m-0 text-[12.5px] leading-[18px] text-kumo-default">{claim.statement}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {claim.criteria.map((k) => (
          <span key={k} className="rounded-full bg-kumo-tint px-1.5 py-0.5 text-[11px] text-kumo-default">{titleOf(k)}</span>
        ))}
        {others.map((o) => (
          <button key={o.id} type="button" onClick={() => onSelect(o.id)} className="press cursor-pointer rounded-full border border-kumo-line px-1.5 py-0.5 text-[11px] text-kumo-subtle hover:text-kumo-default">{o.name}</button>
        ))}
      </div>
      {editing && (
        <div className="mt-2 space-y-1.5">
          <p className="m-0 text-[11.5px] leading-4 text-kumo-subtle">Tap a section to take this claim out of it, + add for another. Final over the machine, effective immediately.</p>
          <div className="flex flex-wrap gap-1">
            {criteria.map((c) => {
              const on = claim.criteria.includes(c.key)
              return (
                <button key={c.key} type="button" onClick={() => void retag(on ? claim.criteria.filter((k) => k !== c.key) : [...claim.criteria, c.key])} className={`press cursor-pointer rounded-full border px-2 py-0.5 text-[11.5px] ${on ? 'border-kumo-success/40 bg-kumo-success-tint/60 text-kumo-success' : 'border-kumo-line text-kumo-subtle hover:text-kumo-default'}`}>
                  {on ? '× ' : '+ '}{c.title}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="mt-1.5 flex gap-3 text-[11.5px]">
        <button type="button" onClick={() => setEditing((e) => !e)} className="press cursor-pointer text-kumo-subtle hover:text-kumo-default">sections</button>
        {claim.removed ? (
          <button type="button" onClick={() => void setRemoved(false)} className="press cursor-pointer text-kumo-subtle hover:text-kumo-default">undo remove</button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="press cursor-pointer text-kumo-subtle hover:text-kumo-danger">remove</button>
        )}
      </div>
      <ConfirmModal
        open={confirming}
        heading="Remove this claim from the case?"
        body="It leaves every brief and petition now. The rest of the case knowledge stays stitched. Nothing rebuilds. Undo brings it back any time."
        confirmLabel="Remove"
        onCancel={() => setConfirming(false)}
        onConfirm={() => setRemoved(true)}
      />
    </li>
  )
}
