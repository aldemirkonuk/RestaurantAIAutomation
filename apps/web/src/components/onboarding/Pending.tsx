import { useEffect, useState } from 'react'

/**
 * A wait that says its state in words. In normal motion it spins; under
 * prefers-reduced-motion (ADR 0112: reduced motion = no animation) it is a
 * still ring, and the label is the whole signal. The ring keeps one box in
 * both modes, so the wait never changes size (CLS 0). A <Pending> with no
 * label is decorative (aria-hidden, no role): put the words on the page.
 */
const QUERY = '(prefers-reduced-motion: reduce)'

function readReduced(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY)?.matches
  } catch {
    return false
  }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReduced)
  useEffect(() => {
    const m = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined
    if (!m) return
    const sync = () => setReduced(!!m.matches)
    sync()
    m.addEventListener?.('change', sync)
    return () => m.removeEventListener?.('change', sync)
  }, [])
  return reduced
}

const RING = { sm: 'w-4 h-4 border-2', md: 'w-5 h-5 border-2', lg: 'w-12 h-12 border-4' } as const

export function Pending({
  label,
  decorative = false,
  size = 'sm',
  className = '',
}: {
  label?: string
  /** A ring with no words beside it. Required when there is no label (the guard checks the call sites). */
  decorative?: boolean
  size?: keyof typeof RING
  /** Colour and opacity of the ring and the words, e.g. "text-white". */
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const ring = reduced
    ? `${RING[size]} rounded-full border-current opacity-50`
    : `${RING[size]} rounded-full border-current border-t-transparent animate-spin`
  // With no words it is only a ring: a decoration, not a status. An empty
  // live region says nothing and doubles the real one on the page (r107).
  if (!label || decorative) {
    return (
      <span aria-hidden="true" className={`inline-flex items-center gap-2 ${className}`}>
        <span className={`shrink-0 ${ring}`} data-pending-ring={reduced ? 'still' : 'spin'} />
      </span>
    )
  }
  return (
    <span role="status" className={`inline-flex items-center gap-2 ${className}`}>
      <span aria-hidden="true" className={`shrink-0 ${ring}`} data-pending-ring={reduced ? 'still' : 'spin'} />
      <span>{label}</span>
    </span>
  )
}
