import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { ArrowRight, CaretDown, MagnifyingGlass, Star } from '@phosphor-icons/react'
import type { LegalDesk, MatterListEntry } from '@gadgets/workshop-shared/legal'
import { openCommandPalette } from './commandPaletteBus'
import { useDesk, usePolled } from '../firm/useDesk'
import { PHASE_LABEL, matterTitle } from '../legal/labels'

/**
 * THE RAIL'S LISTS ARE MATTERS. A lawyer's day is their matters, not the platform's workspaces
 * underneath them: Favorites and Recent name matters, each with its type, one status word and
 * what needs the lawyer. Favorites live in this browser (localStorage) because a favorite is a
 * personal convenience, not a fact about the matter.
 */

const RECENT_LIMIT = 6
const FAVORITES_KEY = 'legal-os:favorite-matters'
const POLL_MS = 30_000

function readFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeFavorites(ids: Set<string>) {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]))
  } catch {
    /* private mode: favorites do not persist, the rail still works */
  }
}

type MattersContextValue = {
  matters: MatterListEntry[] | null
  failed: boolean
  disabled: boolean
  favorites: MatterListEntry[]
  recent: MatterListEntry[]
  isFavorite: (id: string) => boolean
  toggleFavorite: (id: string) => void
}

const MattersContext = createContext<MattersContextValue | null>(null)

function useMattersContext(): MattersContextValue {
  const ctx = useContext(MattersContext)
  if (!ctx) throw new Error('Sidebar matters components must be rendered inside SidebarMattersProvider')
  return ctx
}

const mintDesk = (api: Parameters<Parameters<typeof useDesk<LegalDesk>>[0]>[0]) => api.getLegalDesk()

function needsCount(m: MatterListEntry): number {
  return m.needsYou.openDecisions + m.needsYou.unreadableDocuments
}

/** Needs-you first, then paused, then the newest. The desk page carries the fuller ordering. */
function byUrgency(a: MatterListEntry, b: MatterListEntry): number {
  const na = needsCount(a), nb = needsCount(b)
  if ((na > 0) !== (nb > 0)) return na > 0 ? -1 : 1
  if ((a.status === 'paused') !== (b.status === 'paused')) return a.status === 'paused' ? -1 : 1
  return b.createdAt.localeCompare(a.createdAt)
}

export function SidebarMattersProvider({ children }: { children: ReactNode }) {
  const desk = useDesk<LegalDesk>(mintDesk, 'the matters desk')
  // A new matter shows up in the rail as soon as the lawyer lands anywhere under Matters.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const read = desk.kind === 'ready' ? () => desk.stub.listMatters() : null
  const { data, failed } = usePolled<MatterListEntry[]>(read, POLL_MS, [desk.kind, pathname])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => readFavorites())

  const toggleFavorite = useCallback((id: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeFavorites(next)
      return next
    })
  }, [])
  const isFavorite = useCallback((id: string) => favoriteIds.has(id), [favoriteIds])

  const { favorites, recent } = useMemo(() => {
    const all = [...(data ?? [])].sort(byUrgency)
    return {
      favorites: all.filter((m) => favoriteIds.has(m.id)),
      recent: all.filter((m) => !favoriteIds.has(m.id)),
    }
  }, [data, favoriteIds])

  const value: MattersContextValue = {
    matters: data,
    failed,
    disabled: desk.kind === 'disabled',
    favorites,
    recent,
    isFavorite,
    toggleFavorite,
  }
  return <MattersContext.Provider value={value}>{children}</MattersContext.Provider>
}

/** Collapsed rail: the search glyph moves down here because the brand row hides its buttons. */
export function SidebarMattersTools({ collapsed = false }: { collapsed?: boolean }) {
  if (!collapsed) return null
  return (
    <div className="flex flex-col items-center px-2">
      <button
        type="button"
        onClick={() => openCommandPalette()}
        aria-label="Search"
        title="Search (⌘K)"
        className="press flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default"
      >
        <MagnifyingGlass size={15} />
      </button>
    </div>
  )
}

export function SidebarMattersLists({ collapsed = false }: { collapsed?: boolean }) {
  const { matters, failed, disabled, favorites, recent, isFavorite, toggleFavorite } = useMattersContext()
  const [favOpen, setFavOpen] = useState(true)
  const [recentOpen, setRecentOpen] = useState(true)

  if (disabled) return null

  if (collapsed) {
    const compact = [...favorites, ...recent].slice(0, 8)
    return (
      <div className="flex flex-col items-center gap-1.5 px-2">
        {compact.map((m) => (
          <MatterRow key={m.id} matter={m} collapsed favorite={isFavorite(m.id)} onToggleFavorite={toggleFavorite} />
        ))}
      </div>
    )
  }

  const recentShown = recent.slice(0, RECENT_LIMIT)

  return (
    <div className="flex flex-col pb-3">
      <SidebarSection
        label="Favorites"
        count={favorites.length}
        open={favOpen}
        onToggle={() => setFavOpen((o) => !o)}
        icon={<Star size={12} weight="regular" className="text-kumo-inactive" />}
      >
        {favorites.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[12px] leading-4 tracking-[-0.2px] text-kumo-inactive">
            Favorite a matter to keep it here.
          </p>
        ) : (
          <div className="flex flex-col">
            {favorites.map((m) => (
              <MatterRow key={m.id} matter={m} favorite onToggleFavorite={toggleFavorite} />
            ))}
          </div>
        )}
      </SidebarSection>

      <SidebarSection label="Recent matters" open={recentOpen} onToggle={() => setRecentOpen((o) => !o)}>
        {matters === null ? (
          failed ? (
            <p className="px-2.5 py-1.5 text-[12px] leading-4 tracking-[-0.2px] text-kumo-inactive">
              Your matters couldn&apos;t be loaded. Nothing has changed on any matter.
            </p>
          ) : (
            <div className="flex flex-col gap-1 px-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 rounded-md bg-kumo-tint animate-pulse" />
              ))}
            </div>
          )
        ) : recent.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[12px] leading-4 tracking-[-0.2px] text-kumo-inactive">
            {favorites.length > 0 ? 'Every matter is a favorite.' : 'No matters yet.'}
          </p>
        ) : (
          <>
            {failed && (
              <p className="px-2.5 pb-1 text-[11.5px] italic leading-4 text-kumo-inactive">Not updating right now.</p>
            )}
            <div className="flex flex-col">
              {recentShown.map((m) => (
                <MatterRow key={m.id} matter={m} favorite={false} onToggleFavorite={toggleFavorite} />
              ))}
            </div>
            <Link
              to="/matters"
              className="mt-0.5 flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium tracking-[-0.2px] text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default"
            >
              {recent.length > RECENT_LIMIT ? `All matters (${matters.length})` : 'All matters'}
              <ArrowRight size={11} weight="bold" />
            </Link>
          </>
        )}
      </SidebarSection>
    </div>
  )
}

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || title.slice(0, 2).toUpperCase()
}

