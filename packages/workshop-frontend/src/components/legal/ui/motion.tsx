import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Motion primitives for the Legal OS screens. Every one collapses under reduced motion. Calm and
 * spring-shaped (critically damped, no bounce): things materialize once and settle.
 */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/** Mount only while the firm is working: the narrated status line carries a slow shimmer. */
export function TextShimmer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`text-shimmer ${className}`}>{children}</span>
}

/** A row that arrives: a spring settle from 6px below. */
export function Appear({
  children,
  as = 'div',
  className = '',
}: {
  children: ReactNode
  as?: 'div' | 'li'
  className?: string
}) {
  const Tag = as
  return <Tag className={`rise ${className}`}>{children}</Tag>
}

/**
 * The page-count odometer: when the value changes, the old number leaves upward and the new one
 * settles in from below. Tabular numerals so the width never jitters.
 */
export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(value)
  const [leaving, setLeaving] = useState<number | null>(null)
  const prev = useRef(value)

  useEffect(() => {
    if (prev.current === value) return
    if (reduced) {
      prev.current = value
      setShown(value)
      return
    }
    setLeaving(prev.current)
    prev.current = value
    setShown(value)
    const t = window.setTimeout(() => setLeaving(null), 420)
    return () => window.clearTimeout(t)
  }, [value, reduced])

  return (
    <span className={`tnum relative inline-block overflow-hidden align-baseline ${className}`} aria-live="polite">
      <span key={shown} className={leaving === null ? '' : 'odometer-in'} style={{ display: 'inline-block' }}>
        {shown}
      </span>
      {leaving !== null && (
        <span aria-hidden className="odometer-out absolute inset-x-0 top-0" style={{ display: 'inline-block' }}>
          {leaving}
        </span>
      )}
      <style>{`
        .odometer-in { animation: legal-odo-in 420ms cubic-bezier(0.2,0.8,0.2,1) both; }
        .odometer-out { animation: legal-odo-out 420ms cubic-bezier(0.2,0.8,0.2,1) both; }
        @keyframes legal-odo-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
        @keyframes legal-odo-out { from { transform: none; opacity: 1; } to { transform: translateY(-12px); opacity: 0; } }
      `}</style>
    </span>
  )
}

/** A 12px spinner for the one reason it exists: a click that takes a moment must not look ignored. */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none ${className}`}
    />
  )
}
