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
import {
  currentQueueOwner,
  isPermanentRefusal,
  isReplayable,
  isVisibleTo,
  statusOf,
} from './queue-owner'

const MUTATION_TYPE = 'inventory.spotCount'

// No attempt ceiling (ADR 0241, OD-203 (a)). This queue used to delete a
// count after 8 failed attempts, and on any permanent refusal, with nothing
// said to anyone. A count now leaves the queue only when the server takes it,
// or when the person discards it from the "not sent" strip; a permanent
// refusal parks it there, and a transient failure is tried again on the next
// flush (triggered by 'online' and 'visibilitychange', never a timer).

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
  const pending = await offlineStorage.getPendingMutationsByType(MUTATION_TYPE)
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
    const entry = m.data as QueuedSpotCount
    try {
      await recordSpotCount(entry.itemId, entry.body, entry.restaurantId)
      await offlineStorage.removePendingMutation(m.id)
      sent++
    } catch (err) {
      const status = statusOf(err)
      const lastError = (err as Error)?.message ?? 'sync failed'
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

  return { sent, failed, parked }
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
