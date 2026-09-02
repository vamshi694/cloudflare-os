import { useCallback, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GovernmentForm, MatterDesk, Petition } from '@gadgets/workshop-shared/legal'
import { useKumoToastManager } from '@cloudflare/kumo'
import { ArrowLeft, FileText } from '@phosphor-icons/react'
import { logRpcFailure } from '../../../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../../WorkshopControls'
import { Notice, Pill } from '../primitives'
import { useDeskData } from '../useMatterDesk'
import { DeskReader } from '../desk-tab'
import { caseTypeLabel, petitionTitle, plural } from '../labels'
import { LetterRoom } from './LetterRoom'
import { draftedCount, totalPages } from './petition-utils'

type Area = { kind: 'home' } | { kind: 'letter' } | { kind: 'form'; code: string } | { kind: 'file'; path: string }

const FORM_CHIP: Record<GovernmentForm['status'], { label: string; tone: 'ready' | 'warning' | 'neutral' | 'needsYou' }> = {
  signed: { label: 'Signed by the client', tone: 'ready' },
  awaiting_signature: { label: 'Awaiting client signature', tone: 'warning' },
  approved: { label: 'Approved — in the packet', tone: 'ready' },
  for_review: { label: 'For your review', tone: 'needsYou' },
  opened: { label: 'Opened — not filled yet', tone: 'neutral' },
  not_started: { label: 'Not started', tone: 'neutral' },
}

/**
 * THE WORKSPACE — the tab lands on the file room: the letter, the visa's government forms, and
 * everything the firm has written, each a document you pick up. Picking one up opens its working
 * room, with a way back.
 */
