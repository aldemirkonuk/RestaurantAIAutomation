/**
 * spotCountOutbox — offline queue for floor spot counts.
 *
 * Same shape as doorOutbox.ts (decision E43's "keep it super simple" extends
 * to reusing the pattern rather than inventing a second one): a staff member
 * walking the cellar with a phone has no more signal than a receiver at the
 * loading dock, so the tap always succeeds locally and syncs when the
 * network returns.
 *
 * IDEMPOTENCY IS THE WHOLE DESIGN, same as the door queue: the key is
 * generated once at the moment of the tap (count:{inventoryId}:{clientCountId})
 * and reused on every retry, so a request that actually landed before the
 * connection dropped cannot double-apply the count.
 */

import { offlineStorage, type PendingMutation } from './offline-storage'
import { recordSpotCount, type SpotCountRecord } from '../services/api/inventory'
import {
  markCountShelfDone,
  parkCountLine,
  type ShelfDoneResult,
} from '../services/api/countSessions'
import {
  currentQueueOwner,
  isPermanentRefusal,
  isReplayable,
  isVisibleTo,
  statusOf,
} from './queue-owner'

const MUTATION_TYPE = 'inventory.spotCount'

/**
 * Fired on `window` when this queue parks a count or clears one, so the
 * app-wide sync manager re-reads its counts (it imports this module, so it
 * cannot be called from here).
 */
export const SPOT_COUNTS_CHANGED_EVENT = 'mdv:spot-counts-changed'

/** The house's answer to a count something else overtook (F-249). */
const OVERTAKEN = 409

// No attempt ceiling (ADR 0241, OD-203 (a)). This queue used to delete a
// count after 8 failed attempts, and on any permanent refusal, with nothing
// said to anyone. A count now leaves the queue only when the server takes it,
// or when the person discards it from the "not sent" strip; a permanent
// refusal parks it there, and a transient failure is tried again on the next
// flush (triggered by 'online', 'visibilitychange' and the app-wide sync
// manager's start-up and periodic passes — F-246).

export interface QueuedSpotCount {
  itemId: string
  itemLabel: string
  restaurantId?: string
  body: {
    countedQty: number
    stockState?: 'live' | 'shadow'
    clientCountId: string
    reason?: string
    performedBy?: string | null
    /** F-291: the shelf counted; absent = every shelf at once. */
    locationId?: string
    /**
     * F-1544: the stock-take this line belongs to. Sent only when set, so a
     * spot count's body is exactly what it was.
     */
    sessionId?: string
    /** F-1544 (F3 a): what is left in the open bottles, in tenths of a bottle. */
    openTenths?: number
    /** A line of an opening stock-take (ADR 0335 §2). */
    opening?: boolean
  }
  /**
   * When the count was taken (this phone's clock), stamped at the tap. A
   * replay sends its AGE, not this time, so a phone clock that is off cannot
   * move the count: the house then refuses a count older than the stock's
   * last movement instead of pulling the shelf back to it (F-249).
   */
  countedAt?: string
}

/** A key that survives a reload, a retry and a browser restart. */
export function newClientCountId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  )
}

/**
 * Record a spot count, queueing it if the network is unavailable.
 *
 * Returns `synced: false` when it went to the queue — the caller should tell
 * the counter it is saved, not that it failed, since from their side the tap
 * is done and their next action is moving to the next shelf.
 *
 * When it synced, `count` is what the server recorded — the books' figure,
 * the counted figure and the difference (F-645: this used to be dropped, so
 * nobody counting ever saw how far off the books were).
 */
export async function submitSpotCount(
  entry: QueuedSpotCount,
): Promise<{ synced: boolean; count?: SpotCountRecord | null }> {
  entry = { ...entry, countedAt: entry.countedAt ?? new Date().toISOString() }
  if (!navigator.onLine) {
    await queue(entry)
    return { synced: false }
  }

  try {
    const res = await recordSpotCount(entry.itemId, entry.body, entry.restaurantId)
    await clearOvertakenBy(entry)
    return { synced: true, count: res?.count ?? null }
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429)
      throw err

    await queue(entry)
    return { synced: false }
  }
}

async function queue(entry: QueuedSpotCount): Promise<void> {
  await offlineStorage.addPendingMutation({
    type: MUTATION_TYPE,
    data: entry,
    timestamp: new Date(),
  })
}

// ── F-1544: a stock-take's two other acts ride the same queue ─────────────
//
// "Shelf done" and an item parked for review are made at the shelf, where
// the signal is, like a count. They queue the same way (stamped with their
// person and house, ADR 0241), replay with the same key (`clientDoneId`,
// `clientLineId`), and say how old they are when they are finally sent, so a
// stale "done" is refused like a stale count (F-249) instead of zeroing a
// shelf that has been restocked since.

