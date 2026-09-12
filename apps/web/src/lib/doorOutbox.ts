/**
 * doorOutbox — offline queue for deliveries received at the door.
 *
 * There is no signal in a walk-in and barely any in a stairwell. A receiver who
 * taps "done" and watches a spinner fail has learned that the app costs them
 * time, and they go back to the clipboard — permanently. So the tap always
 * succeeds locally and syncs whenever the network returns.
 *
 * IDEMPOTENCY IS THE WHOLE DESIGN. Every queued receipt carries a key generated
 * at the moment of the tap and reused on every retry, so a request that actually
 * reached the server before the connection dropped cannot book the stock twice.
 * The server treats a duplicate key as "already recorded" rather than an error,
 * which means the client never has to know whether its first attempt landed.
 *
 * Built on the existing offlineStorage pending-mutation queue rather than a new
 * store, so it inherits the IndexedDB-with-localStorage-fallback that already
 * works on the old iPads a receiving desk actually has.
 */

import { offlineStorage } from './offline-storage'
import { receivingApi, type DoorReceiptRequest } from '../services/api/receiving'

const MUTATION_TYPE = 'receiving.door'

/** Give up after this many attempts and surface it, rather than retrying forever. */
const MAX_ATTEMPTS = 8

/**
 * A receipt the outbox GAVE UP ON, kept after the receipt itself is gone.
 *
 * The queue entry is deleted on a drop, so without this the only record of a
 * permanent loss was a counter in one component's state, on one phone, erased
 * by the next navigation. It is written here, from the flush that caused it,
 * so it survives a remount and can still name the order it lost.
 */
export interface DroppedDoorReceipt {
  /**
   * The queue entry's id. The record is keyed on it, so recording the same
   * drop twice — two passes racing, a re-read after a reload — cannot turn one
   * lost receipt into two.
   */
  id: string
  orderLabel: string
  droppedAt: string
  /**
   * Why it was given up on, kept because the REMEDY differs and a notice that
   * names the wrong one wastes the only minutes in which anything can be done:
   *   auth    — 401/403. The app was signed out; the next move is signing in
   *             again, not walking upstairs.
   *   refused — any other 4xx. The server understood and said no.
   *   retries — the attempt budget ran out.
   * None of these recovers the receipt. They only stop the notice sending a
   * porter after the wrong fix.
   */
  reason: 'auth' | 'refused' | 'retries'
}

const DROPS_KEY = 'mudavym.door.drops.v1'

/** Every receipt this phone has lost, oldest first. */
export function readDroppedDoorReceipts(): DroppedDoorReceipt[] {
  try {
    const raw = window.localStorage.getItem(DROPS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DroppedDoorReceipt[]) : []
  } catch {
    return []
  }
}

/**
 * Forget the records. The PORTER acknowledging the notice — nothing in the
 * flush path calls this, and no successful send clears it, because a later
 * delivery does not make an earlier loss untrue. It exists at all because a
 * warning on a shared dock phone that can never be cleared is one nobody reads
 * by the third delivery.
 */
export function clearDroppedDoorReceipts(): void {
  try {
    window.localStorage.removeItem(DROPS_KEY)
  } catch {
    /* storage blocked — there was nothing persisted to clear */
  }
}

/**
 * Not capped. A record is ~90 bytes, and evicting the oldest to make room
 * would be this same defect one layer down: a loss disappearing quietly.
 */
function recordDrop(drop: DroppedDoorReceipt): void {
  try {
    const all = readDroppedDoorReceipts()
    if (all.some((d) => d.id === drop.id)) return
    window.localStorage.setItem(DROPS_KEY, JSON.stringify([...all, drop]))
  } catch {
    /* storage blocked — the flush result still carries the count */
  }
}

export interface QueuedDoorReceipt {
  orderId: string
  orderLabel: string
  body: DoorReceiptRequest
}

/** A key that survives a reload, a retry and a browser restart. */
export function newIdempotencyKey(orderId: string): string {
  const rand =
    (globalThis.crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2)) as string
  return `door:${orderId}:${rand}`
}

/**
 * Record a door receipt, queueing it if the network is unavailable.
 *
 * Returns `synced: false` when it went to the queue — the caller should tell the
 * receiver it is saved, NOT that it failed, because from their side it is done
 * and their next action is walking away from the door.
 */
export async function submitDoorReceipt(
  entry: QueuedDoorReceipt,
): Promise<{
  synced: boolean
  alreadyRecorded?: boolean
  /**
   * Whether the shelf count moved. Passed through — not collapsed into
   * `synced` — because "the delivery is recorded" and "the stock is booked" are
   * two different facts and the gateway used to report the second one whether or
   * not it happened. A caller that only knows `synced` cannot tell them apart.
   */
  stockBooked?: boolean
  stockIssue?: string
}> {
  if (!navigator.onLine) {
    await queue(entry)
    return { synced: false }
  }

  try {
    const res = await receivingApi.recordDoorReceipt(entry.orderId, entry.body)
    return {
      synced: true,
      alreadyRecorded: res.alreadyRecorded,
      stockBooked: res.stockBooked,
      stockIssue: res.stockIssue,
    }
  } catch (err) {
    // A 4xx means the server understood and refused; retrying will not help and
    // queueing it would hide a real problem behind a permanently stuck item.
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429)
      throw err

    await queue(entry)
    return { synced: false }
  }
}

