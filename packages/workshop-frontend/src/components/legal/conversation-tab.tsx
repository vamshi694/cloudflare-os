import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk } from '@gadgets/workshop-shared/legal'
import type { AiChatAuthorInfo } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../../AuthContext'
import { logRpcFailure } from '../../rpcErrors'
import { useWorkspaceOpen } from '../../useWorkspaceOpen'
import ChatInterface from '../../ChatInterface'
import ObserverConfigModal from '../../ObserverConfigModal'
import { getStoredSelectedModel } from '../../modelSelection'
import { Notice, StatusDot } from './primitives'
import { CaseGlance } from './case-glance'
import { CONVERSATION_SUGGESTIONS } from './labels'

/** After this long, "Opening…" must admit it is taking longer than usual. */
const GRACE_MS = 12_000

type OpenState = { kind: 'opening'; slow: boolean } | { kind: 'failed' } | { kind: 'ready'; workspaceId: string }

/**
 * THE CONVERSATION — the matter's own workspace chat, inline. The matter is bound into that
 * workspace as the counsel's MATTER capability on every conversation; the lawyer never pastes it in.
 *
 * Thinking traces: the shell's chat shows the model's raw reasoning by default. A lawyer reads the
 * answer, not the machinery, so the first time a matter conversation opens on this browser the
 * "Show thinking" preference defaults to off. It is the chat's own toggle (chat options → Show
 * thinking) and sticks once flipped.
 */
export function ConversationTab({
  matterId,
  desk,
  onOpenPetition,
}: {
  matterId: string
  desk: RpcStub<MatterDesk>
  onOpenPetition: () => void
}) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<OpenState>({ kind: 'opening', slow: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    try {
      if (window.localStorage.getItem('showThinkingTraces') === null) {
        window.localStorage.setItem('showThinkingTraces', 'false')
      }
    } catch {
      /* private mode: the chat keeps its default */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'opening', slow: false })
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setState((s) => (s.kind === 'opening' ? { kind: 'opening', slow: true } : s))
    }, GRACE_MS)
    authenticatedApi
      .ensureMatterWorkspace(matterId)
      .then((workspaceId) => {
        if (!cancelled) setState({ kind: 'ready', workspaceId })
      })
      .catch((err) => {
        logRpcFailure('Failed to open the matter conversation:', err)
        if (!cancelled) setState({ kind: 'failed' })
      })
    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
    }
  }, [authenticatedApi, matterId, attempt])

  return (
    <div className="flex items-start gap-8">
      <div className="min-w-0 flex-1">
        {state.kind === 'opening' && (
          <p className="m-0 flex items-center gap-2.5 text-[15px] leading-6 text-kumo-default">
            <StatusDot tone="working" className="breathe" />
            {state.slow ? 'Still opening — the connection is taking longer than usual.' : 'Opening the conversation…'}
          </p>
        )}
        {state.kind === 'failed' && (
          <div className="space-y-3">
            <Notice
              title="The conversation can't open right now."
              body="The matter itself is untouched; reload to try again."
            />
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="press inline-flex h-8 cursor-pointer items-center rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-elevated"
            >
              Try again
            </button>
          </div>
        )}
        {state.kind === 'ready' && <EmbeddedChat workspaceId={state.workspaceId} />}
      </div>
      <aside className="hidden w-[360px] shrink-0 xl:block">
        <CaseGlance desk={desk} onOpenPetition={onOpenPetition} />
      </aside>
    </div>
  )
}

function readChatFromUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get('chat')
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? n : null
}

function writeChatToUrl(chat: number | null) {
  const url = new URL(window.location.href)
  if (chat === null) url.searchParams.delete('chat')
  else url.searchParams.set('chat', String(chat))
  window.history.replaceState(window.history.state, '', url)
}

