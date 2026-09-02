import { Dialog } from '@cloudflare/kumo'
import { X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { WorkshopIconButton } from '../WorkshopControls'

/**
 * Shared bits for the Legal OS screens (Matters desk, matter page). Everything speaks the shell's
 * Kumo tokens, so the screens read as native to this app; the structure, copy and restraint come
 * from the Ellis design brief (docs/port/ellis-ui-brief.md).
 */

// ---------------------------------------------------------------------------
// Vocabulary: case types
// ---------------------------------------------------------------------------

export const CASE_TYPES: { value: string; label: string }[] = [
  { value: 'EB-1A', label: 'EB-1A' },
  { value: 'EB-2 NIW', label: 'EB-2 NIW' },
  { value: 'O-1A', label: 'O-1A' },
  { value: 'H-1B', label: 'H-1B' },
]

/** The category pill text. A matter without a committed strategy says so, in words. */
export function caseTypeLabel(caseType: string | null | undefined): string {
  return caseType && caseType.trim() ? caseType : 'Strategy pending'
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Mar 4, 2026" — the date a lawyer scans, never an ISO string. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "just now" / "4m ago" / "2h ago" / "3d ago" — for desk files. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Confidence as a word — a lawyer reads "likely", not "0.63". */
export function confidenceWord(confidence: number): 'solid' | 'likely' | 'unsure' {
  if (confidence >= 0.8) return 'solid'
  if (confidence >= 0.6) return 'likely'
  return 'unsure'
}

/** Underscores → spaces, first letter capitalised. */
export function tidy(s: string): string {
  const spaced = s.replace(/[_-]+/g, ' ').trim()
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : spaced
}

// ---------------------------------------------------------------------------
// The status-dot vocabulary — the one primitive every screen repeats.
// ---------------------------------------------------------------------------

export type DotTone =
  /** the firm is working right now (breathes) */
  | 'working'
  /** done / ready */
  | 'ready'
  /** needs you */
  | 'needsYou'
  /** paused by you, or thin / needed */
  | 'paused'
  /** resting */
  | 'quiet'
  /** nothing yet */
  | 'hollow'

const DOT_CLASS: Record<DotTone, string> = {
  working: 'bg-kumo-success animate-pulse motion-reduce:animate-none',
  ready: 'bg-kumo-success',
  needsYou: 'bg-kumo-danger',
  paused: 'bg-kumo-warning',
  quiet: 'bg-kumo-interact',
  hollow: 'border border-kumo-line bg-transparent',
}

export function StatusDot({ tone, className = '' }: { tone: DotTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[tone]} ${className}`}
    />
  )
}

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------

export type PillTone = 'neutral' | 'needsYou' | 'warning' | 'ready'

const PILL_CLASS: Record<PillTone, string> = {
  neutral: 'bg-kumo-tint text-kumo-default',
  needsYou: 'border border-kumo-danger/25 bg-kumo-danger-tint/60 text-kumo-danger',
  warning: 'border border-kumo-warning/35 bg-kumo-warning-tint/60 text-kumo-warning',
  ready: 'bg-kumo-success-tint/60 text-kumo-success',
}

export function Pill({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: PillTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] leading-4 font-medium tracking-[-0.1px] whitespace-nowrap ${PILL_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Loading shapes
// ---------------------------------------------------------------------------

/** A skeleton means loading. A failed fetch never shimmers — see ThreeState. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-kumo-tint motion-reduce:animate-none ${className}`}
    />
  )
}

/**
 * Honest error copy: name what failed, state that nothing was lost, say what happens next.
 * `tone="stale"` is the quieter, one-line form used above a list that has loaded before.
 */
export function Notice({
  title,
  body,
  tone = 'error',
}: {
  title: string
  body?: string
  tone?: 'error' | 'stale' | 'info'
}) {
  if (tone === 'stale') {
    return (
      <p className="m-0 text-[12.5px] leading-[18px] italic tracking-[-0.2px] text-kumo-subtle">
        {title}
      </p>
    )
  }
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className="rounded-xl border border-kumo-line bg-kumo-base px-4 py-4"
    >
      <p
        className={`m-0 text-[13px] leading-[18px] font-medium tracking-[-0.25px] ${
          tone === 'error' ? 'text-kumo-danger' : 'text-kumo-default'
        }`}
      >
        {title}
      </p>
      {body && (
        <p className="mt-1 text-[12.5px] leading-[18px] tracking-[-0.2px] text-kumo-subtle">
          {body}
        </p>
      )}
    </div>
  )
}

/** The empty sentence — genuinely nothing here, which is different from not-yet-loaded. */
export function EmptyLine({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-kumo-line bg-kumo-base px-6 py-8 text-center">
      <p className="m-0 text-[14px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">
        {title}
      </p>
      {body && (
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          {body}
        </p>
      )}
    </div>
  )
}

