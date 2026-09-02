import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, ChatCircleDots } from '@phosphor-icons/react'
import { useAuthenticatedApi } from '../../AuthContext'
import { logRpcFailure } from '../../rpcErrors'
import { Notice, StatusDot } from './primitives'

/** After this long, "Opening…" must admit it is taking longer than usual. */
const GRACE_MS = 12_000

type State =
  | { kind: 'opening'; slow: boolean }
  | { kind: 'failed' }
  | { kind: 'ready'; workspaceId: string }

/**
 * The matter's conversation lives in a workspace chat the matter is bound into. This tab makes
 * sure that workspace exists (once) and hands the lawyer the door. Embedding the chat inline is a
 * later step.
 */
export function ConversationTab({ matterId, title }: { matterId: string; title: string }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<State>({ kind: 'opening', slow: false })
  const [attempt, setAttempt] = useState(0)

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

  if (state.kind === 'opening') {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-kumo-line bg-kumo-base px-5 py-5">
        <StatusDot tone="working" />
        <p className="m-0 text-[13.5px] leading-5 tracking-[-0.25px] text-kumo-subtle">
          {state.slow
            ? 'Still opening — the connection is taking longer than usual.'
            : 'Opening the conversation…'}
        </p>
      </div>
    )
  }

  if (state.kind === 'failed') {
    return (
      <div className="space-y-3">
        <Notice
          title="The conversation can't open right now."
          body="The matter itself is untouched — its documents, evidence and decisions are all still here. Try again in a moment."
        />
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="press inline-flex h-8 cursor-pointer items-center rounded-lg border border-kumo-line bg-kumo-base px-3 text-[13px] font-medium text-kumo-default transition-colors hover:bg-kumo-elevated"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-kumo-line bg-kumo-base px-6 py-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-kumo-tint text-kumo-subtle">
          <ChatCircleDots size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">
            This matter's counsel
          </p>
          <p className="mt-1 text-[13px] leading-[19px] tracking-[-0.25px] text-kumo-subtle">
            Ask anything about {title}, or give direction. The matter is bound into this workspace
            as a connection the counsel can use — its documents, the evidence drawn from them, the
            open questions and the desk are all within reach of the conversation.
          </p>
          <Link
            to="/workspace/$id"
            params={{ id: state.workspaceId }}
            className="press mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-kumo-contrast px-3.5 text-[13px] font-medium text-kumo-inverse transition-colors hover:bg-kumo-strong"
          >
            Open the conversation
            <ArrowRight size={14} weight="bold" />
          </Link>
        </div>
      </div>
    </div>
  )
}