function EmbeddedChat({ workspaceId }: { workspaceId: string }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [selectedChatId, setSelectedChatId] = useState<number | null>(() => readChatFromUrl())
  const [chatCount, setChatCount] = useState<number | null>(null)
  const [models, setModels] = useState<AiChatAuthorInfo[]>([])

  const { overseer, error, observerConfig, retry, cancelObserverConfig } = useWorkspaceOpen({
    id: workspaceId,
    authenticatedApi,
    onMetadata: () => {},
    onShareKeyConsumed: () => {},
    onInvalidShareKey: () => {},
  })

  useEffect(() => {
    let cancelled = false
    authenticatedApi
      .listModels()
      .then((list) => {
        if (!cancelled) setModels(list)
      })
      .catch((err) => logRpcFailure('Failed to list models:', err))
    return () => {
      cancelled = true
    }
  }, [authenticatedApi])

  // The matter's own wake hook ("wake the counsel when the matter changes") is the attorney's
  // standing wish, not a permission to negotiate per matter: the platform binds it disabled until
  // someone enables it, so this screen enables any hook that the matter itself delivers. Checked on
  // open and every 15 seconds, since the counsel binds it during its first turn.
  useEffect(() => {
    if (!overseer) return
    let cancelled = false
    const enableMatterHooks = async () => {
      try {
        const hooks = await overseer.stub.listHooks()
        for (const hook of hooks) {
          if (cancelled) return
          const isMatterHook = hook.resourceUrl?.startsWith('legal://matter/')
            || hook.description.title.startsWith('Wake the counsel')
          if (!hook.enabled && isMatterHook) {
            await overseer.stub.enableHook(hook.id)
          }
        }
      } catch (err) {
        logRpcFailure('Failed to enable the matter wake hook:', err)
      }
    }
    void enableMatterHooks()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void enableMatterHooks() }, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [overseer])

  const navigateToChat = useCallback((chatId: number | null) => {
    setSelectedChatId(chatId)
    writeChatToUrl(chatId)
  }, [])

  const startWith = async (text: string) => {
    if (!overseer) return
    try {
      const modelId = getStoredSelectedModel(models)
      const chat = await overseer.stub.newChat(text, modelId)
      navigateToChat(chat)
    } catch (err) {
      logRpcFailure('Failed to start the conversation:', err)
    }
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Notice title="The conversation can't open right now." body="The matter itself is untouched; reload to try again." />
        <button
          type="button"
          onClick={retry}
          className="press inline-flex h-8 cursor-pointer items-center rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default hover:bg-kumo-elevated"
        >
          Try again
        </button>
      </div>
    )
  }
  if (!overseer) {
    return (
      <p className="m-0 flex items-center gap-2.5 text-[15px] leading-6 text-kumo-default">
        <StatusDot tone="working" className="breathe" />
        Opening the conversation…
      </p>
    )
  }

  const empty = chatCount === 0 && selectedChatId === null

  return (
    <div className="space-y-4">
      {empty && (
        <div className="rise">
          <p className="m-0 text-[19px] leading-6 font-semibold tracking-[-0.3px] text-kumo-default">
            This matter's counsel. Ask anything, or give direction.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CONVERSATION_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void startWith(s)}
                className="press cursor-pointer rounded-full border border-kumo-line bg-kumo-base px-4 py-2 text-[13.5px] text-kumo-default transition-colors hover:bg-kumo-tint active:scale-[0.98]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        data-matter-chat
        className="relative flex min-h-[520px] flex-col overflow-hidden rounded-[14px] border border-kumo-line bg-kumo-base"
        style={{ height: 'calc(100vh - 380px)' }}
      >
        <ChatInterface
          key={workspaceId}
          workspaceId={workspaceId}
          overseer={overseer.stub}
          selectedChatId={selectedChatId}
          onNavigateToChat={navigateToChat}
          pendingConsoleLogCount={0}
          consoleLogPreview=""
          consoleLogSeverity="info"
          onConsumeConsoleLogs={() => ''}
          onDiscardConsoleLogs={() => {}}
          onChatCountChange={(count) => setChatCount(count)}
          constrainChatWidth
          onOpenGadget={(gadgetId) => window.open(`/workspace/${workspaceId}?gadget=${gadgetId}`, '_blank', 'noopener')}
          outputOfWorkpiece={() => undefined}
        />
      </div>
      {observerConfig && (
        <ObserverConfigModal
          needs={observerConfig.needs}
          authenticatedApi={authenticatedApi}
          onConfirm={observerConfig.resolve}
          onCancel={cancelObserverConfig}
        />
      )}
    </div>
  )
}
