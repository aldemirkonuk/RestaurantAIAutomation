/**
 * The words a sign-up or an invite join shows when the gateway refuses it
 * (OB-11, the session's call under the 2026-11-07 /goal). A refusal is said
 * as what happened and what to do, never as the gateway's own text: a 429
 * used to show "ThrottlerException: Too Many Requests".
 */

export type SignUpRefusalKind = 'wait' | 'exists' | 'refused' | 'offline' | 'failed'

export interface SignUpRefusal {
  kind: SignUpRefusalKind
  text: string
  /** For 'wait': how long, when the gateway said. */
  seconds?: number
}

interface ErrorLike {
  status?: number | null
  retryAfter?: unknown
  message?: unknown
  response?: { status?: number; headers?: Record<string, unknown>; data?: { message?: unknown } }
}

/** Retry-After as whole seconds, from a number of seconds or an HTTP date. */
export function retryAfterSeconds(header: unknown, now: number = Date.now()): number | null {
  if (typeof header === 'number' && Number.isFinite(header) && header >= 0) return Math.ceil(header)
  if (typeof header !== 'string' || header.trim() === '') return null
  const n = Number(header.trim())
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n)
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

function statusOf(e: ErrorLike): number | null {
  if (typeof e.status === 'number') return e.status
  return typeof e.response?.status === 'number' ? e.response.status : null
}

function serverSentence(e: ErrorLike): string | null {
  const m = e.response?.data?.message ?? e.message
  if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(' ') || null
  return typeof m === 'string' && m.trim() !== '' ? m : null
}

export function signUpRefusal(
  err: unknown,
  where: 'account' | 'join',
  now: number = Date.now(),
): SignUpRefusal {
  const e = (err ?? {}) as ErrorLike
  const status = statusOf(e)
  if (status === 429) {
    const seconds = retryAfterSeconds(
      e.retryAfter ?? e.response?.headers?.['retry-after'],
      now,
    )
    if (seconds !== null && seconds > 1) {
      return {
        kind: 'wait',
        seconds,
        text: `Too many tries from this connection. Wait ${seconds} seconds, then try again.`,
      }
    }
    return {
      kind: 'wait',
      seconds: seconds ?? undefined,
      text: 'Too many tries from this connection. Wait a minute, then try again.',
    }
  }
  const said = serverSentence(e)
  // registerAccount answers an address already in use with a 400 "Email
  // already registered" (auth.service.ts registerAccount); the join answers a
  // person already in the house with a 409 "already_member".
  if (where === 'join' && status === 409) {
    return { kind: 'exists', text: 'You are already in this house.' }
  }
  if (
    status === 409 ||
    (status === 400 && said !== null && /already (registered|uses this email|has an account)/i.test(said))
  ) {
    return { kind: 'exists', text: 'This email already has an account.' }
  }
  if (status === 400 || status === 403 || status === 404 || status === 410) {
    return {
      kind: 'refused',
      text:
        said ??
        (where === 'join'
          ? 'The invite was not accepted. Check the fields and try again.'
          : 'The account was not made. Check the fields and try again.'),
    }
  }
  if (status === null) {
    return {
      kind: 'offline',
      text: 'Mudavym could not be reached. Check the connection and try again.',
    }
  }
  return {
    kind: 'failed',
    text:
      where === 'join'
        ? 'The invite was not accepted just now. Try again in a moment.'
        : 'The account was not made just now. Try again in a moment.',
  }
}
