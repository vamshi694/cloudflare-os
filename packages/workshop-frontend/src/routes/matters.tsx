import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { Plus } from '@phosphor-icons/react'
import type { LegalDesk, MatterListEntry } from '@gadgets/workshop-shared/legal'
import { useAuthenticatedApi } from '../AuthContext'
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

export const Route = createFileRoute('/matters')({
  component: MattersPage,
})

const POLL_MS = 10_000

type DeskState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'failed' }
  | { kind: 'ready'; api: RpcStub<LegalDesk> }

/** One status line per matter. Status (may the firm work?) outranks everything else. */
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
  return { tone: 'quiet', text: 'Up to date' }
}

/** Say WHAT needs the lawyer, in their language. Null when nothing does. */
export function needsLabel(m: MatterListEntry): string | null {
  const n = m.needsYou.openDecisions
  if (n <= 0) return null
  return plural(n, 'question for you', 'questions for you')
}

/**
 * THE MATTERS DESK — the lawyer's front door: their matters, each with one honest line — what the
 * firm is doing on it and whether it needs them. Nothing else.
 */
function MattersPage() {
  useDocumentTitle('Matters')
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()

  const [desk, setDesk] = useState<DeskState>({ kind: 'loading' })
  const [matters, setMatters] = useState<MatterListEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)

  // Mint the lawyer's desk once; dispose it when the screen leaves.
  useEffect(() => {
    let cancelled = false
    let stub: RpcStub<LegalDesk> | null = null
    authenticatedApi
      .getLegalDesk()
      .then((api) => {
        if (cancelled) {
          api?.[Symbol.dispose]?.()
          return
        }
        if (!api) {
          setDesk({ kind: 'disabled' })
          return
        }
        stub = api
        setDesk({ kind: 'ready', api })
      })
      .catch((err) => {
        logRpcFailure('Failed to open the matters desk:', err)
        if (!cancelled) setDesk({ kind: 'failed' })
      })
    return () => {
      cancelled = true
      stub?.[Symbol.dispose]?.()
    }
  }, [authenticatedApi])

  const api = desk.kind === 'ready' ? desk.api : null

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

  const handleCreate = async (input: { title: string; clientName: string; caseType: string | null }) => {
    if (!api) return
    const created = await api.createMatter(input)
    setCreating(false)
    void navigate({ to: '/matter/$id', params: { id: created.id } })
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 sm:px-10">
      <header className="flex flex-col items-stretch gap-4 px-3 pb-5 pt-6 sm:flex-row sm:items-end sm:justify-between sm:pt-10">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">Matters</h1>
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
            items={matters}
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
                  <MatterRow key={m.id} matter={m} />
                ))}
              </ul>
            )}
          </ThreeState>
        )}
      </div>

      {creating && (
        <NewMatterDialog onCancel={() => setCreating(false)} onCreate={handleCreate} />
      )}
    </div>
  )
}

function MatterRow({ matter }: { matter: MatterListEntry }) {
  const status = matterStatusLine(matter)
  const needs = needsLabel(matter)
  return (
    <li>
      <Link
        to="/matter/$id"
        params={{ id: matter.id }}
        className="themed-card-hover-shadow flex items-center gap-4 rounded-2xl border border-kumo-line bg-kumo-base px-5 py-4 transition-[border-color,transform,box-shadow] duration-150 ease-out hover:-translate-y-px hover:border-kumo-fill"
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
    </li>
  )
}

const UNDECIDED = '__undecided__'

function NewMatterDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (input: { title: string; clientName: string; caseType: string | null }) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [category, setCategory] = useState<string>(UNDECIDED)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const canSubmit = title.trim() !== '' && clientName.trim() !== '' && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setFailure(null)
    try {
      await onCreate({
        title: title.trim(),
        clientName: clientName.trim(),
        caseType: category === UNDECIDED ? null : category,
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
            <RadioRow
              name="case-type"
              value={UNDECIDED}
              checked={category === UNDECIDED}
              onChange={setCategory}
              disabled={busy}
            >
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
