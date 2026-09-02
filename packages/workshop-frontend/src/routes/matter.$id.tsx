import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import type { RpcStub } from 'capnweb'
import { useKumoToastManager } from '@cloudflare/kumo'
import {
  ArrowLeft,
  ChatCircleDots,
  Files,
  FolderSimple,
  Question,
  Quotes,
} from '@phosphor-icons/react'
import type { MatterDesk, MatterOverviewView } from '@gadgets/workshop-shared/legal'
import { useDocumentTitle } from '../useDocumentTitle'
import { logRpcFailure } from '../rpcErrors'
import { WorkshopButton } from '../components/WorkshopControls'
import {
  LegalDialog,
  Notice,
  Pill,
  SegmentedTabs,
  Skeleton,
  StatusDot,
  caseTypeLabel,
  plural,
  type DotTone,
  type SegmentedTab,
} from '../components/legal/primitives'
import { useMatterDesk, useMatterOverview } from '../components/legal/useMatterDesk'
import { ConversationTab } from '../components/legal/ConversationTab'
import { DocumentsTab } from '../components/legal/DocumentsTab'
import { EvidenceTab } from '../components/legal/EvidenceTab'
import { DecisionsTab } from '../components/legal/DecisionsTab'
import { DeskTab } from '../components/legal/DeskTab'

const TAB_KEYS = ['conversation', 'documents', 'evidence', 'decisions', 'desk'] as const
type TabKey = (typeof TAB_KEYS)[number]
const isTabKey = (v: unknown): v is TabKey => typeof v === 'string' && (TAB_KEYS as readonly string[]).includes(v)

type MatterSearch = { tab?: TabKey }

export const Route = createFileRoute('/matter/$id')({
  component: MatterPage,
  validateSearch: (search: Record<string, unknown>): MatterSearch => ({
    tab: isTabKey(search.tab) ? search.tab : undefined,
  }),
})

/** Tab state lives in the URL (?tab=…), written with replaceState so switching never re-navigates. */
function readTabFromUrl(): TabKey {
  const tab = new URLSearchParams(window.location.search).get('tab')
  return isTabKey(tab) ? tab : 'conversation'
}

function writeTabToUrl(tab: TabKey) {
  const url = new URL(window.location.href)
  if (tab === 'conversation') url.searchParams.delete('tab')
  else url.searchParams.set('tab', tab)
  window.history.replaceState(window.history.state, '', url)
}

/** The status line ladder: paused → reading → unreadable copies → up to date. */
function statusLine(view: MatterOverviewView): { tone: DotTone; text: string } {
  if (view.status === 'paused') return { tone: 'paused', text: 'Paused by you' }
  if (view.status === 'closed') return { tone: 'quiet', text: 'Closed' }
  if (view.record.reading > 0 || view.record.stillArriving) {
    const n = view.record.reading
    return { tone: 'working', text: n > 0 ? `Reading ${plural(n, 'document', 'documents')}` : 'Documents still arriving' }
  }
  if (view.record.failed > 0) {
    return { tone: 'paused', text: `${plural(view.record.failed, 'document needs', 'documents need')} a clearer copy` }
  }
  return { tone: 'quiet', text: 'Up to date' }
}

function MatterPage() {
  const { id } = Route.useParams()
  const deskState = useMatterDesk(id)
  const desk = deskState.kind === 'ready' ? deskState.desk : null
  const { overview, failed, loadedAt, refresh } = useMatterOverview(desk)
  useDocumentTitle(overview?.title ?? 'Matter')

  const [tab, setTab] = useState<TabKey>(() => readTabFromUrl())
  const changeTab = (next: TabKey) => {
    setTab(next)
    writeTabToUrl(next)
  }

  if (deskState.kind === 'disabled' || deskState.kind === 'gone' || deskState.kind === 'unreachable') {
    return (
      <Shell>
        <BackLink />
        <div className="mt-4">
          {deskState.kind === 'gone' ? (
            <Notice
              tone="info"
              title="This matter is no longer here."
              body="It was deleted, or the link points at a matter this firm doesn't have. Nothing on your other matters is affected."
            />
          ) : deskState.kind === 'disabled' ? (
            <Notice
              tone="info"
              title="Matters aren't turned on for this deployment."
              body="The Matters gatekeeper is disabled. Nothing is lost — an admin can enable it under Gatekeepers."
            />
          ) : (
            <Notice
              title="This matter can't be loaded."
              body="The firm's engine didn't answer. The matter and its record are untouched — this screen just can't read them right now. Reload to try again."
            />
          )}
        </div>
      </Shell>
    )
  }

  if (!desk || !overview) {
    return (
      <Shell>
        <BackLink />
        {failed ? (
          <div className="mt-4">
            <Notice
              title="This matter can't be loaded."
              body="The firm's engine didn't answer. The matter and its record are untouched — this screen just can't read them right now. It keeps retrying."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-6 h-10 w-[420px] max-w-full" />
            <Skeleton className="h-[160px]" />
          </div>
        )}
      </Shell>
    )
  }

  const tabs: SegmentedTab<TabKey>[] = [
    { key: 'conversation', label: 'Conversation', icon: <ChatCircleDots size={15} /> },
    { key: 'documents', label: 'Documents', icon: <Files size={15} />, count: overview.record.documents },
    { key: 'evidence', label: 'Evidence', icon: <Quotes size={15} />, count: overview.record.facts },
    { key: 'decisions', label: 'Decisions', icon: <Question size={15} />, count: overview.needsYou.openDecisions },
    { key: 'desk', label: 'Desk', icon: <FolderSimple size={15} /> },
  ]

  return (
    <Shell>
      <MatterHeader desk={desk} overview={overview} stale={failed} loadedAt={loadedAt} onChanged={refresh} />

      <div className="mt-5">
        <SegmentedTabs tabs={tabs} value={tab} onChange={changeTab} ariaLabel="Matter sections" />
      </div>

      <div className="mt-5 pb-12">
        {tab === 'conversation' && <ConversationTab matterId={id} title={overview.title} />}
        {tab === 'documents' && <DocumentsTab desk={desk} onChanged={refresh} />}
        {tab === 'evidence' && <EvidenceTab desk={desk} />}
        {tab === 'decisions' && <DecisionsTab desk={desk} onChanged={refresh} />}
        {tab === 'desk' && <DeskTab desk={desk} />}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-kumo-base">
      <div className="mx-auto w-full max-w-4xl px-6 pt-6 sm:px-10 sm:pt-9">{children}</div>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/matters"
      className="inline-flex items-center gap-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle transition-colors hover:text-kumo-default"
    >
      <ArrowLeft size={13} />
      Matters
    </Link>
  )
}