export const SHELF_DONE_TYPE = 'inventory.countShelfDone'
export const PARK_TYPE = 'inventory.countPark'

const SHELF_RECOUNT = 'Count this shelf again: some bottles moved after it was counted.'

export interface QueuedShelfDone {
  restaurantId?: string
  sessionId: string
  locationId: string
  /** The shelf's name, for the not-sent strip. */
  shelfLabel: string
  body: { clientDoneId: string; zeroItemIds: string[] }
  countedAt?: string
  /**
   * F-1619: the house's answer when it could not close the shelf -- which
   * items to count again and which zeros did post -- kept so the walk can
   * show them once the phone reads its queue.
   */
  answer?: Pick<ShelfDoneResult, 'posted' | 'held' | 'refused' | 'message'>
}

export interface QueuedParkedLine {
  restaurantId?: string
  sessionId: string
  body: { clientLineId: string; locationId: string; description: string; countedQty: number; openTenths?: number }
  countedAt?: string
}

/** A 4xx other than a timeout or a throttle: the house's answer, not the network's. */
function isRefusal(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return !!status && status >= 400 && status < 500 && status !== 408 && status !== 429
}

/**
 * Say a shelf is done. Online, the answer comes back (`done: false` names
 * the items that moved, to count again); offline it is queued and the screen
 * says it is saved on this phone.
 */
export async function submitShelfDone(
  entry: QueuedShelfDone,
): Promise<{ synced: boolean; result?: ShelfDoneResult }> {
  entry = { ...entry, countedAt: entry.countedAt ?? new Date().toISOString() }
  if (navigator.onLine) {
    try {
      const result = await markCountShelfDone(entry.sessionId, entry.locationId, entry.body)
      if (result?.done) await clearRecountsBy(entry)
      return { synced: true, result }
    } catch (err) {
      if (isRefusal(err)) throw err
    }
  }
  await offlineStorage.addPendingMutation({
    type: SHELF_DONE_TYPE,
    data: entry,
    timestamp: new Date(),
  })
  return { synced: false }
}

/** Park an item the house does not carry, for the manager's review. */
export async function submitParkedLine(entry: QueuedParkedLine): Promise<{ synced: boolean }> {
  entry = { ...entry, countedAt: entry.countedAt ?? new Date().toISOString() }
  if (navigator.onLine) {
    try {
      await parkCountLine(entry.sessionId, entry.body)
      return { synced: true }
    } catch (err) {
      if (isRefusal(err)) throw err
    }
  }
  await offlineStorage.addPendingMutation({
    type: PARK_TYPE,
    data: entry,
    timestamp: new Date(),
  })
  return { synced: false }
}

/** How many spot counts are waiting to sync. Drives the pending badge. */
export async function pendingSpotCountCount(): Promise<number> {
  const all = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  return all.length
}

/**
 * Push everything queued that belongs to this session. Safe to call
 * repeatedly and concurrently — the idempotency key makes a double-send a
 * no-op on the server.
 *
 * `parked` counts the counts the server refused for good this pass: they stay
 * in the queue as "not sent" (the app-wide strip shows them), never deleted.
 */
