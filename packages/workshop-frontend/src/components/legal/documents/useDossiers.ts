import { useCallback, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { MatterDesk } from '@gadgets/workshop-shared/legal'
import type { DossierState } from './FirmRead'

/**
 * The firm's read per document, fetched on demand and cached for the tab's lifetime. `ensure`
 * asks for any ids not yet requested (at most a few in flight); `invalidate` drops one after a
 * ruling so the next read is fresh.
 */
export function useDossiers(desk: RpcStub<MatterDesk>) {
  const [states, setStates] = useState<Map<string, DossierState>>(new Map())
  const requested = useRef<Set<string>>(new Set())

  const set = (id: string, s: DossierState) =>
    setStates((prev) => {
      const next = new Map(prev)
      next.set(id, s)
      return next
    })

  const ensure = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        if (requested.current.has(id)) continue
        requested.current.add(id)
        set(id, { kind: 'loading' })
        desk
          .dossier(id)
          .then((d) => set(id, { kind: 'ready', dossier: d }))
          .catch(() => set(id, { kind: 'failed' }))
      }
    },
    [desk],
  )

  const invalidate = useCallback(
    (id: string) => {
      requested.current.delete(id)
      ensure([id])
    },
    [ensure],
  )

  const get = useCallback((id: string): DossierState => states.get(id) ?? { kind: 'loading' }, [states])

  return { get, ensure, invalidate }
}

export type Dossiers = ReturnType<typeof useDossiers>
