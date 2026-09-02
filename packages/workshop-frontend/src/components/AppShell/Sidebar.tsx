import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  ChatsCircle,
  MagnifyingGlass,
  Scales,
  SidebarSimple,
} from '@phosphor-icons/react'
import { useSiteName } from '../../ServerConfigContext'
import SiteLogo from '../SiteLogo'
import BrandMark from '../BrandMark'
import { useGatekeeperApps } from '../../useGatekeeperApps'
import { openCommandPalette } from './commandPaletteBus'
import SidebarItem from './SidebarItem'
import {
  SidebarMattersProvider,
  SidebarMattersTools,
  SidebarMattersLists,
} from './SidebarMatters'
import { useAuthenticatedApi } from '../../AuthContext'
import CornerCard from './CornerCard'

/**
 * The persistent left rail. Three pinned regions sandwich a single scrolling region of lists, so
 * the lawyer can always reach Search, primary nav, and their own corner card no matter how many
 * matters they have.
 *
 * Layout (top → bottom):
 *   • brand row                            pinned
 *   • primary nav (Ask, Matters, Playbook)    pinned
 *   • workspace tools (⌘K search)          pinned
 *   • Favorites / Recent workspaces        SCROLLS
 *   • utility strip (plug, avatar)         pinned
 */
export default function Sidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const siteName = useSiteName()
  // Gatekeeper-served management apps the user can reach now (one per gatekeeper that provides a UI
  // and is connected / enabled for everyone). Disabled or not-yet-connected ones aren't returned, so
  // they simply don't appear. The set is fully dynamic — no gatekeeper is hardcoded.
  const gatekeeperApps = useGatekeeperApps()
  // Platform management apps (the Context Library and its kind) are the admin's concern; a
  // practitioner's rail is Ask, Matters, Playbook and their matters.
  const { isAdmin } = useAuthenticatedApi()

  return (
    <aside
      aria-label="Primary"
      className={[
        // Sidebar is the app chrome: a hair greyer than the (lighter) content canvas so the two
        // surfaces read as distinct without a heavy divider.
        'flex h-full flex-col border-r border-kumo-line bg-kumo-elevated',
        collapsed ? 'w-[56px]' : 'w-[min(320px,100vw)] md:w-[260px]',
        'shrink-0 transition-[width] duration-200 ease-out',
      ].join(' ')}
    >
      {/* Brand row */}
      <div
        className={[
          'flex h-14 shrink-0 items-center border-b border-kumo-line',
          collapsed ? 'justify-center px-1.5' : 'justify-between gap-2 px-3',
        ].join(' ')}
      >
        <Link to="/" aria-label={siteName} className="flex min-w-0 items-center gap-2">
          <SiteLogo size={20} className="shrink-0">
            <BrandMark size={20} className="text-kumo-brand shrink-0" />
          </SiteLogo>
          {!collapsed && (
            <span className="truncate text-[14px] leading-5 font-semibold tracking-[-0.25px] text-kumo-default">
              {siteName}
            </span>
          )}
        </Link>
        {!collapsed && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => openCommandPalette()}
              aria-label="Search"
              title="Search (⌘K)"
              className="press flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
            >
              <MagnifyingGlass size={15} />
            </button>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
            >
              <SidebarSimple size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Expand affordance when collapsed — placed just under the logo for discoverability. */}
      {collapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mx-auto mt-2 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
        >
          <SidebarSimple size={15} className="rotate-180" />
        </button>
      )}

      <SidebarMattersProvider>
        {/* Pinned top stack. shrink-0 keeps it from squishing when the lists below grow. */}
        <div className="flex shrink-0 flex-col gap-3 pt-3">
          {/* Primary nav */}
          <nav className="flex flex-col gap-0.5 px-2">
            {/* Legal OS: Ask leads (the concierge spans every matter), Matters is the per-case
                drill-down that follows from it, Playbook is the firm's method. Team is deliberately
                absent: it lives behind the admin's own card in the corner. */}
            <SidebarItem
              to="/"
              label="Ask"
              icon={<ChatsCircle size={14} weight="regular" />}
              collapsed={collapsed}
            />
            <SidebarItem
              to="/matters"
              label="Matters"
              icon={<Scales size={14} weight="regular" />}
              collapsed={collapsed}
              matchPrefix
            />
            <SidebarItem
              to="/playbooks"
              label="Playbook"
              icon={<BookOpen size={14} weight="regular" />}
              collapsed={collapsed}
              matchPrefix
            />
            {/* Gatekeeper management apps (e.g. the Context Library), listed dynamically. */}
            {(isAdmin ? gatekeeperApps : []).map((app) => {
              // Escape the icon URL for safe interpolation into a CSS url("…") string.
              const maskUrl = app.icon
                ? `url("${app.icon.url.replace(/[\\"]/g, '\\$&')}")`
                : undefined
              return (
              <SidebarItem
                key={app.id}
                to="/gatekeepers/$appId"
                params={{ appId: app.id }}
                label={app.title}
                icon={
                  maskUrl ? (
                    // Render the (monochrome) app icon as a CSS mask filled with the row's current
                    // text color, so it tints like the Phosphor icons — subtle by default, accent
                    // when active, darker on hover.
                    <span
                      aria-hidden
                      className="h-3.5 w-3.5 bg-current"
                      style={{
                        maskImage: maskUrl,
                        WebkitMaskImage: maskUrl,
                        maskRepeat: 'no-repeat',
                        WebkitMaskRepeat: 'no-repeat',
                        maskPosition: 'center',
                        WebkitMaskPosition: 'center',
                        maskSize: 'contain',
                        WebkitMaskSize: 'contain',
                      }}
                    />
                  ) : (
                    <BookOpen size={14} weight="regular" />
                  )
                }
                collapsed={collapsed}
              />
              )
            })}
          </nav>

          {/* Workspace tools: search. Pinned so it's always reachable. */}
          <SidebarMattersTools collapsed={collapsed} />
        </div>

        {/* Scrolling middle: only the Favorites / Recent matters lists.
            min-h-0 lets flex children compute scroll height correctly. */}
        <div className="sidebar-scroll mt-1 min-h-0 flex-1 overflow-y-auto">
          <SidebarMattersLists collapsed={collapsed} />
        </div>
      </SidebarMattersProvider>

      <CornerCard collapsed={collapsed} />
    </aside>
  )
}
