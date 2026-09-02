import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import ChatInterface from '../../ChatInterface'
import { useWorkspaceOpen } from '../../useWorkspaceOpen'
import { useAuthenticatedApi } from '../../AuthContext'

/**
 * A workspace's conversation, embedded inside a Legal OS screen (the firm's desk, a matter). The
 * chat itself is the platform's; this wrapper opens the workspace, keeps the selected chat in
 * local state (the screen's URL stays the screen's), and speaks the three honest states of the
 * brief while it opens.
 */
export default function InlineConversation({
  workspaceId,
  intro,
  emptyHint,
}: {
  workspaceId: string
  /** Shown above the thread while nothing has been said yet. */
  intro?: ReactNode
  emptyHint?: string
}) {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const { overseer, error, connectionLost, retry } = useWorkspaceOpen({
    id: workspaceId,
    authenticatedApi,
    onMetadata: () => {},
    onShareKeyConsumed: () => {},
    onInvalidShareKey: () => {},
  })
  const [chatId, setChatId] = useState<number | null>(null)
  const [chatCount, setChatCount] = useState<number | null>(null)
  const [slow, setSlow] = useState(false)

  // An "Opening…" line that never resolves is a silent lie: after twelve seconds say so.
  useEffect(() => {
    if (overseer || error) return
    const t = window.setTimeout(() => setSlow(true), 12_000)
    return () => window.clearTimeout(t)
  }, [overseer, error])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <p className="m-0 text-[19px] leading-6 font-semibold tracking-[-0.3px] text-kumo-default">
          The conversation can&apos;t open right now.
        </p>
        <p className="mt-1.5 text-[13.5px] leading-5 text-kumo-subtle">
          The connection to the firm&apos;s engine failed. Nothing on your matters is affected.
        </p>
        <button
          type="button"
          onClick={retry}
          className="press mt-4 inline-flex h-9 cursor-pointer items-center rounded-lg border border-kumo-line bg-kumo-base px-3.5 text-[13px] font-medium text-kumo-default hover:bg-kumo-tint"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!overseer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <p className="m-0 text-[15px] leading-5 font-medium tracking-[-0.25px] text-kumo-default">
          {connectionLost
            ? "Can't reach the firm's engine. Retrying…"
            : slow
              ? 'Still opening — the connection is taking longer than usual.'
              : 'Opening the conversation…'}
        </p>
      </div>
    )
  }

  const showIntro = intro && chatCount === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showIntro && <div className="shrink-0">{intro}</div>}
      <div className="min-h-0 flex-1">
        <ChatInterface
          key={workspaceId}
          workspaceId={workspaceId}
          overseer={overseer.stub}
          selectedChatId={chatId}
          onNavigateToChat={(id) => setChatId(id)}
          pendingConsoleLogCount={0}
          consoleLogPreview=""
          consoleLogSeverity="info"
          onConsumeConsoleLogs={() => ''}
          onDiscardConsoleLogs={() => {}}
          onChatCountChange={(count) => setChatCount(count)}
          constrainChatWidth
          outputOfWorkpiece={() => undefined}
          onOpenGadget={() => {
            // Gadget panes belong to the full workspace editor, never to a Legal OS screen.
            void navigate({ to: '/workspace/$id', params: { id: workspaceId }, search: {} })
          }}
        />
      </div>
      {emptyHint && chatCount === 0 && (
        <p className="m-0 shrink-0 px-4 pb-2 text-center text-[12px] leading-4 text-kumo-inactive">{emptyHint}</p>
      )}
    </div>
  )
}