/** One status word for the row: the phase in lawyer language, with paused outranking it. */
function statusWord(m: MatterListEntry): { text: string; tone: 'paused' | 'working' | 'quiet' } {
  if (m.status === 'paused') return { text: 'Paused by you', tone: 'paused' }
  const working = m.phase === 'reading' || m.phase === 'knowledge' || m.phase === 'analysis' || m.phase === 'building'
  return { text: PHASE_LABEL[m.phase], tone: working ? 'working' : 'quiet' }
}

function MatterRow({
  matter,
  collapsed = false,
  favorite,
  onToggleFavorite,
}: {
  matter: MatterListEntry
  collapsed?: boolean
  favorite: boolean
  onToggleFavorite: (id: string) => void
}) {
  const title = matterTitle(matter.title, matter.caseType)
  const needs = needsCount(matter)
  const status = statusWord(matter)

  if (collapsed) {
    return (
      <Link
        to="/matter/$id"
        params={{ id: matter.id }}
        title={needs > 0 ? `${title} · ${needs} need${needs === 1 ? 's' : ''} you` : title}
        className="relative flex h-8 w-8 items-center justify-center rounded-md bg-kumo-fill text-[10px] font-medium text-kumo-subtle transition-colors hover:bg-kumo-interact"
        activeProps={{ className: 'relative flex h-8 w-8 items-center justify-center rounded-md bg-kumo-fill text-[10px] font-medium text-kumo-strong ring-1 ring-kumo-ring' }}
      >
        {initials(title)}
        {needs > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-kumo-danger" />}
      </Link>
    )
  }

  return (
    <Link
      to="/matter/$id"
      params={{ id: matter.id }}
      className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-kumo-tint"
      activeProps={{ className: 'group flex items-start gap-2 rounded-lg px-2 py-1.5 bg-kumo-fill' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">{title}</span>
          <span className="shrink-0 rounded-full bg-kumo-fill px-1.5 text-[10.5px] leading-4 text-kumo-subtle">
            {matter.caseType ?? 'Pending'}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4">
          <span
            aria-hidden
            className={[
              'h-1.5 w-1.5 shrink-0 rounded-full',
              status.tone === 'paused' ? 'bg-amber-500' : status.tone === 'working' ? 'breathe bg-emerald-600' : 'bg-kumo-interact',
            ].join(' ')}
          />
          <span className={['min-w-0 truncate', status.tone === 'paused' ? 'text-amber-700' : 'text-kumo-subtle'].join(' ')}>
            {status.text}
          </span>
          {needs > 0 && (
            <span className="tnum ml-auto shrink-0 rounded-full bg-kumo-danger-tint px-1.5 text-[10.5px] font-medium text-kumo-danger">
              {needs} need{needs === 1 ? 's' : ''} you
            </span>
          )}
        </div>
      </div>
      {/* Inside the row's <Link>: preventDefault stops the native <a>, stopPropagation the SPA handler. */}
      <button
        type="button"
        aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={favorite}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onToggleFavorite(matter.id)
        }}
        className={[
          'mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-kumo-subtle transition-[opacity,color,background-color] hover:bg-kumo-fill hover:text-kumo-default focus-visible:opacity-100',
          favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-60',
        ].join(' ')}
      >
        <Star size={12} weight={favorite ? 'fill' : 'regular'} />
      </button>
    </Link>
  )
}

function SidebarSection({
  label,
  count,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string
  count?: number
  icon?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="mt-3 flex flex-col px-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-6 cursor-pointer items-center gap-1 px-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-kumo-inactive transition-colors hover:text-kumo-subtle"
      >
        <CaretDown size={10} weight="bold" className={['transition-transform', open ? '' : '-rotate-90'].join(' ')} />
        {icon}
        <span>{label}</span>
        {count !== undefined && <span className="ml-1 text-kumo-inactive">{count}</span>}
      </button>
      {open && <div className="mt-0.5">{children}</div>}
    </div>
  )
}

/** Exposed for the corner card or any screen that wants the same favorite set. */
export function useFavoriteMatters(): { ids: Set<string>; toggle: (id: string) => void } {
  const [ids, setIds] = useState<Set<string>>(() => readFavorites())
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAVORITES_KEY) setIds(readFavorites())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeFavorites(next)
      return next
    })
  }, [])
  return { ids, toggle }
}
