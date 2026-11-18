/**
 * The one read of `GET /auth/me`, shared by every caller in the page.
 *
 * Two things the sign-in path needed and did not have:
 *
 *  1. One call per session bootstrap. The auth store loads its user when the
 *     module is first imported and the auth context loads again when it
 *     mounts; after a password step the context reads again. On the local
 *     gateway that is three or four reads inside a few hundred ms, against a
 *     limit of ten a minute, and the next click came back "Too many
 *     requests". Callers asking for the same session (same token, same house)
 *     while a read is in flight, or within REUSE_MS of one that succeeded,
 *     now share it.
 *  2. A rate limit is not a sign-out. On a 429 the read waits and asks again
 *     (400, 800, 1600 ms), telling the caller it is settling so the page can
 *     say so calmly instead of sending the person to the front door.
 *
 * Only 429 is retried here; a 401 still reaches the caller's own handling.
 */

export const ME_RETRY_DELAYS_MS: readonly number[] = [400, 800, 1600]
/** A successful read is reused by a caller asking for the same session this soon after. */
export const ME_REUSE_MS = 1000

interface Getter {
  get: (url: string) => Promise<any>
}

interface Entry {
  api: Getter
  promise: Promise<any>
  settling: Set<(settling: boolean) => void>
  doneAt: number | null
}

const entries = new Map<string, Entry>()

function sessionKey(): string {
  try {
    return `${localStorage.getItem('accessToken') ?? ''}|${localStorage.getItem('activeRestaurantId') ?? ''}`
  } catch {
    return ''
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const statusOf = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | null)?.response?.status

export interface ReadMeOptions {
  /** Told true when a rate-limited read starts waiting, false when it ends. */
  onSettling?: (settling: boolean) => void
}

export function readMe(api: Getter, options: ReadMeOptions = {}): Promise<any> {
  const key = sessionKey()
  const now = Date.now()
  const held = entries.get(key)
  if (held && (held.doneAt === null || now - held.doneAt < ME_REUSE_MS)) {
    if (options.onSettling) held.settling.add(options.onSettling)
    if (held.api === api) return held.promise
    // Another client's read: share its answer, but a refusal on its side is
    // not ours to inherit (each client has its own way of mending a 401), so
    // the second caller asks again with its own client.
    return held.promise.catch(() => readMe(api, options))
  }

  const entry: Entry = {
    api,
    promise: Promise.resolve(),
    settling: new Set(options.onSettling ? [options.onSettling] : []),
    doneAt: null,
  }
  const tell = (v: boolean) => entry.settling.forEach((fn) => fn(v))

  entry.promise = (async () => {
    let waited = false
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await api.get('/api/v1/auth/me')
        } catch (err) {
          const delay = ME_RETRY_DELAYS_MS[attempt]
          if (statusOf(err) !== 429 || delay === undefined) throw err
          if (!waited) {
            waited = true
            tell(true)
          }
          await sleep(delay)
        }
      }
    } finally {
      if (waited) tell(false)
    }
  })()
  entries.set(key, entry)
  entry.promise.then(
    () => {
      entry.doneAt = Date.now()
    },
    () => {
      // A failed read is never reused: the next caller asks again.
      if (entries.get(key) === entry) entries.delete(key)
    },
  )
  return entry.promise
}

/** For tests: forget every held read. */
export function resetReadMe(): void {
  entries.clear()
}
