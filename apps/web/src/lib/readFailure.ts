/**
 * Why a read failed, in words an owner can act on — and when to try again.
 *
 * Sim S59, F-403: /orders said "The orders could not be read (Request failed
 * with status code 429)". That is axios's own line, a build-log sentence. And
 * the app-wide query default retried any failure once after a second, so a
 * 429 asked again inside the very window the gateway had just refused, and a
 * 403 or a 404 was asked twice for an answer that cannot change.
 *
 * Duck-typed on `response`, like `getErrorStatus` in `services/api/client.ts`,
 * so a test or a caller-made error reads the same as a live axios one.
 */

interface ReadError {
  code?: unknown
  request?: unknown
  response?: {
    status?: unknown
    headers?: Record<string, unknown> | { get?: (k: string) => unknown }
    data?: { retryAfter?: unknown } | null
  }
}

function statusOf(error: unknown): number | null {
  const s = (error as ReadError | null)?.response?.status
  return typeof s === 'number' ? s : null
}

/**
 * Seconds the gateway asked us to wait, from `Retry-After` (rate-limit.guard.ts
 * sets it) or the body's `retryAfter` (the same guard, readable cross-origin
 * where the header is not exposed). Null when neither says.
 */
export function retryAfterSeconds(error: unknown): number | null {
  const res = (error as ReadError | null)?.response
  if (!res) return null
  const headers = res.headers as Record<string, unknown> | undefined
  const raw =
    (headers && typeof (headers as { get?: unknown }).get === 'function'
      ? (headers as { get: (k: string) => unknown }).get('retry-after')
      : undefined) ??
    headers?.['retry-after'] ??
    headers?.['Retry-After'] ??
    res.data?.retryAfter
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Why the read failed, as a clause: "The orders could not be read (<this>)." */
export function readFailureWords(error: unknown): string {
  const status = statusOf(error)
  if (status === 429) {
    const wait = retryAfterSeconds(error)
    return wait != null && wait > 0
      ? `too many requests in a short time — try again in ${Math.ceil(wait)} seconds`
      : 'too many requests in a short time — try again in a minute'
  }
  if (status === 401) return 'your sign-in has ended — sign in again'
  if (status === 403) return 'this account is not allowed to see them'
  if (status === 404) return 'they were not found'
  if (status != null && status >= 500) return 'the server had a fault on its side'
  if (status != null) return 'the request was refused'
  const e = error as ReadError | null
  if (e?.code === 'ECONNABORTED') return 'the server took too long to answer'
  if (e?.request) return 'the connection dropped before an answer came'
  return 'something went wrong before the request was sent'
}

/**
 * React Query `retry`: once, as before, but never a refusal that cannot change
 * on a second ask (a 4xx). A 429 is the exception — it will pass after the wait.
 */
export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  const status = statusOf(error)
  if (status === 429) return true
  return status == null || status >= 500
}

/** React Query `retryDelay`: a 429 waits what the gateway said, capped at a minute. */
export function readRetryDelay(failureCount: number, error: unknown): number {
  const wait = statusOf(error) === 429 ? retryAfterSeconds(error) : null
  if (wait != null) return Math.min(wait * 1000, 60_000)
  // React Query's own default.
  return Math.min(1000 * 2 ** failureCount, 30_000)
}