export async function flushSpotCountOutbox(): Promise<{
  sent: number
  failed: number
  parked: number
}> {
  if (!navigator.onLine) return { sent: 0, failed: 0, parked: 0 }

  // Only this session's person and house (`getPendingMutations` filters).
  // Counts first, then a stock-take's "shelf done" and parked items (F-1544):
  // a done's zeros are for the items NOT counted, so it never depends on a
  // count queued before it, but sending the counts first keeps the shelf's
  // books in the order the person walked it.
  const pending = [
    ...(await pendingOf(MUTATION_TYPE)),
    ...(await pendingOf(SHELF_DONE_TYPE)),
    ...(await pendingOf(PARK_TYPE)),
  ]
  const now = Date.now()
  let sent = 0
  let failed = 0
  let parked = 0

  for (const m of pending) {
    // Re-read for every count (ADR 0241): a house switch in the middle of this
    // flush leaves the rest queued for their own house.
    const session = currentQueueOwner()
    if (m.parked) continue
    if (!isVisibleTo(m, session)) continue
    if (!isReplayable(m, session)) {
      // A write that fails here leaves the entry as it was (still queued,
      // still unsent); it must not end the flush for the counts after it.
      await markQuietly(m.id, {
        parked: { reason: 'unowned', at: new Date(now).toISOString() },
      })
      parked++
      continue
    }
    try {
      if (m.type === SHELF_DONE_TYPE) {
        const done = m.data as QueuedShelfDone
        const answer = await markCountShelfDone(done.sessionId, done.locationId, {
          ...done.body,
          ...ageOf(done.countedAt),
        })
        if (!answer?.done) {
          // The house took the act but could not close the shelf: bottles of
          // an item marked "not found" moved after the done (F-249). Sending
          // it again gets the same answer, so it waits for the person, who
          // counts those items and says "done" again (F-1544).
          await markQuietly(m.id, {
            lastError: answer?.message ?? SHELF_RECOUNT,
            parked: { reason: 'refused', status: OVERTAKEN, at: new Date(now).toISOString() },
            data: {
              ...done,
              answer: {
                posted: answer?.posted ?? [],
                held: answer?.held ?? [],
                refused: answer?.refused ?? [],
                message: answer?.message,
              },
            } satisfies QueuedShelfDone,
          })
          parked++
          continue
        }
        await offlineStorage.removePendingMutation(m.id)
        await clearRecountsBy(done)
        sent++
        continue
      }
      if (m.type === PARK_TYPE) {
        const line = m.data as QueuedParkedLine
        await parkCountLine(line.sessionId, { ...line.body, ...ageOf(line.countedAt) })
        await offlineStorage.removePendingMutation(m.id)
        sent++
        continue
      }
      const entry = m.data as QueuedSpotCount
      await recordSpotCount(entry.itemId, replayBody(entry), entry.restaurantId)
      await offlineStorage.removePendingMutation(m.id)
      await clearOvertakenBy(entry)
      sent++
    } catch (err) {
      const status = statusOf(err)
      // The house's own sentence, not axios's "Request failed with status
      // code 409": a parked count is shown with it (F-831).
      const lastError = refusalMessage(err)
      if (isPermanentRefusal(status)) {
        await markQuietly(m.id, {
          lastError,
          parked: { reason: 'refused', status, at: new Date(now).toISOString() },
        })
        parked++
        continue
      }

      await markQuietly(m.id, {
        retryCount: m.retryCount + 1,
        lastError,
      })
      failed++
    }
  }

  if (parked > 0) announce()
  return { sent, failed, parked }
}

/** This session's queued entries of one type (a read that answers nothing is none). */
async function pendingOf(type: string): Promise<PendingMutation[]> {
  const all = (await offlineStorage.getPendingMutationsByType(type)) ?? []
  return all.filter((m) => m.type === type)
}

/** A queued act's age at send time (F-249); nothing for one with no stamp. */
function ageOf(countedAt: string | undefined): { countedAgoMs?: number } {
  const at = countedAt ? Date.parse(countedAt) : NaN
  return Number.isFinite(at) ? { countedAgoMs: Math.max(0, Date.now() - at) } : {}
}

/** The house's refusal in its own words, else the error's own message. */
function refusalMessage(err: unknown): string {
  const said = (err as { response?: { data?: { message?: unknown } } } | null)
    ?.response?.data?.message
  if (typeof said === 'string' && said.trim()) return said
  return (err as Error)?.message ?? 'sync failed'
}

/**
 * A count the house refused because the item was counted again, or bottles
 * moved, after it was taken (F-249). Sending it again cannot change that
 * answer, so it is never retried: the person counts the item again or
 * discards it (F-831).
 */
export function isOvertakenCount(m: PendingMutation): boolean {
  return (
    m.type === MUTATION_TYPE &&
    m.parked?.reason === 'refused' &&
    m.parked.status === OVERTAKEN
  )
}

/**
 * A "shelf done" the house refused or could not close (F-1544). Sending it
 * again gets the same answer, so it is never retried: the person counts the
 * shelf again and says "done" again, and that newer done answers it.
 */
export function isShelfToRecount(m: PendingMutation): boolean {
  return (
    m.type === SHELF_DONE_TYPE &&
    m.parked?.reason === 'refused' &&
    m.parked.status === OVERTAKEN
  )
}

/**
 * A done of a shelf went through: every done of that same shelf, in that same
 * count and house, parked as "count again" is answered now and leaves the
 * not-sent strip. A failed read or delete leaves it parked.
 */
async function clearRecountsBy(sent: QueuedShelfDone): Promise<void> {
  try {
    const all = (await offlineStorage.getPendingMutationsByType(SHELF_DONE_TYPE)) ?? []
    let cleared = 0
    for (const m of all) {
      if (!isShelfToRecount(m)) continue
      const e = m.data as QueuedShelfDone
      if (e.sessionId !== sent.sessionId || e.locationId !== sent.locationId) continue
      if ((e.restaurantId ?? null) !== (sent.restaurantId ?? null)) continue
      if (e.body?.clientDoneId === sent.body.clientDoneId) continue
      await offlineStorage.removePendingMutation(m.id)
      cleared++
    }
    if (cleared > 0) announce()
  } catch {
    /* left parked; the person can still discard it */
  }
}

