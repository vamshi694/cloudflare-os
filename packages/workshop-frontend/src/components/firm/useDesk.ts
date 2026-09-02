import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../../AuthContext'
import { logRpcFailure } from '../../rpcErrors'

/**
 * Mint one RPC desk (the lawyer's matters, the playbooks) for the lifetime of a screen and
 * dispose it on the way out. The stub is wrapped in an object because RPC stubs are callable
 * Proxies and useState would treat one as an updater.
 */
export type DeskState<T> =
  | { kind: 'loading' }
  /** The gatekeeper behind this desk is disabled on this deployment. */
  | { kind: 'disabled' }
  | { kind: 'failed' }
  | { kind: 'ready'; stub: RpcStub<T> }

export function useDesk<T extends object>(
  mint: (api: RpcStub<AuthenticatedApi>) => Promise<RpcStub<T> | null>,
  what: string,
): DeskState<T> {
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<DeskState<T>>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    let stub: RpcStub<T> | null = null
    setState({ kind: 'loading' })
    mint(authenticatedApi)
      .then((minted) => {
        if (cancelled) {
          minted?.[Symbol.dispose]?.()
          return
        }
        if (!minted) {
          setState({ kind: 'disabled' })
          return
        }
        stub = minted
        setState({ kind: 'ready', stub: minted })
      })
      .catch((err) => {
        logRpcFailure(`Failed to open ${what}:`, err)
        if (!cancelled) setState({ kind: 'failed' })
      })
    return () => {
      cancelled = true
      stub?.[Symbol.dispose]?.()
    }
    // `mint` is a stable module-level function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticatedApi, what])

  return state
}

/**
 * A polled read with three states: never loaded (null), loaded, and loaded-but-failing. `failed`
 * clears on the next good read so a screen can say "not updating" and keep the last good view.
 */
export function usePolled<T>(
  read: (() => Promise<T>) | null,
  intervalMs: number,
  deps: unknown[] = [],
): { data: T | null; failed: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!read) return
    let cancelled = false
    const load = async () => {
      try {
        const next = await read()
        if (cancelled) return
        setData(next)
        setFailed(false)
      } catch (err) {
        if (cancelled) return
        logRpcFailure('Polled read failed:', err)
        setFailed(true)
      }
    }
    void load()
    const timer = intervalMs > 0 ? window.setInterval(() => void load(), intervalMs) : null
    return () => {
      cancelled = true
      if (timer !== null) window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, intervalMs, tick, ...deps])

  return { data, failed, refresh: () => setTick((t) => t + 1) }
}
