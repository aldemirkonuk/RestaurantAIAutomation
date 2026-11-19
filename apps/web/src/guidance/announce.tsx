import { useEffect, useRef, useState } from 'react'

/**
 * Shared polite live region for tip appearance and tour step changes.
 * Screen readers pick this up without moving focus.
 */
let announcerEl: HTMLElement | null = null

let showLine: ((message: string) => void) | null = null

/** How long a said-aloud failure stays on screen. */
export const GUIDANCE_LINE_MS = 6000

/**
 * A failure a sighted person must also see (ADR 0020): the tour could not
 * start. Said to a screen reader as every announcement is, and drawn as a
 * line for a few seconds.
 */
export function announceGuidanceVisibly(message: string) {
  announceGuidance(message)
  showLine?.(message)
}

export function announceGuidance(message: string) {
  if (!announcerEl || !message) return
  // Clear first so identical consecutive messages still announce.
  announcerEl.textContent = ''
  window.requestAnimationFrame(() => {
    if (announcerEl) announcerEl.textContent = message
  })
}

/** Park keyboard focus on a stable guidance entry point after tours end. */
export function focusTourHelpButton() {
  if (typeof document === 'undefined') return
  const selectors = ['[data-guidance="tour-help"]', '[data-guidance="learn-help"]']
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      el.focus()
      return
    }
  }
}

export function GuidanceLiveRegion() {
  const ref = useRef<HTMLDivElement>(null)
  const [line, setLine] = useState<string | null>(null)

  useEffect(() => {
    announcerEl = ref.current
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = (message: string) => {
      setLine(message)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setLine(null), GUIDANCE_LINE_MS)
    }
    showLine = show
    return () => {
      if (timer) clearTimeout(timer)
      if (showLine === show) showLine = null
      if (announcerEl === ref.current) announcerEl = null
    }
  }, [])

  return (
    <>
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      {line ? (
        <p
          data-guidance="tour-line-said"
          aria-hidden="true"
          className="fixed bottom-4 left-1/2 z-[60] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-full border px-4 py-2 text-sm shadow-md"
          style={{ background: 'var(--paper-0, #fff)', color: 'var(--ink-1, #1f2937)', borderColor: 'var(--rule, #e5e7eb)' }}
        >
          {line}
        </p>
      ) : null}
    </>
  )
}