export function WorkspaceTab({ desk, caseType }: { desk: RpcStub<MatterDesk>; caseType: string | null }) {
  const loadPetition = useCallback(() => desk.petition(), [desk])
  const petition = useDeskData<Petition>(loadPetition, { pollMs: 8000 })
  const loadForms = useCallback(() => desk.forms(), [desk])
  const forms = useDeskData<GovernmentForm[]>(loadForms, { pollMs: 20000 })
  const loadFiles = useCallback(() => desk.deskFiles(), [desk])
  const files = useDeskData<{ path: string; updatedAt: string }[]>(loadFiles, { pollMs: 20000 })
  const [area, setArea] = useState<Area>({ kind: 'home' })
  const deliverables = (files.data ?? []).filter((f) => f.path.startsWith('deliverables/'))

  if (petition.data === null) {
    if (petition.failed) return <Notice title="The workspace couldn't be read just now." body="The letter and the forms are unchanged — this view keeps retrying." />
    return <div className="skeleton h-[420px]" />
  }
  const p = petition.data

  if (area.kind === 'letter') {
    return (
      <div className="space-y-4">
        <Crumb onBack={() => setArea({ kind: 'home' })} label="The petition letter" />
        <LetterRoom desk={desk} petition={p} reload={petition.reload} deliverables={deliverables} onOpenDeliverable={(path) => setArea({ kind: 'file', path })} />
      </div>
    )
  }
  if (area.kind === 'file') {
    return (
      <div className="space-y-4">
        <Crumb onBack={() => setArea({ kind: 'home' })} label={area.path.replace(/^deliverables\//, '').replace(/\.md$/, '')} />
        <DeskReader desk={desk} path={area.path} />
      </div>
    )
  }
  if (area.kind === 'form') {
    const form = forms.data?.find((f) => f.code === area.code)
    return (
      <div className="space-y-4">
        <Crumb onBack={() => setArea({ kind: 'home' })} label={form ? `${form.code} · ${form.title}` : area.code} />
        {form ? <FormRoom desk={desk} form={form} reload={forms.reload} /> : <p className="m-0 text-[13px] text-kumo-subtle">This form is no longer on the matter.</p>}
      </div>
    )
  }

  const { drafted, total } = draftedCount(p)
  const pages = totalPages(p.sections)
  const approvedCodes = (forms.data ?? []).filter((f) => f.status === 'approved' || f.status === 'signed').map((f) => f.code)

  return (
    <div className="max-w-[980px] space-y-8">
      {petition.failed && <p className="m-0 text-[12.5px] italic text-kumo-subtle">Not updating right now — showing the last view that loaded.</p>}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 font-serif text-[19px] leading-6 text-kumo-default">The {caseTypeLabel(caseType)} filing</h2>
          <p className="m-0 mt-1 text-[13px] leading-[19px] text-kumo-subtle">Everything this matter ships — the letter, the government forms, and the firm's written work.</p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2">
            <WorkshopButton className="!h-8" onClick={() => setArea({ kind: 'letter' })}>Open the letter</WorkshopButton>
            <button type="button" disabled className="h-8 cursor-not-allowed rounded-lg bg-kumo-fill px-3 text-[13px] font-medium text-kumo-inactive" title="The packet binder (letter, approved forms, every cited exhibit as one PDF) is not wired on this deployment yet.">
              Download the USCIS packet
            </button>
          </div>
          <p className="m-0 mt-1.5 text-[11.5px] leading-4 text-kumo-inactive">
            {approvedCodes.length > 0 ? `One PDF: ${approvedCodes.join(', ')} (approved) · the letter · every cited exhibit` : 'One PDF: the letter and every cited exhibit — forms join it once you approve them.'}
          </p>
        </div>
      </header>

      <section>
        <p className="docket m-0 mb-2">The petition letter</p>
        <button type="button" onClick={() => setArea({ kind: 'letter' })} className="shadow-depth press flex w-full cursor-pointer items-center gap-4 rounded-[14px] border border-kumo-line bg-kumo-base px-5 py-4 text-left hover:shadow-lift">
          <span className="grid h-[52px] w-[40px] shrink-0 place-items-center rounded-[4px] border border-kumo-line bg-white text-kumo-inactive"><FileText size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-serif text-[15px] text-kumo-default">{petitionTitle(caseType)}</span>
            <span className="tnum mt-0.5 block text-[12.5px] text-kumo-subtle">
              {drafted} of {total} sections drafted{pages > 0 ? ` · ≈ ${plural(pages, 'page', 'pages')}` : ''}{p.writing ? <span className="text-kumo-brand"> · the firm is writing</span> : null}
            </span>
            <span className="mt-2 block h-[3px] w-full rounded-full bg-kumo-fill"><span className="block h-full rounded-full bg-kumo-brand" style={{ width: `${total ? (drafted / total) * 100 : 0}%` }} /></span>
          </span>
          <span className="shrink-0 text-[13px] font-medium text-kumo-default">Open the letter →</span>
        </button>
      </section>

      <section>
        <p className="docket m-0 mb-1">Government forms</p>
        <p className="m-0 mb-2 text-[12.5px] text-kumo-subtle">What this {caseTypeLabel(caseType)} filing submits — the firm fills these from the evidence; every value carries its source.</p>
        {forms.data === null && forms.failed && <p className="m-0 text-[12.5px] text-kumo-subtle">The forms couldn't be read just now. Nothing has changed — this view keeps retrying.</p>}
        {forms.data === null && !forms.failed && <div className="skeleton h-20" />}
        {forms.data !== null && forms.data.length === 0 && (
          <p className="m-0 text-[12.5px] text-kumo-subtle">No government forms are mapped for this matter type yet — the firm's form set is managed by the firm's admins.</p>
        )}
        {forms.data !== null && forms.data.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {forms.data.map((f) => (
              <FormCard key={f.code} desk={desk} form={f} onOpen={() => setArea({ kind: 'form', code: f.code })} reload={forms.reload} />
            ))}
          </div>
        )}
      </section>

      <section>
        <p className="docket m-0 mb-1">Written by the firm</p>
        <p className="m-0 mb-2 text-[12.5px] text-kumo-subtle">Memos, timelines, letters, signature requests — ask for any document in Conversation.</p>
        {deliverables.length === 0 ? (
          <p className="m-0 text-[12.5px] text-kumo-inactive">Nothing yet. Ask for any document in Conversation — a memo, a timeline, a comparison — and it lands here.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {deliverables.map((d) => (
              <button key={d.path} type="button" onClick={() => setArea({ kind: 'file', path: d.path })} className="shadow-depth press cursor-pointer rounded-xl border border-kumo-line bg-kumo-base px-4 py-3 text-left hover:shadow-lift">
                <span className="block truncate text-[13.5px] font-medium text-kumo-default">{d.path.replace(/^deliverables\//, '').replace(/\.md$/, '')}</span>
                <span className="block text-[12px] text-kumo-subtle">Read</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Crumb({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <p className="m-0 flex items-center gap-1.5 text-[13px] text-kumo-subtle">
      <button type="button" onClick={onBack} className="press inline-flex cursor-pointer items-center gap-1 hover:text-kumo-default"><ArrowLeft size={13} /> Workspace</button>
      <span>/</span>
      <span className="text-kumo-default">{label}</span>
    </p>
  )
}

function FormCard({ desk, form, onOpen, reload }: { desk: RpcStub<MatterDesk>; form: GovernmentForm; onOpen: () => void; reload: () => void }) {
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState(false)
  const chip = FORM_CHIP[form.status]
  const prepare = async () => {
    setBusy(true)
    try {
      await desk.prepareForm(form.code)
      reload()
      onOpen()
    } catch (err) {
      logRpcFailure('Failed to prepare the form:', err)
      toasts.add({ title: `${form.code} was not prepared. Nothing changed — try again.`, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }
  if (form.status === 'not_started') {
    return (
      <div className="rounded-xl border border-dashed border-kumo-line px-4 py-3">
        <p className="m-0 text-[13.5px] font-medium text-kumo-default">{form.code} · {form.title}</p>
        {form.filedOnline ? (
          <p className="m-0 mt-1 text-[12px] text-kumo-subtle"><Pill>Filed online</Pill> This one is completed on the USCIS site — no PDF to fill.</p>
        ) : (
          <>
            <p className="m-0 mt-1 text-[12px] text-kumo-subtle">Not started — the firm prepares and fills this from the evidence as it lands.</p>
            <WorkshopButton className="!h-7 mt-2" onClick={() => void prepare()} disabled={busy}>{busy ? 'Preparing…' : 'Prepare now'}</WorkshopButton>
          </>
        )}
      </div>
    )
  }
  const pct = form.fields.length ? (form.filled / form.fields.length) * 100 : 0
  return (
    <button type="button" onClick={onOpen} className="shadow-depth press cursor-pointer rounded-xl border border-kumo-line bg-kumo-base px-4 py-3 text-left hover:shadow-lift">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13.5px] font-medium text-kumo-default">{form.code} · {form.title}</span>
        <Pill tone={chip.tone}>{chip.label}</Pill>
      </div>
      <span className="mt-2 block h-[3px] w-full rounded-full bg-kumo-fill"><span className="block h-full rounded-full bg-kumo-brand" style={{ width: `${pct}%` }} /></span>
      <span className="tnum mt-1 block text-[12px] text-kumo-subtle">{form.filled} of {form.fields.length} fields filled · {form.accepted} accepted by you</span>
    </button>
  )
}

/** The form room: every field with its value and the fact it came from; the attorney accepts or corrects. */
function FormRoom({ desk, form, reload }: { desk: RpcStub<MatterDesk>; form: GovernmentForm; reload: () => void }) {
  const toasts = useKumoToastManager()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const accept = async (name: string, value: string) => {
    setBusy(name)
    try {
      await desk.acceptFormField(form.code, name, value)
      setEdits((e) => { const n = { ...e }; delete n[name]; return n })
      reload()
    } catch (err) {
      logRpcFailure('Failed to accept the field:', err)
      toasts.add({ title: 'That value was not accepted — the form is unchanged. Try again.', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }
  const approve = async () => {
    setBusy('__approve')
    try {
      await desk.approveForm(form.code)
      reload()
    } catch (err) {
      logRpcFailure('Failed to approve the form:', err)
      toasts.add({ title: 'The form was not approved — it stays for your review. Try again.', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="max-w-[860px] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Pill tone={FORM_CHIP[form.status].tone}>{FORM_CHIP[form.status].label}</Pill>
        <WorkshopButton tone="primary" className="!h-8" onClick={() => void approve()} disabled={busy !== null || form.status === 'approved' || form.status === 'signed'}>
          {form.status === 'approved' || form.status === 'signed' ? 'Approved' : 'Approve — into the packet'}
        </WorkshopButton>
      </div>
      <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
        <ul className="m-0 list-none divide-y divide-kumo-line p-0">
          {form.fields.map((f) => {
            const value = edits[f.name] ?? f.value ?? ''
            return (
              <li key={f.name} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-center">
                <span className="text-[12.5px] text-kumo-subtle">{f.label}</span>
                <div className="min-w-0">
                  <WorkshopInput value={value} onChange={(e) => setEdits((x) => ({ ...x, [f.name]: e.target.value }))} className="w-full !h-8" placeholder="Not on the record — the attorney supplies this" />
                  <p className="m-0 mt-0.5 text-[11px] text-kumo-inactive">{f.sourceFactId ? 'From the record' : f.value ? 'Entered by the attorney' : 'No source yet'}{f.acceptedBy ? ' · accepted by you' : ''}</p>
                </div>
                <WorkshopButton className="!h-7" onClick={() => void accept(f.name, value)} disabled={busy !== null || !value.trim() || (f.acceptedBy === 'attorney' && edits[f.name] === undefined)}>
                  {busy === f.name ? '…' : f.acceptedBy && edits[f.name] === undefined ? 'Accepted' : 'Accept'}
                </WorkshopButton>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
