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

import { offlineStorage } from './offline-storage'
import { recordSpotCount } from '../services/api/inventory'

const MUTATION_TYPE = 'inventory.spotCount'

/** Give up after this many attempts and surface it, rather than retrying forever. */
const MAX_ATTEMPTS = 8

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
  }
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
 */
export async function submitSpotCount(
  entry: QueuedSpotCount,
): Promise<{ synced: boolean }> {
  if (!navigator.onLine) {
    await queue(entry)
    return { synced: false }
  }

  try {
    await recordSpotCount(entry.itemId, entry.body, entry.restaurantId)
    return { synced: true }
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

/** How many spot counts are waiting to sync. Drives the pending badge. */
export async function pendingSpotCountCount(): Promise<number> {
  const all = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  return all.length
}

/**
 * Push everything queued. Safe to call repeatedly and concurrently — the
 * idempotency key makes a double-send a no-op on the server.
 */
export async function flushSpotCountOutbox(): Promise<{
  sent: number
  failed: number
}> {
  if (!navigator.onLine) return { sent: 0, failed: 0 }

  const pending = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
  let sent = 0
  let failed = 0

  for (const m of pending) {
    const entry = m.data as QueuedSpotCount
    try {
      await recordSpotCount(entry.itemId, entry.body, entry.restaurantId)
      await offlineStorage.removePendingMutation(m.id)
      sent++
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      const permanent =
        status && status >= 400 && status < 500 && status !== 408 && status !== 429

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
export function watchSpotCountOutbox(onChange?: () => void): () => void {
  const run = () => {
    void flushSpotCountOutbox().then(() => onChange?.())
  }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run()
  })
  run()
  return () => {
    window.removeEventListener('online', run)
  }
}
