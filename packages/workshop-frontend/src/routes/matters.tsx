import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { Plus, Trash } from '@phosphor-icons/react'
import type { LegalDesk, MatterListEntry } from '@gadgets/workshop-shared/legal'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { WorkshopButton, WorkshopInput } from '../components/WorkshopControls'
import {
  CASE_TYPES,
  EmptyLine,
  FieldLabel,
  LegalDialog,
  Notice,
  Pill,
  RadioRow,
  Skeleton,
  StatusDot,
  ThreeState,
  caseTypeLabel,
  plural,
  type DotTone,
} from '../components/legal/primitives'
import { useDesk } from '../components/firm/useDesk'

export const Route = createFileRoute('/matters')({
  component: MattersPage,
})

const POLL_MS = 10_000

/**
 * One status line per matter. ONE TRUTH with the matter page: status (may the firm work?)
 * outranks stage (where the work is). A paused matter that showed only "Drafting" read as
 * "in progress" to the lawyer who had stopped it.
 */
export function matterStatusLine(m: MatterListEntry): { tone: DotTone; text: string } {
  if (m.status === 'paused') return { tone: 'paused', text: 'Paused by you' }
  if (m.status === 'closed') return { tone: 'quiet', text: 'Closed' }
  if (m.record.reading > 0) {
    return { tone: 'working', text: `Reading ${plural(m.record.reading, 'document', 'documents')}` }
  }
  if (m.record.failed > 0) {
    return {
      tone: 'paused',
      text: `${plural(m.record.failed, 'document needs', 'documents need')} a clearer copy`,
    }
  }
  if (m.record.documents === 0) return { tone: 'hollow', text: 'Waiting for the record' }
  return { tone: 'quiet', text: 'Up to date' }
}

/**
 * Say WHAT needs the lawyer, in their language. Only fall back to the bare "need you" when the
 * work is a mix of kinds.
 */
export function needsLabel(m: MatterListEntry): string | null {
  const dec = m.needsYou.openDecisions
  const docs = m.needsYou.unreadableDocuments
  const total = dec + docs
  if (total === 0) return null
  if (dec === total) return plural(dec, 'question for you', 'questions for you')
  if (docs === total) return plural(docs, 'document needs you', 'documents need you')
  return `${total} need you`
}

/**
 * What needs the lawyer floats up; then the firm's live work; the rest by recency. (The docket
 * will order the desk once matters carry their next deadline.)
 */
export function orderMatters(list: MatterListEntry[]): MatterListEntry[] {
  const rank = (m: MatterListEntry) => {
    const needs = m.needsYou.openDecisions + m.needsYou.unreadableDocuments
    if (m.status === 'closed') return 4
    if (needs > 0) return 0
    if (m.status === 'paused') return 1
    if (m.record.reading > 0) return 2
    return 3
  }
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : -1))
}

const mintLegalDesk = (api: RpcStub<import('@gadgets/workshop-shared/api').AuthenticatedApi>) => api.getLegalDesk()

/**
 * THE MATTERS DESK — the lawyer's front door: their matters, each with one honest line — what
 * stage it's in and whether it needs them. Nothing else. The primary action lives where the
 * lawyer looks for it.
 */