function MatterHeader({
  desk,
  overview,
  stale,
  loadedAt,
  onChanged,
}: {
  desk: RpcStub<MatterDesk>
  overview: MatterOverviewView
  stale: boolean
  loadedAt: number | null
  onChanged: () => void
}) {
  const status = statusLine(overview)
  const needs = overview.needsYou.openDecisions
  const staleMinutes = loadedAt ? Math.max(1, Math.round((Date.now() - loadedAt) / 60_000)) : null

  return (
    <header>
      <BackLink />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="m-0 truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] text-kumo-default">
              {overview.title}
            </h1>
            <Pill>{caseTypeLabel(overview.caseType)}</Pill>
          </div>
          <p className="mt-0.5 mb-0 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
            {overview.clientName}
          </p>
        </div>
        <KillSwitch desk={desk} paused={overview.status === 'paused'} onChanged={onChanged} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 flex items-center gap-2 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
          <StatusDot tone={status.tone} />
          {status.text}
        </p>
        {needs > 0 && (
          <span aria-live="polite">
            <Pill tone="needsYou">{plural(needs, 'question for you', 'questions for you')}</Pill>
          </span>
        )}
      </div>

      {stale && (
        <p className="mt-2 mb-0 text-[12.5px] leading-[18px] italic tracking-[-0.2px] text-kumo-subtle">
          This view is paused — the firm is still working on the server. Showing the state from{' '}
          {staleMinutes ? plural(staleMinutes, 'minute', 'minutes') : 'a moment'} ago; it reconnects by
          itself.
        </p>
      )}
    </header>
  )
}

function KillSwitch({
  desk,
  paused,
  onChanged,
}: {
  desk: RpcStub<MatterDesk>
  paused: boolean
  onChanged: () => void
}) {
  const toasts = useKumoToastManager()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  // If the server flips while the confirm is open, close it: the question no longer applies.
  useEffect(() => {
    if (paused) setConfirming(false)
  }, [paused])

  const set = async (status: 'open' | 'paused') => {
    setBusy(true)
    try {
      await desk.setStatus(status)
      setConfirming(false)
      onChanged()
    } catch (err) {
      logRpcFailure('Failed to change the matter status:', err, { reportSite: 'legal.setStatus' })
      toasts.add({
        title:
          status === 'paused'
            ? "Couldn't stop the firm — it is still working. Try again."
            : "Couldn't resume the firm — it is still paused. Try again.",
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  if (paused) {
    return (
      <button
        type="button"
        onClick={() => void set('open')}
        disabled={busy}
        className="press inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-kumo-warning/35 bg-kumo-warning-tint/60 px-3 text-[13px] font-medium text-kumo-warning transition-colors hover:bg-kumo-warning-tint disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Resuming…' : 'Resume the firm'}
      </button>
    )
  }

  return (
    <>
      <WorkshopButton className="shrink-0" onClick={() => setConfirming(true)} disabled={busy}>
        Stop all work
      </WorkshopButton>
      <LegalDialog
        open={confirming}
        busy={busy}
        onOpenChange={setConfirming}
        title="Stop all work on this matter?"
        description="Agents halt immediately. Nothing is lost, and you can resume anytime."
        footer={
          <>
            <WorkshopButton className="!h-9" onClick={() => setConfirming(false)} disabled={busy}>
              Keep working
            </WorkshopButton>
            <WorkshopButton tone="danger" className="!h-9" onClick={() => void set('paused')} disabled={busy}>
              {busy ? 'Stopping…' : 'Stop all work'}
            </WorkshopButton>
          </>
        }
      />
    </>
  )
}
