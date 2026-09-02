import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { ChatCircleDots, ChatsCircle, Files, FolderSimple, Graph, Scroll, UserCircle } from '@phosphor-icons/react'
import { useDocumentTitle } from '../useDocumentTitle'
import { Notice, SegmentedTabs, Skeleton, type SegmentedTab } from '../components/legal/primitives'
import { useMatterDesk, useMatterOverview } from '../components/legal/useMatterDesk'
import { BackLink, MatterHeader } from '../components/legal/matter-header'
import { NeedsYou } from '../components/legal/needs-you'
import { ConversationTab } from '../components/legal/conversation-tab'
import { DocumentsTab } from '../components/legal/documents/DocumentsTab'
import { CaseMapTab } from '../components/legal/case-map/CaseMapTab'
import { WorkspaceTab } from '../components/legal/workbench/WorkspaceTab'
import { ClientTab } from '../components/legal/client-tab'
import { MessagesTab } from '../components/legal/messages-tab'
import { DeskTab } from '../components/legal/desk-tab'
import { matterTitle } from '../components/legal/labels'

/**
 * THE TAB REGISTRY — the one place a matter's surfaces are declared. ORDER = the lawyer's mental
 * model: work the matter, read the record, see the case, then the work product, then the person
 * behind it, Desk last. Visibility is decided from the snapshot the page already holds, never from
 * a tab's own fetch. Unmounted tabs cost zero.
 */
const TAB_KEYS = ['conversation', 'documents', 'map', 'petition', 'client', 'messages', 'desk'] as const
type TabKey = (typeof TAB_KEYS)[number]
const isTabKey = (v: unknown): v is TabKey => typeof v === 'string' && (TAB_KEYS as readonly string[]).includes(v)

type MatterSearch = { tab?: TabKey; chat?: number }

export const Route = createFileRoute('/matter/$id')({
  component: MatterPage,
  validateSearch: (search: Record<string, unknown>): MatterSearch => ({
    tab: isTabKey(search.tab) ? search.tab : undefined,
    chat: typeof search.chat === 'number' ? search.chat : typeof search.chat === 'string' && search.chat !== '' && Number.isFinite(Number(search.chat)) ? Number(search.chat) : undefined,
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
  if (tab !== 'conversation') url.searchParams.delete('chat')
  window.history.replaceState(window.history.state, '', url)
}

function MatterPage() {
  const { id } = Route.useParams()
  const deskState = useMatterDesk(id)
  const desk = deskState.kind === 'ready' ? deskState.desk : null
  const { overview, failed, loadedAt, refresh } = useMatterOverview(desk)
  useDocumentTitle(overview ? matterTitle(overview.title, overview.caseType) : 'Matter')

  const [tab, setTab] = useState<TabKey>(() => readTabFromUrl())
  const changeTab = (next: TabKey) => {
    setTab(next)
    writeTabToUrl(next)
  }

  // Wide tabs (the workbench, the map) get the whole viewport; the rest read at a column.
  const wide = tab === 'petition' || tab === 'map' || tab === 'documents' || tab === 'conversation'

  useEffect(() => {
    if (tab === 'messages' && overview && !overview.hasClientRecord && overview.clientMessages === 0) {
      /* stay: the lawyer is already on it */
    }
  }, [tab, overview])

  if (deskState.kind === 'disabled' || deskState.kind === 'gone' || deskState.kind === 'unreachable') {
    return (
      <Shell wide={false}>
        <BackLink />
        <div className="mt-4">
          {deskState.kind === 'gone' ? (
            <Notice tone="info" title="This matter is no longer here." body="It was deleted, or the link points at a matter this firm doesn't have. Nothing on your other matters is affected." />
          ) : deskState.kind === 'disabled' ? (
            <Notice tone="info" title="Matters aren't turned on for this deployment." body="The Matters gatekeeper is disabled. Nothing is lost — an admin can enable it under Gatekeepers." />
          ) : (
            <Notice title="This matter can't be loaded." body="The firm's engine didn't answer. The matter and its record are untouched — this screen just can't read them right now. It keeps retrying." />
          )}
        </div>
      </Shell>
    )
  }

  if (!desk || !overview) {
    return (
      <Shell wide={false}>
        <BackLink />
        {failed ? (
          <div className="mt-4">
            <Notice title="This matter can't be loaded." body="The firm's engine didn't answer. The matter and its record are untouched — this screen just can't read them right now. It keeps retrying." />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-6 h-10 w-[520px] max-w-full" />
            <Skeleton className="h-[160px]" />
          </div>
        )}
      </Shell>
    )
  }

  const showMessages = overview.hasClientRecord || overview.clientMessages > 0 || tab === 'messages'
  const tabs: SegmentedTab<TabKey>[] = [
    { key: 'conversation', label: 'Conversation', icon: <ChatCircleDots size={15} /> },
    { key: 'documents', label: 'Documents', icon: <Files size={15} />, count: overview.record.documents || undefined },
    { key: 'map', label: 'Case map', icon: <Graph size={15} /> },
    { key: 'petition', label: 'Workspace', icon: <Scroll size={15} /> },
    { key: 'client', label: 'Client', icon: <UserCircle size={15} /> },
    ...(showMessages ? [{ key: 'messages' as const, label: 'Messages', icon: <ChatsCircle size={15} />, count: overview.clientMessages || undefined }] : []),
    { key: 'desk', label: 'Desk', icon: <FolderSimple size={15} /> },
  ]

  return (
    <Shell wide={wide}>
      <MatterHeader desk={desk} overview={overview} stale={failed} loadedAt={loadedAt} onChanged={refresh} />

      {overview.needsYouItems.length > 0 && (
        <div className="mt-4">
          <NeedsYou desk={desk} items={overview.needsYouItems} onChanged={refresh} onOpenDocuments={() => changeTab('documents')} />
        </div>
      )}

      <div className="mt-5">
        <SegmentedTabs tabs={tabs} value={tab} onChange={changeTab} ariaLabel="Matter sections" />
      </div>

      <div className="mt-5 pb-12">
        {tab === 'conversation' && <ConversationTab matterId={id} desk={desk} onOpenPetition={() => changeTab('petition')} />}
        {tab === 'documents' && <DocumentsTab desk={desk} onChanged={refresh} />}
        {tab === 'map' && <CaseMapTab desk={desk} />}
        {tab === 'petition' && <WorkspaceTab desk={desk} caseType={overview.caseType} />}
        {tab === 'client' && <ClientTab desk={desk} caseType={overview.caseType} onChanged={refresh} />}
        {tab === 'messages' && <MessagesTab desk={desk} onChanged={refresh} />}
        {tab === 'desk' && <DeskTab desk={desk} />}
      </div>
    </Shell>
  )
}

function Shell({ children, wide }: { children: ReactNode; wide: boolean }) {
  return (
    <div className="h-full overflow-y-auto bg-kumo-base">
      <div className={`mx-auto w-full px-6 pt-6 sm:px-10 sm:pt-9 ${wide ? 'max-w-[1440px]' : 'max-w-4xl'}`}>{children}</div>
    </div>
  )
}