function MattersPage() {
  useDocumentTitle('Matters')
  const navigate = useNavigate()
  const desk = useDesk<LegalDesk>(mintLegalDesk, 'the matters desk')
  const api = desk.kind === 'ready' ? desk.stub : null

  const [matters, setMatters] = useState<MatterListEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<MatterListEntry | null>(null)

  const load = useCallback(async () => {
    if (!api) return
    try {
      const list = await api.listMatters()
      setMatters(list)
      setFailed(false)
    } catch (err) {
      logRpcFailure('Failed to list matters:', err)
      setFailed(true)
    }
  }, [api])

  useEffect(() => {
    if (!api) return
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [api, load])

  const ordered = useMemo(() => (matters ? orderMatters(matters) : null), [matters])

  const handleCreate = async (input: { title: string; clientName: string; caseType: string | null; clientEmail: string | null }) => {
    if (!api) return
    const created = await api.createMatter(input)
    setCreating(false)
    void navigate({ to: '/matter/$id', params: { id: created.id } })
  }

  const handleDelete = async (m: MatterListEntry, confirmTitle: string) => {
    if (!api) return
    const matter = await api.openMatter(m.id)
    try {
      await matter.deleteMatter(confirmTitle)
    } finally {
      matter[Symbol.dispose]?.()
    }
    setDeleting(null)
    setMatters((prev) => (prev ? prev.filter((x) => x.id !== m.id) : prev))
    void load()
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 sm:px-10">
      <header className="flex flex-col items-stretch gap-4 px-3 pb-5 pt-6 sm:flex-row sm:items-end sm:justify-between sm:pt-10">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default">Matters</h1>
          <p className="mt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
            Every matter the firm is running, and where each one stands.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={!api}
          className="press inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-kumo-brand px-3.5 text-[14px] font-medium text-white transition-colors hover:bg-kumo-brand-hover disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:text-[13px]"
        >
          <Plus size={14} weight="bold" />
          New matter
        </button>
      </header>

      <div className="min-h-0 flex-1 px-3 pb-10">
        {desk.kind === 'disabled' ? (
          <Notice
            tone="info"
            title="Matters aren't turned on for this deployment."
            body="The Matters gatekeeper is disabled. Nothing is lost — an admin can enable it under Gatekeepers, and your matters appear here."
          />
        ) : desk.kind === 'failed' ? (
          <Notice
            title="Your matters couldn't be loaded."
            body="This is a display problem — nothing has changed on any matter. Reload to try again."
          />
        ) : (
          <ThreeState
            items={ordered}
            failed={failed}
            skeleton={
              <div className="space-y-3">
                <Skeleton className="h-[72px]" />
                <Skeleton className="h-[72px]" />
                <Skeleton className="h-[72px]" />
              </div>
            }
            neverLoaded={{
              title: "Your matters couldn't be loaded.",
              body: 'This is a display problem — nothing has changed on any matter. The desk keeps retrying; reload if it stays empty.',
            }}
            stale="Not updating right now — showing the last view that loaded."
            empty={
              <EmptyLine
                title="No matters yet"
                body="Open one with New matter — name the client and the case type, and the firm takes it from there."
              />
            }
          >
            {(items) => (
              <ul className="m-0 list-none space-y-3 p-0">
                {items.map((m) => (
                  <MatterRow key={m.id} matter={m} onDelete={() => setDeleting(m)} />
                ))}
              </ul>
            )}
          </ThreeState>
        )}
      </div>

      {creating && <NewMatterDialog onCancel={() => setCreating(false)} onCreate={handleCreate} />}
      {deleting && (
        <DeleteMatterDialog matter={deleting} onCancel={() => setDeleting(null)} onConfirm={handleDelete} />
      )}
    </div>
  )
}

function MatterRow({ matter, onDelete }: { matter: MatterListEntry; onDelete: () => void }) {
  const status = matterStatusLine(matter)
  const needs = needsLabel(matter)
  return (
    <li className="group relative">
      <Link
        to="/matter/$id"
        params={{ id: matter.id }}
        className="themed-card-hover-shadow flex items-center gap-4 rounded-2xl border border-kumo-line bg-kumo-base px-5 py-4 pr-14 transition-[border-color,transform,box-shadow] duration-150 ease-out hover:-translate-y-px hover:border-kumo-fill"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[15px] leading-5 font-semibold tracking-[-0.3px] text-kumo-default">
              {matter.title}
            </span>
            <Pill>{caseTypeLabel(matter.caseType)}</Pill>
          </div>
          <p className="mt-0.5 mb-0 truncate text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
            {matter.clientName}
          </p>
          <p className="mt-1.5 mb-0 flex items-center gap-1.5 text-[12.5px] leading-4 tracking-[-0.2px] text-kumo-subtle">
            <StatusDot tone={status.tone} />
            {status.text}
          </p>
        </div>
        {needs && <Pill tone="needsYou">{needs}</Pill>}
      </Link>
      {/* Touch has no hover: visible at rest on touch, revealed on hover elsewhere. */}
      <button
        type="button"
        aria-label={`Remove ${matter.title}`}
        title="Remove this matter"
        onClick={onDelete}
        className="absolute top-1/2 right-4 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-kumo-inactive opacity-60 transition-opacity hover:bg-kumo-tint hover:text-kumo-danger group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
      >
        <Trash size={15} />
      </button>
    </li>
  )
}

const UNDECIDED = '__undecided__'

function NewMatterDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (input: { title: string; clientName: string; caseType: string | null; clientEmail: string | null }) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [category, setCategory] = useState<string>(UNDECIDED)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const emailOk = clientEmail.trim() === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail.trim())
  const canSubmit = title.trim() !== '' && clientName.trim() !== '' && emailOk && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setFailure(null)
    try {
      await onCreate({
        title: title.trim(),
        clientName: clientName.trim(),
        caseType: category === UNDECIDED ? null : category,
        clientEmail: clientEmail.trim() || null,
      })
    } catch (err) {
      logRpcFailure('Failed to create the matter:', err, { reportSite: 'legal.createMatter' })
      setFailure("The matter wasn't opened. Nothing was created — try again.")
      setBusy(false)
    }
  }

  return (
    <LegalDialog
      open
      busy={busy}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title="New matter"
      description="Name the client and the case type. The firm takes it from there."
      footer={
        <>
          <WorkshopButton className="!h-9" onClick={onCancel} disabled={busy}>
            Cancel
          </WorkshopButton>
          <WorkshopButton tone="primary" className="!h-9" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? 'Opening…' : 'Open the matter'}
          </WorkshopButton>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div>
          <FieldLabel>Title</FieldLabel>
          <WorkshopInput
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="e.g. Dr. A. Raghunathan"
            className="w-full"
            autoFocus
          />
        </div>
        <div>
          <FieldLabel>Client name</FieldLabel>
          <WorkshopInput
            value={clientName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setClientName(e.target.value)}
            placeholder="The person or company the firm represents"
            className="w-full"
          />
        </div>
        <div>
          <FieldLabel hint="Optional. The client's private portal link goes here when you invite them from the matter.">
            Client email
          </FieldLabel>
          <WorkshopInput
            type="email"
            value={clientEmail}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setClientEmail(e.target.value)}
            placeholder="client@example.com"
            className="w-full"
          />
          {!emailOk && (
            <p className="mt-1 text-[12px] leading-4 text-kumo-danger">That doesn&apos;t look like an email address.</p>
          )}
        </div>
        <div>
          <FieldLabel hint="Undecided is fine — the firm can commit the strategy once it has read the record.">
            Category
          </FieldLabel>
          <div className="space-y-0.5">
            {CASE_TYPES.map((t) => (
              <RadioRow
                key={t.value}
                name="case-type"
                value={t.value}
                checked={category === t.value}
                onChange={setCategory}
                disabled={busy}
              >
                {t.label}
              </RadioRow>
            ))}
            <RadioRow name="case-type" value={UNDECIDED} checked={category === UNDECIDED} onChange={setCategory} disabled={busy}>
              Undecided
            </RadioRow>
          </div>
        </div>
        {failure && (
          <p role="alert" className="m-0 text-[12.5px] leading-[18px] text-kumo-danger">
            {failure}
          </p>
        )}
      </form>
    </LegalDialog>
  )
}