async function queue(entry: QueuedDoorReceipt): Promise<void> {
  await offlineStorage.addPendingMutation({
    type: MUTATION_TYPE,
    data: entry,
    timestamp: new Date(),
  })
}

/** How many door receipts are waiting to sync. Drives the pending badge. */
export async function pendingDoorCount(): Promise<number> {
  const all = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  return all.length
}

export interface DoorFlushResult {
  sent: number
  /** Did not reach the server this pass — retryable ones included. */
  failed: number
  /**
   * How many receipts this pass GAVE UP ON: a 4xx, or the retry budget spent.
   * A subset of `failed`, and the only permanent part of it — the item is
   * deleted from the queue, so the pending badge decrements exactly as it does
   * on a delivery. Reported separately because a caller that sees only `failed`
   * cannot tell a receipt that will be retried from one nobody will ever send,
   * and a screen that cannot tell them apart renders a loss as a success.
   */
  dropped: number
}

/**
 * The pass currently running, handed to every caller that arrives while it is
 * in flight.
 *
 * Three triggers fire a flush — mount, 'online', 'visibilitychange' — and the
 * walk from the dock to the office raises the last two in the same tick.
 * Without this each pass read the whole pending list BEFORE any of them
 * removed anything, so a single lost receipt was attempted once per pass and
 * reported as one drop per pass: one loss, counted twice.
 */
let inFlight: Promise<DoorFlushResult> | null = null

/**
 * Push everything queued. Safe to call repeatedly and concurrently: a caller
 * that arrives mid-pass joins that pass rather than starting a second one over
 * the same items. (The idempotency key already made a double SEND harmless on
 * the server; what it could not make harmless was double COUNTING the loss on
 * the client.) A receipt queued after the running pass read the list waits for
 * the next trigger — the watcher below fires one on every state change that
 * could have produced it.
 */
export function flushDoorOutbox(): Promise<DoorFlushResult> {
  if (inFlight) return inFlight
  const pass = runFlush()
  inFlight = pass.finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runFlush(): Promise<DoorFlushResult> {
  if (!navigator.onLine) return { sent: 0, failed: 0, dropped: 0 }

  const pending = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  let sent = 0
  let failed = 0
  let dropped = 0

  for (const m of pending) {
    const entry = m.data as QueuedDoorReceipt
    try {
      await receivingApi.recordDoorReceipt(entry.orderId, entry.body)
      await offlineStorage.removePendingMutation(m.id)
      sent++
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      const permanent =
        status && status >= 400 && status < 500 && status !== 408 && status !== 429

      // Drop a permanently-rejected item rather than retrying it forever. A
      // queue that never drains stops being watched, and then a real failure
      // hides behind the stuck one.
      if (permanent || m.retryCount + 1 >= MAX_ATTEMPTS) {
        await offlineStorage.removePendingMutation(m.id)
        // Written before the counters and keyed on the queue id: the count
        // alone cannot say WHICH order left, and after this line nothing
        // anywhere else in the app can.
        recordDrop({
          id: m.id,
          orderLabel: entry?.orderLabel || entry?.orderId || 'Door receipt',
          droppedAt: new Date().toISOString(),
          reason: permanent
            ? status === 401 || status === 403
              ? 'auth'
              : 'refused'
            : 'retries',
        })
        failed++
        dropped++
        continue
      }

      await offlineStorage.updatePendingMutation(m.id, {
        retryCount: m.retryCount + 1,
        lastError: (err as Error)?.message ?? 'sync failed',
      })
      failed++
    }
  }

  return { sent, failed, dropped }
}

/**
 * Flush when the network returns and when the tab regains focus.
 * Returns a cleanup function.
 *
 * `onChange` is handed the flush result rather than called empty: a watcher
 * that only says "something changed" leaves the caller to re-read the pending
 * count, which falls by one whether the receipt was delivered or discarded.
 * The difference exists only here, so it is passed on.
 */
export function watchDoorOutbox(
  onChange?: (result: DoorFlushResult) => void,
): () => void {
  /**
   * The pass already reported. Two triggers firing together join ONE pass and
   * would otherwise hand the caller its single result twice — and a caller that
   * accumulates `dropped` would then show two lost receipts where one was lost.
   * Identity is the whole test: a genuinely later pass is a different promise.
   */
  let reported: Promise<DoorFlushResult> | null = null
  const run = () => {
    const pass = flushDoorOutbox()
    if (pass === reported) return
    reported = pass
    void pass.then((result) => onChange?.(result))
  }
  const onOnline = () => run()
  // Coming back to the tab is the other moment a receiver is likely to be
  // somewhere with signal — the walk from the loading dock to the office.
  const onVisible = () => {
    if (document.visibilityState === 'visible') run()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  run()
  // Both listeners, named for that reason: the visibility one used to be an
  // anonymous function the cleanup could not name, so every mount of the door
  // screen left one behind, flushing for a component that no longer exists.
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