/** A refused count, as the not-sent strip names it: by item, in words. */
export interface ParkedSpotCount {
  id: string
  itemId: string
  itemLabel: string
  /** Refused as overtaken: offer "Count again", never "Try again". */
  overtaken: boolean
  message: string
}

/** This session's refused counts, from its queue entries (F-831). */
export function parkedSpotCountsOf(mutations: PendingMutation[]): ParkedSpotCount[] {
  return mutations
    .filter((m) => m.type === MUTATION_TYPE && m.parked?.reason === 'refused')
    .map((m) => {
      const entry = m.data as QueuedSpotCount
      const overtaken = isOvertakenCount(m)
      // Counts parked before F-831 kept axios's words; never show those.
      const said =
        m.lastError && !/^Request failed with status code/.test(m.lastError)
          ? m.lastError
          : null
      return {
        id: m.id,
        itemId: entry.itemId,
        itemLabel: entry.itemLabel || 'An item',
        overtaken,
        message:
          said ??
          (overtaken
            ? 'Bottles moved or it was counted again after this count was taken, so it was not applied. Count it again.'
            : 'The house did not accept this count.'),
      }
    })
}

/**
 * A count of an item went through: any count of it the house refused as
 * overtaken, and taken no later than this one, is answered now, so it leaves
 * the not-sent strip (F-831). A failed read or delete leaves it parked.
 * A count of one shelf answers only a count of that same shelf; a count of
 * every shelf answers any of them (F-291). A bar count says nothing about the
 * cellar, so it must not clear the cellar's "count it again".
 */
async function clearOvertakenBy(sent: QueuedSpotCount): Promise<void> {
  try {
    const sentAt = sent.countedAt ? Date.parse(sent.countedAt) : NaN
    const all = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
    let cleared = 0
    for (const m of all) {
      if (!isOvertakenCount(m)) continue
      const e = m.data as QueuedSpotCount
      if (e.itemId !== sent.itemId) continue
      if ((e.restaurantId ?? null) !== (sent.restaurantId ?? null)) continue
      if (sent.body.locationId && e.body?.locationId !== sent.body.locationId) continue
      const at = e.countedAt ? Date.parse(e.countedAt) : NaN
      if (Number.isFinite(at) && Number.isFinite(sentAt) && at > sentAt) continue
      await offlineStorage.removePendingMutation(m.id)
      cleared++
    }
    if (cleared > 0) announce()
  } catch {
    /* left parked; the person can still discard it */
  }
}

function announce(): void {
  try {
    window.dispatchEvent(new Event(SPOT_COUNTS_CHANGED_EVENT))
  } catch {
    /* no window (tests, workers): nobody to tell */
  }
}

/**
 * The body a queued count is sent with: the count, plus how long ago it was
 * taken. Without the age the house applied an hours-old count against the
 * stock as it is NOW, undoing every sale and delivery since (F-249). A count
 * queued before this field existed is sent as it always was.
 */
function replayBody(entry: QueuedSpotCount): QueuedSpotCount['body'] & {
  countedAgoMs?: number
} {
  const at = entry.countedAt ? Date.parse(entry.countedAt) : NaN
  if (!Number.isFinite(at)) return entry.body
  return { ...entry.body, countedAgoMs: Math.max(0, Date.now() - at) }
}

/**
 * Update a queue entry, and never let a failed write end the flush. The entry
 * stays as it was — still in the queue, still unsent — and the next flush sees
 * it again, so a failed mark costs one retry, never a count.
 */
async function markQuietly(
  id: string,
  patch: Parameters<typeof offlineStorage.updatePendingMutation>[1],
): Promise<void> {
  try {
    await offlineStorage.updatePendingMutation(id, patch)
  } catch {
    /* kept as it was; retried next flush */
  }
}

/**
 * Flush when the network returns and when the tab regains focus.
 * Returns a cleanup function.
 *
 * Fixed 2026-09-19 (wave5/live-confirm.md B2, pre-existing on main): two
 * defects combined with an unmemoized caller-side `refetch` into a refetch
 * loop on `/inventory`.
 *   1. `onChange` used to fire after every flush attempt, even one that sent
 *      nothing (an empty queue, or every item failing) -- refetching the
 *      caller's data for a no-op flush. Now it only fires when something was
 *      actually sent.
 *   2. The `visibilitychange` listener was an inline arrow, so the returned
 *      cleanup (which only ever removed `online`) could never remove it --
 *      every call (e.g. an effect re-running because its own deps were
 *      unstable) leaked one more. Both listeners are now named and both are
 *      removed.
 */
export function watchSpotCountOutbox(onChange?: () => void): () => void {
  const run = () => {
    void flushSpotCountOutbox().then(({ sent }) => {
      if (sent > 0) onChange?.()
    })
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') run()
  }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  run()
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
