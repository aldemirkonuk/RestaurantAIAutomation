import { useCallback, useEffect, useState } from 'react'

/** The wait the mailer enforces between two resends, when it names none. */
export const RESEND_WAIT_SECONDS = 60

/**
 * Seconds left until a resend is allowed again, counted from an end time so a
 * background tab that throttles its timer still reads true (r105 onboarding
 * g5). `start(seconds)` begins (or replaces) the wait; the number ticks once a
 * second and is 0 when the wait is over.
 */
export function useResendCooldown() {
  const [until, setUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (until === null) return
    if (Date.now() >= until) {
      setUntil(null)
      return
    }
    const timer = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= until) setUntil(null)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [until])

  const start = useCallback((seconds: number) => {
    const t = Date.now()
    setNow(t)
    setUntil(t + Math.max(1, Math.round(seconds)) * 1000)
  }, [])

  const secondsLeft = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000))
  return { secondsLeft, start }
}

/** The server's `Retry-After` in seconds, or null when it names none we can read. */
export function retryAfterSeconds(err: unknown): number | null {
  const headers = (err as { response?: { headers?: Record<string, unknown> } })?.response?.headers
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After']
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}
