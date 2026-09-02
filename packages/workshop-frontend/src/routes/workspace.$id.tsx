import { useEffect, useState } from 'react'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import type { LegalDesk } from '@gadgets/workshop-shared/legal'
import GadgetEditor from '../GadgetEditor'
import { useAuthenticatedApi } from '../AuthContext'
import { useDesk } from '../components/firm/useDesk'
import { logRpcFailure } from '../rpcErrors'

type GadgetSearch = {
  chat?: number
  // Selected workpiece (gadget) ID. Workpiece IDs start at 0, so parsing must not treat 0 as
  // absent.
  w?: number
}

function parseIntParam(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return undefined
}

export const Route = createFileRoute('/workspace/$id')({
  component: WorkspaceRoute,
  validateSearch: (search: Record<string, unknown>): GadgetSearch => ({
    chat: typeof search.chat === 'number' ? search.chat
      : typeof search.chat === 'string' ? Number(search.chat) || undefined
      : undefined,
    w: parseIntParam(search.w),
  }),
})

const mintLegalDesk = (api: Parameters<Parameters<typeof useDesk<LegalDesk>>[0]>[0]) => api.getLegalDesk()

type Destination =
  | { kind: 'resolving' }
  | { kind: 'matter'; matterId: string }
  | { kind: 'firm' }
  | { kind: 'platform' }

/**
 * Legal OS: a workspace is the runtime under a matter or under the firm's desk, never a place a
 * lawyer goes. A matter's workspace opens the matter (the conversation lives there); the firm's
 * workspace opens Ask the firm. Anything else is the platform editor, reachable by URL only.
 */
function WorkspaceRoute() {
  const { id } = Route.useParams()
  const { chat } = Route.useSearch()
  const { authenticatedApi } = useAuthenticatedApi()
  const desk = useDesk<LegalDesk>(mintLegalDesk, 'the matters desk')
  const [destination, setDestination] = useState<Destination>({ kind: 'resolving' })

  useEffect(() => {
    if (desk.kind === 'loading') return
    let cancelled = false
    const resolve = async () => {
      try {
        if (desk.kind === 'ready') {
          const matters = await desk.stub.listMatters()
          const owner = matters.find((m) => m.workspaceId === id)
          if (owner) return { kind: 'matter', matterId: owner.id } as const
        }
        const firmWorkspace = await authenticatedApi.ensureFirmWorkspace().catch(() => null)
        if (firmWorkspace === id) return { kind: 'firm' } as const
      } catch (err) {
        logRpcFailure('Could not place this workspace:', err)
      }
      return { kind: 'platform' } as const
    }
    void resolve().then((d) => { if (!cancelled) setDestination(d) })
    return () => { cancelled = true }
  }, [authenticatedApi, desk, id])

  if (destination.kind === 'matter') {
    return <Navigate to="/matter/$id" params={{ id: destination.matterId }} search={chat !== undefined ? { chat } : {}} replace />
  }
  if (destination.kind === 'firm') return <Navigate to="/" search={{}} replace />
  if (destination.kind === 'platform') return <GadgetEditor />
  return (
    <div className="flex min-h-full items-center justify-center bg-kumo-base">
      <p className="m-0 text-[14px] text-kumo-subtle">Opening…</p>
    </div>
  )
}
