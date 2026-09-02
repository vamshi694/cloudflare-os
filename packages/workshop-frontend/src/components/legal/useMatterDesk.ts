import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { LegalDesk, MatterDesk, MatterOverviewView } from '@gadgets/workshop-shared/legal'
import { useAuthenticatedApi } from '../../AuthContext'
import { logRpcFailure } from '../../rpcErrors'

/**
 * Opens one matter's desk for the lifetime of a screen. Both stubs (the lawyer's LegalDesk and the
 * MatterDesk it minted) are disposed on cleanup. The stub is wrapped in a state object because
 * RPC stubs are callable Proxies and useState would treat one as an updater.
 */
export type MatterDeskState =
  | { kind: 'loading' }
  /** Matters are not turned on for this deployment (getLegalDesk returned null). */
  | { kind: 'disabled' }
  /** The matter was deleted or the link points at one this firm doesn't have. */
  | { kind: 'gone' }
  /** The firm's engine didn't answer. */
  | { kind: 'unreachable' }
  | { kind: 'ready'; desk: RpcStub<MatterDesk> }

function looksGone(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /not found|no such matter|unknown matter|does not exist/i.test(message)
}

export function useMatterDesk(matterId: string): MatterDeskState {
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<MatterDeskState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    let legal: RpcStub<LegalDesk> | null = null
    let desk: RpcStub<MatterDesk> | null = null
    setState({ kind: 'loading' })
    ;(async () => {
      try {
        const legalDesk = await authenticatedApi.getLegalDesk()
        if (cancelled) {
          legalDesk?.[Symbol.dispose]?.()
          return
        }
        if (!legalDesk) {
          setState({ kind: 'disabled' })
          return
        }
        legal = legalDesk
        const opened = await legalDesk.openMatter(matterId)
        if (cancelled) {
          opened[Symbol.dispose]?.()
          return
        }
        desk = opened
        setState({ kind: 'ready', desk: opened })
      } catch (err) {
        if (cancelled) return
        logRpcFailure('Failed to open the matter:', err)
        setState({ kind: looksGone(err) ? 'gone' : 'unreachable' })
      }
    })()
    return () => {
      cancelled = true
      desk?.[Symbol.dispose]?.()
      legal?.[Symbol.dispose]?.()
    }
  }, [authenticatedApi, matterId])

  return state
}

/**
 * The matter's overview, polled. `overview` stays null until the first load; `failed` flips on
 * any failed refresh and clears on the next good one — so the screen can tell "never loaded"
 * from "showing the last view that loaded". `refresh` forces a re-read after an action.
 */
export function useMatterOverview(desk: RpcStub<MatterDesk> | null, intervalMs = 8000) {
  const [overview, setOverview] = useState<MatterOverviewView | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!desk) return
    let cancelled = false
    const load = async () => {
      try {
        const view = await desk.overview()
        if (cancelled) return
        setOverview(view)
        setFailed(false)
        setLoadedAt(Date.now())
      } catch (err) {
        if (cancelled) return
        logRpcFailure('Failed to read the matter overview:', err)
        setFailed(true)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [desk, intervalMs, tick])

  const refresh = () => setTick((t) => t + 1)
  return { overview, failed, loadedAt, refresh }
}
