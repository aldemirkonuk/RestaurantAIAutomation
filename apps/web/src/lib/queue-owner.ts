/**
 * Who an offline change belongs to, and how a failed send is judged (ADR 0241,
 * OD-203).
 *
 * The founder, 2026-09-29, verbatim: "make sure that offline changes still
 * queue and always ends up uh, with our database. If the person signs out,
 * however, the data is lose, lost, right? This is the best way since it's
 * basically cache and you signed out basically."
 *
 * Three rules live here so every queue on this device reads them the same way.
 * The owner rule reaches all three queues at once, because every reader goes
 * through `offlineStorage.getPendingMutations`; the SyncManager applies the
 * retry rules to its own types, and `doorOutbox` / `spotCountOutbox` adopt
 * them in OD-203's second PR:
 *
 *   1. OWNER. Every queued change is stamped, when it is queued, with the
 *      person and the house of the session that made it. It is replayed only
 *      under that same person AND that same house. Before this, the queue
 *      replayed whatever it held under whoever was signed in at replay time,
 *      so on a shared tablet one person's change landed in the next person's
 *      house under the next person's name.
 *   2. PERMANENT vs TRANSIENT. Only an answer that says "this request will
 *      never be accepted as it is" (a 4xx other than 401/408/425/429) stops
 *      the retries, and it PARKS the change where the person can see it — it
 *      is never deleted on its own. Everything else (no network, a 5xx, an
 *      expired session) is retried with backoff for as long as it takes.
 *   3. BACKOFF. 30 s, doubling, capped at 15 min, with jitter, so a house that
 *      comes back online after a long outage is not hit by every tablet in the
 *      same second, and a stuck change costs one request per quarter hour.
 */

import { tokenClaims, tokenHouse } from './houseMemory'

export interface QueueOwner {
  /** `public.users.user_id` — the JWT's `sub`. */
  userId: string
  /** The house the session was in; null for a session in no house. */
  restaurantId: string | null
}

/** Why a change is parked instead of retried. */
export interface ParkedState {
  /**
   * refused — the server answered with a permanent refusal (see
   *           `isPermanentRefusal`); the person can retry it or discard it.
   * unowned — queued before changes were stamped with an owner and carrying
   *           nothing that names one, so it can be replayed under nobody; the
   *           person can only discard it.
   */
  reason: 'refused' | 'unowned'
  status?: number
  at: string
}

/** The person and house of the session signed in right now, or null. */
export function currentQueueOwner(): QueueOwner | null {
  let token: string | null = null
  let active: string | null = null
  try {
    token = localStorage.getItem('accessToken')
    active = localStorage.getItem('activeRestaurantId')
  } catch {
    return null
  }
  const userId = tokenClaims(token)?.sub
  if (typeof userId !== 'string' || !userId) return null
  // The API client sends `activeRestaurantId` as `X-Restaurant-Id`, so that is
  // the house a replay would reach; the token's own house is the fallback.
  return { userId, restaurantId: active || tokenHouse(token) || null }
}

/**
 * The two queue types whose payload always named its house. A legacy entry of
 * one of these (queued before owners were stamped) is bound to that house —
 * ADR 0140 already scoped their drop records by house — so a door receipt
 * waiting on a tablet when this ships is not lost.
 */
const LEGACY_HOUSE_BOUND_TYPES = new Set(['receiving.door', 'inventory.spotCount'])

type QueueEntryShape = { type?: string; owner?: QueueOwner | null; data?: unknown }

/**
 * Whether `entry` may be seen by `session`.
 *
 * An entry with an owner: same person and same house, nothing else.
 * A legacy entry with no owner: a door receipt or spot count is bound to the
 * house its payload names; any other legacy entry is visible to every session
 * but only ever as a parked `unowned` change that can be discarded, never
 * replayed (`isReplayable`).
 */
export function isVisibleTo(entry: QueueEntryShape, session: QueueOwner | null): boolean {
  if (!session) return false
  if (entry.owner) {
    return (
      entry.owner.userId === session.userId &&
      (entry.owner.restaurantId ?? null) === (session.restaurantId ?? null)
    )
  }
  const legacyHouse = legacyHouseOf(entry)
  if (legacyHouse) return legacyHouse === session.restaurantId
  return true
}

/** Whether the session may SEND this entry (visible, and owned or house-named). */
export function isReplayable(entry: QueueEntryShape, session: QueueOwner | null): boolean {
  if (!isVisibleTo(entry, session)) return false
  return !!entry.owner || !!legacyHouseOf(entry)
}

function legacyHouseOf(entry: QueueEntryShape): string | null {
  if (entry.owner || !entry.type || !LEGACY_HOUSE_BOUND_TYPES.has(entry.type)) return null
  const rid = (entry.data as { restaurantId?: unknown } | null | undefined)?.restaurantId
  return typeof rid === 'string' && rid ? rid : null
}

/**
 * Whether signing `userId` out removes this entry (OD-203 (c)): their own
 * changes in any house, and legacy changes that name no one at all. A legacy
 * door receipt or spot count is bound to its HOUSE, not to whoever signs out,
 * so it is kept for that house — deleting it would lose a delivery nobody was
 * warned about (the adversarial pass, 2026-09-29).
 */
export function endsWithSessionOf(entry: QueueEntryShape, userId: string): boolean {
  if (entry.owner) return entry.owner.userId === userId
  return !legacyHouseOf(entry)
}

/** The HTTP status an axios-shaped error carries, if any. */
export function statusOf(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * A refusal that sending the same request again will not change.
 *
 * 401 is NOT one: it means the session ended, and the change is replayed after
 * the same person signs in again. 408, 425 and 429 are the server asking to be
 * tried later. No status at all (network down, CORS, a thrown bug) is
 * transient too — it is retried, with backoff, and shown as "still trying"
 * once it has failed often (`STILL_TRYING_AFTER`).
 */
export function isPermanentRefusal(status: number | undefined): boolean {
  if (status === undefined) return false
  if (status < 400 || status >= 500) return false
  return status !== 401 && status !== 408 && status !== 425 && status !== 429
}

export const BACKOFF_BASE_MS = 30_000
export const BACKOFF_CAP_MS = 15 * 60_000
/** After this many failed attempts a change is shown as "still trying". */
export const STILL_TRYING_AFTER = 5

/** When the next attempt may run, after `attempts` failures. */
export function nextAttemptAt(attempts: number, now: number = Date.now()): string {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1))
  const jitter = exp * 0.2 * (Math.random() * 2 - 1)
  return new Date(now + Math.round(exp + jitter)).toISOString()
}

/** Whether an entry's backoff has elapsed. */
export function isDue(entry: { nextAttemptAt?: string }, now: number = Date.now()): boolean {
  if (!entry.nextAttemptAt) return true
  const t = Date.parse(entry.nextAttemptAt)
  return Number.isNaN(t) || t <= now
}

/** The words for the sign-out warning (the founder's ruling (c)). */
export function signOutWarning(unsent: number): string {
  const what = unsent === 1 ? '1 change has' : `${unsent} changes have`
  return (
    `${what} not been sent yet. They are kept only on this device, ` +
    `and signing out removes them. Sign out anyway?`
  )
}
