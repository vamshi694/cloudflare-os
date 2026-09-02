import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Buildings, Desktop, Moon, Sun } from '@phosphor-icons/react'
import { Tooltip } from '@cloudflare/kumo'
import type { MyUsage } from '@gadgets/workshop-shared/api'
import UserMenu from '../UserMenu'
import { useAuthenticatedApi } from '../../AuthContext'
import { useTheme } from '../../ThemeContext'
import type { ThemeMode } from '../../theme'
import { logRpcFailure } from '../../rpcErrors'

const THEME_SEQUENCE: ThemeMode[] = ['system', 'light', 'dark']
const USAGE_POLL_MS = 60_000

function dollars(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`
}

function ThemeModeButton() {
  const { themeMode, resolvedThemeMode, setThemeMode } = useTheme()
  const label = themeMode === 'system' ? `Theme: system (${resolvedThemeMode})` : `Theme: ${themeMode}`
  const nextMode = THEME_SEQUENCE[(THEME_SEQUENCE.indexOf(themeMode) + 1) % THEME_SEQUENCE.length]
  return (
    <Tooltip
      content={`${label}. Switch to ${nextMode}.`}
      render={
        <button
          type="button"
          aria-label={`${label}. Switch to ${nextMode}.`}
          onClick={() => setThemeMode(nextMode)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
        >
          {themeMode === 'system' ? <Desktop size={14} /> : themeMode === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      }
    />
  )
}

/**
 * THE CORNER — the lawyer's own card at the bottom of the rail: identity, this month's credits
 * against their allowance, and, for admins only, the door to The firm. Team management is the
 * admin's personal concern, so it lives here and never in everyone's nav.
 */
export default function CornerCard({ collapsed }: { collapsed: boolean }) {
  const { authenticatedApi, currentUser, isAdmin } = useAuthenticatedApi()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [usage, setUsage] = useState<MyUsage | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const next = await authenticatedApi.getMyUsage()
        if (cancelled) return
        setUsage(next)
        setUsageFailed(false)
      } catch (err) {
        if (cancelled) return
        logRpcFailure('Failed to read my usage:', err)
        setUsageFailed(true)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), USAGE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [authenticatedApi])

  const onTeam = pathname === '/team' || pathname.startsWith('/team/')

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 border-t border-kumo-line bg-kumo-elevated px-1.5 py-2">
        {isAdmin && (
          <Tooltip content="The firm">
            <Link
              to="/team"
              aria-label="The firm"
              className={[
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                onTeam ? 'bg-kumo-fill text-kumo-brand' : 'text-kumo-inactive hover:bg-kumo-tint hover:text-kumo-default',
              ].join(' ')}
            >
              <Buildings size={14} />
            </Link>
          </Tooltip>
        )}
        <ThemeModeButton />
        <UserMenu />
      </div>
    )
  }

  const creditsLine = usage
    ? usage.limit
      ? `${dollars(usage.cost)} of ${dollars(usage.limit)} this month`
      : `${dollars(usage.cost)} this month · no ceiling`
    : usageFailed
      ? 'Credits unavailable right now'
      : 'Reading this month…'
  const ratio = usage && usage.limit ? Math.min(1, usage.cost / usage.limit) : null

  return (
    <div className="shrink-0 border-t border-kumo-line bg-kumo-elevated px-3 py-3">
      <div className="flex items-center gap-2.5">
        <UserMenu />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[13px] leading-4 font-medium tracking-[-0.2px] text-kumo-default">
            {currentUser?.name ?? 'You'}
          </p>
          <p
            className="m-0 mt-0.5 truncate text-[11.5px] leading-4 text-kumo-subtle"
            style={{ fontVariantNumeric: 'tabular-nums' }}
            title={usage ? `Since ${usage.since.slice(0, 10)}: ${usage.turns} model turns.` : undefined}
          >
            {creditsLine}
          </p>
        </div>
        <ThemeModeButton />
      </div>
      {ratio !== null && (
        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-kumo-fill" aria-hidden>
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${ratio >= 1 ? 'bg-kumo-danger' : ratio >= 0.8 ? 'bg-kumo-warning' : 'bg-kumo-brand'}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}
      {isAdmin && (
        <Link
          to="/team"
          className={[
            'mt-2.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] leading-4 font-medium tracking-[-0.2px] transition-colors',
            onTeam ? 'bg-kumo-fill text-kumo-default' : 'text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default',
          ].join(' ')}
        >
          <Buildings size={14} className={onTeam ? 'text-kumo-brand' : 'text-kumo-inactive'} />
          The firm
          <span className="ml-auto text-[11px] font-normal text-kumo-inactive">admin</span>
        </Link>
      )}
    </div>
  )
}