/**
 * Deletion is two-factor: the phrase to type is the matter's title, shown visibly, selectable
 * and copyable — never a grey placeholder (caught live: hint text plus a dash in the title made
 * deletion feel random).
 */
function DeleteMatterDialog({
  matter,
  onCancel,
  onConfirm,
}: {
  matter: MatterListEntry
  onCancel: () => void
  onConfirm: (matter: MatterListEntry, confirmTitle: string) => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const matches = typed.trim() === matter.title.trim()

  const submit = async () => {
    if (!matches || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await onConfirm(matter, typed.trim())
    } catch (err) {
      logRpcFailure('Failed to delete the matter:', err, { reportSite: 'legal.deleteMatter' })
      setFailure("The matter wasn't removed. Nothing has changed — try again.")
      setBusy(false)
    }
  }

  return (
    <LegalDialog
      open
      busy={busy}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title="Remove this matter?"
      description="This removes the matter, its record, the facts the firm drew from it, and its conversation. Nothing on your other matters is affected."
      footer={
        <>
          <WorkshopButton className="!h-9" onClick={onCancel} disabled={busy}>
            Keep
          </WorkshopButton>
          <WorkshopButton tone="danger" className="!h-9" onClick={() => void submit()} disabled={!matches || busy}>
            {busy ? 'Removing…' : 'Remove matter'}
          </WorkshopButton>
        </>
      }
    >
      <FieldLabel>To confirm, type the matter&apos;s title</FieldLabel>
      <p className="mb-2 select-all rounded-md bg-kumo-tint px-2.5 py-1.5 font-mono text-[13px] leading-5 text-kumo-default">
        {matter.title}
      </p>
      <WorkshopInput
        value={typed}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
        placeholder="Type the title exactly"
        className="w-full"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />
      {failure && (
        <p role="alert" className="mt-2 text-[12.5px] leading-[18px] text-kumo-danger">
          {failure}
        </p>
      )}
    </LegalDialog>
  )
}
