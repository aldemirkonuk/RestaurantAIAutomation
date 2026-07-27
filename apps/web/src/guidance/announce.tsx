import { useEffect, useRef } from 'react'

/**
 * Shared polite live region for tip appearance and tour step changes.
 * Screen readers pick this up without moving focus.
 */
let announcerEl: HTMLElement | null = null

export function announceGuidance(message: string) {
  if (!announcerEl || !message) return
  // Clear first so identical consecutive messages still announce.
  announcerEl.textContent = ''
  window.requestAnimationFrame(() => {
    if (announcerEl) announcerEl.textContent = message
  })
}

export function focusTourHelpButton() {
  if (typeof document === 'undefined') return
  const candidates = document.querySelectorAll<HTMLElement>(
    '[data-guidance="tour-help"]',
  )
  for (const el of candidates) {
    // Skip display:none (mobile vs desktop chrome).
    if (el.offsetParent === null && el.getClientRects().length === 0) continue
    el.focus()
    return
  }
}

export function GuidanceLiveRegion() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    announcerEl = ref.current
    return () => {
      if (announcerEl === ref.current) announcerEl = null
    }
  }, [])

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  )
}
