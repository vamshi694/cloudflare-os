import { useCallback, useEffect, useRef, useState } from 'react'
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

/** True while the document is visible; polling stops when the tab is hidden. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/**
 * Three-state data: `data` stays null until the first load; `failed` flips on any failed refresh
 * and clears on the next good one, so a screen can tell never-loaded from stale. `reload` forces a
 * re-read after an action. Polling (when `pollMs` is set) pauses while the tab is hidden.
 */
export function useDeskData<T>(
  load: (() => Promise<T>) | null,
  options: { pollMs?: number; deps?: unknown[] } = {},
) {
  const { pollMs, deps = [] } = options
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const visible = useVisible()
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const loader = loadRef.current
    if (!loader) return
    let cancelled = false
    const run = async () => {
      try {
        const next = await loader()
        if (cancelled) return
        setData(next)
        setFailed(false)
        setLoadedAt(Date.now())
      } catch (err) {
        if (cancelled) return
        logRpcFailure('A matter read failed:', err)
        setFailed(true)
      }
    }
    void run()
    let timer: number | undefined
    if (pollMs && visible) timer = window.setInterval(() => void run(), pollMs)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load === null, pollMs, visible, tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  /** Apply a local change immediately (after an action) without waiting for the poll. */
  const patch = useCallback((fn: (prev: T | null) => T | null) => setData(fn), [])
  return { data, failed, loadedAt, reload, patch }
}

/** The matter's overview, polled every 5 seconds while the tab is visible. */
export function useMatterOverview(desk: RpcStub<MatterDesk> | null, intervalMs = 5000) {
  const load = useCallback(() => (desk ? desk.overview() : Promise.reject(new Error('no desk'))), [desk])
  const { data, failed, loadedAt, reload } = useDeskData<MatterOverviewView>(desk ? load : null, {
    pollMs: intervalMs,
    deps: [desk],
  })
  return { overview: data, failed, loadedAt, refresh: reload }
}