/**
 * Three-state list: never-loaded ≠ stale ≠ empty — different sentences.
 *
 *   items === null && !failed  → skeleton
 *   items === null &&  failed  → the never-loaded error (nothing was lost)
 *   items !== null &&  failed  → the list, with a quiet "not updating" line above it
 *   items.length === 0         → the empty sentence
 */
export function ThreeState<T>({
  items,
  failed,
  skeleton,
  neverLoaded,
  stale,
  empty,
  children,
}: {
  items: T[] | null
  failed: boolean
  skeleton: ReactNode
  neverLoaded: { title: string; body: string }
  stale: string
  empty: ReactNode
  children: (items: T[]) => ReactNode
}) {
  if (items === null) {
    return failed ? <Notice title={neverLoaded.title} body={neverLoaded.body} /> : <>{skeleton}</>
  }
  return (
    <>
      {failed && (
        <div className="mb-3">
          <Notice tone="stale" title={stale} />
        </div>
      )}
      {items.length === 0 ? empty : children(items)}
    </>
  )
}

// ---------------------------------------------------------------------------
// Segmented tab bar — a recessed track that hugs its tabs; the active pill lifts.
// ---------------------------------------------------------------------------

export type SegmentedTab<K extends string> = {
  key: K
  label: string
  icon?: ReactNode
  count?: number
}

export function SegmentedTabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: SegmentedTab<K>[]
  value: K
  onChange: (key: K) => void
  ariaLabel: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="sidebar-scroll flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-xl bg-kumo-recessed p-1"
    >
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={[
              'press inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] px-3 text-[13px] leading-[18px] tracking-[-0.25px] whitespace-nowrap transition-colors',
              active
                ? 'themed-card-hover-shadow bg-kumo-base font-medium text-kumo-default'
                : 'font-normal text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default',
            ].join(' ')}
          >
            {tab.icon && (
              <span className={active ? 'text-kumo-brand' : 'text-kumo-inactive'}>{tab.icon}</span>
            )}
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <span
                className="rounded-full bg-kumo-fill px-1.5 py-0.5 text-[11.5px] leading-none text-kumo-subtle"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog shell — the shape DeleteConfirmationDialog uses, generalised for forms and readers.
// ---------------------------------------------------------------------------

export function LegalDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'sm',
  busy = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** sm = a form (420px); lg = a reader (min(860px, viewport)). */
  size?: 'sm' | 'lg'
  busy?: boolean
}) {
  const width = size === 'lg' ? '!w-[min(860px,calc(100vw-32px))]' : '!w-[min(440px,calc(100vw-32px))]'
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <Dialog
        className={`responsive-dialog !z-[1000] ${width} overflow-hidden bg-kumo-base p-0 !top-[12%] !-translate-y-0`}
        size={size === 'lg' ? 'lg' : 'sm'}
      >
        <div className="flex items-start justify-between gap-4 border-b border-kumo-line px-5 py-4">
          <div className="min-w-0">
            <Dialog.Title className="text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">
              {title}
            </Dialog.Title>
            {description && (
              <Dialog.Description className="mt-1 text-[12.5px] leading-[18px] tracking-[-0.2px] text-kumo-subtle">
                {description}
              </Dialog.Description>
            )}
          </div>
          <Dialog.Close
            render={(props) => (
              <WorkshopIconButton {...props} className="!h-7 !w-7" disabled={busy} aria-label="Close">
                <X size={16} />
              </WorkshopIconButton>
            )}
          />
        </div>
        {children && (
          <div
            // The body scrolls; the header and the footer stay in reach on a short screen, so the
            // action is never below the fold (caught live: a 720px viewport hid "Open the matter").
            className={size === 'lg' ? 'max-h-[70vh] overflow-y-auto px-5 py-4' : 'max-h-[calc(88vh-150px)] overflow-y-auto px-5 py-4'}
          >
            {children}
          </div>
        )}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-kumo-line bg-kumo-base px-5 py-3">
            {footer}
          </div>
        )}
      </Dialog>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// Radio rows — options as rows a lawyer can read, with a native control.
// ---------------------------------------------------------------------------

export function RadioRow({
  name,
  value,
  checked,
  onChange,
  children,
  disabled = false,
}: {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <label
      className={[
        'flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] leading-[19px] tracking-[-0.25px] transition-colors',
        checked ? 'bg-kumo-tint text-kumo-default' : 'text-kumo-default hover:bg-kumo-elevated',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-[3px] shrink-0 accent-kumo-brand"
      />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

/** Field label + hint, in the shell's register. */
export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <span className="block text-[12.5px] leading-4 font-medium tracking-[-0.2px] text-kumo-default">
        {children}
      </span>
      {hint && (
        <span className="mt-0.5 block text-[12px] leading-4 tracking-[-0.1px] text-kumo-subtle">
          {hint}
        </span>
      )}
    </div>
  )
}

/** A quiet uppercase eyebrow for grouping within a tab. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 text-[11px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">
      {children}
    </h3>
  )
}
