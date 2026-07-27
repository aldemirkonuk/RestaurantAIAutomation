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
): Promise<{ synced: boolean; alreadyRecorded?: boolean }> {
  if (!navigator.onLine) {
    await queue(entry)
    return { synced: false }
  }

  try {
    const res = await receivingApi.recordDoorReceipt(entry.orderId, entry.body)
    return { synced: true, alreadyRecorded: res.alreadyRecorded }
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

/**
 * Push everything queued. Safe to call repeatedly and concurrently — the
 * idempotency key makes a double-send a no-op on the server.
 */
export async function flushDoorOutbox(): Promise<{
  sent: number
  failed: number
}> {
  if (!navigator.onLine) return { sent: 0, failed: 0 }

  const pending = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  let sent = 0
  let failed = 0

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
        failed++
        continue
      }

      await offlineStorage.updatePendingMutation(m.id, {
        retryCount: m.retryCount + 1,
        lastError: (err as Error)?.message ?? 'sync failed',
      })
      failed++
    }
  }

  return { sent, failed }
}

/**
 * Flush when the network returns and when the tab regains focus.
 * Returns a cleanup function.
 */
export function watchDoorOutbox(onChange?: () => void): () => void {
  const run = () => {
    void flushDoorOutbox().then(() => onChange?.())
  }
  window.addEventListener('online', run)
  // Coming back to the tab is the other moment a receiver is likely to be
  // somewhere with signal — the walk from the loading dock to the office.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run()
  })
  run()
  return () => {
    window.removeEventListener('online', run)
  }
}
