import { doRefresh } from './sessionRefresh'

/**
 * One `GET /auth/me` per page load.
 *
 * Two clients start a session when a page loads, and each used to ask the
 * gateway who the person is:
 *
 *  - `stores/authStore.ts`, when its module is first imported;
 *  - `contexts/AuthContext.tsx`, when `AuthProvider` mounts. Under React's
 *    StrictMode in development it mounts twice.
 *
 * Measured on the local stack 2026-11-12:
 *
 *  - A full load asked three times in development and twice in production.
 *  - With an expired access token it asked six times. Each reader got a 401,
 *    refreshed, and asked again.
 *
 * Every path under `/auth/` was limited to 10 a minute per address
 * (`RateLimitGuard`), and every device in a house shares one address. So four
 * full loads in a minute answered 429, and the 429 sent the person to /login.
 *
 * Both boot paths now read through here. A read for the same token that is
 * still in flight, or that answered in the last few seconds, is shared.
 *
 * A read that failed is shared too, for the same few seconds: a 429, a 503 or
 * a dropped connection would only fail again if asked again at once. Each
 * client already keeps the session on those.
 *
 * A 401 means the access token expired. A reader that gets one:
 *
 *  1. waits for the one shared `doRefresh`, or takes the token that refresh
 *     already stored;
 *  2. asks again through here under the new token, so every reader shares
 *     that second read too.
 *
 * A read made by AuthContext has had that refresh already: its axios
 * interceptor refreshes and retries on a 401 before the read fails. Readers
 * of such a read take the token it stored, if any, and never refresh again.
 *
 * Only one such hop is made. If the read under the new token is also a 401,
 * or the refresh gave no token, the reader gets the 401 as before. Its client
 * then decides between keeping the session and signing out, as it always
 * has: whether a refresh token survived the refresh.
 *
 * Only the two boot paths use this. Sign-in, a house switch and every other
 * deliberate re-read still ask the gateway directly.
 */

/** How long an answered read stands in for a new one. */
export const ME_AT_BOOT_REUSE_MS = 5_000

type Entry = {
  token: string
  promise: Promise<unknown>
  /** When it answered. Null while in flight. */
  answeredAt: number | null
  /** The client that asked refreshes on a 401 by itself (AuthContext's interceptor). */
  askRefreshes: boolean
}

export interface MeAtBootOptions {
  /**
   * True when `ask` already refreshes and retries on a 401, as AuthContext's
   * axios interceptor does. A 401 from such a read has had its refresh, so no
   * second one is made for it.
   */
  askRefreshes?: boolean
}

let last: Entry | null = null

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status
}

function shared<T>(
  token: string,
  ask: (token: string) => Promise<T>,
  askRefreshes: boolean,
): Entry {
  const prior = last
  if (
    prior &&
    prior.token === token &&
    (prior.answeredAt === null || Date.now() - prior.answeredAt < ME_AT_BOOT_REUSE_MS)
  ) {
    return prior
  }
  const entry: Entry = { token, promise: ask(token), answeredAt: null, askRefreshes }
  last = entry
  const settle = () => {
    entry.answeredAt = Date.now()
  }
  entry.promise.then(settle, settle)
  return entry
}

/**
 * Ask `/auth/me` for `token` through `ask`, sharing the read with every other
 * boot reader of the same token (see above). `ask` is given the token to send:
 * after a refresh it is the new one.
 */
export async function readMeAtBoot<T>(
  token: string,
  ask: (token: string) => Promise<T>,
  { askRefreshes = false }: MeAtBootOptions = {},
): Promise<T> {
  const entry = shared(token, ask, askRefreshes)
  try {
    return (await entry.promise) as T
  } catch (err) {
    if (statusOf(err) !== 401) throw err
    const stored = localStorage.getItem('accessToken')
    let renewed: string | null = stored && stored !== token ? stored : null
    // A read whose client already refreshed on this 401 has had its refresh.
    if (!renewed && !entry.askRefreshes) renewed = await doRefresh()
    if (!renewed || renewed === token) throw err
    return (await shared(renewed, ask, askRefreshes).promise) as T
  }
}

/** Forget any shared read (tests). */
export function forgetMeAtBoot(): void {
  last = null
}
