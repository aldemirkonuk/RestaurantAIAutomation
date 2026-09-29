/**
 * Sync Manager Service
 * ====================
 * Manages synchronization between local offline storage and remote API.
 * Handles online/offline detection, mutation queue processing, and retry logic.
 */

import { offlineStorage, PendingMutation } from './offline-storage'
import {
  currentQueueOwner,
  isDue,
  isVisibleTo,
  isPermanentRefusal,
  isReplayable,
  nextAttemptAt,
  statusOf,
  STILL_TRYING_AFTER,
} from './queue-owner'
import { apiClient } from '../services/api/client'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../services/api/calendar'
import { createProvider, updateProvider } from '../services/api/providers'

// =============================================================================
// TYPES
// =============================================================================

export interface SyncStatus {
  isOnline: boolean
  isSyncing: boolean
  /** This session's changes still waiting to be sent (parked ones excluded). */
  pendingCount: number
  /**
   * This session's changes that will NOT be sent on their own: refused by the
   * server, or queued before owners were stamped (ADR 0241, OD-203 (a)). They
   * stay until the person retries or discards them.
   */
  notSentCount: number
  /** Waiting changes that have failed `STILL_TRYING_AFTER` times or more. */
  stillTryingCount: number
  lastSyncTime: Date | null
  lastError: string | null
}

export interface SyncResult {
  success: boolean
  synced: number
  /** Failed this pass and will be retried. */
  failed: number
  /** Refused permanently this pass and parked (shown, never deleted). */
  parked?: number
  errors: Array<{ mutationId: string; error: string }>
}

export interface MutationDescriptor {
  type: string
  data: unknown
  tempId?: string
}

type SyncStatusListener = (status: SyncStatus) => void

// =============================================================================
// MUTATION HANDLERS
// =============================================================================

/**
 * Registry of mutation handlers that know how to sync each mutation type
 */
const mutationHandlers: Record<
  string,
  (mutation: PendingMutation) => Promise<unknown>
> = {
  // Calendar mutations
  'calendar.create': async (mutation) => {
    const data = (mutation.data ?? {}) as Record<string, unknown>
    return createCalendarEvent(data as any)
  },
  'calendar.update': async (mutation) => {
    const data = mutation.data as { id: string; [key: string]: unknown }
    return updateCalendarEvent(data as any)
  },
  'calendar.delete': async (mutation) => {
    const data = mutation.data as { id: string }
    await deleteCalendarEvent(data.id)
    return { deleted: true }
  },

  // Provider mutations
  'provider.create': async (mutation) => {
    // The key the first attempt was sent with travels in the queued data, so
    // a replay of a create the server committed (reply lost) returns that
    // vendor instead of making a second one. Entries queued before the key
    // existed have none and replay as before.
    const { idempotencyKey, ...data } = (mutation.data ?? {}) as Record<string, unknown>
    return createProvider(data as any, {
      idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
    })
  },
  'provider.update': async (mutation) => {
    const data = mutation.data as { id: string; [key: string]: unknown }
    return updateProvider(data as any)
  },
  'provider.delete': async (mutation) => {
    const data = mutation.data as { id: string }
    await apiClient.delete(`/providers/${data.id}`)
    return { deleted: true }
  },

  // Notification mutations
  'notification.markRead': async (mutation) => {
    const data = mutation.data as { id: string }
    const response = await apiClient.patch(`/notifications/${data.id}/read`)
    return response.data
  },
  'notification.archive': async (mutation) => {
    const data = mutation.data as { id: string }
    const response = await apiClient.patch(`/notifications/${data.id}/archive`)
    return response.data
  },
}

// =============================================================================
// SYNC MANAGER CLASS
// =============================================================================

class SyncManagerService {
  private _isOnline: boolean = navigator.onLine
  private _isSyncing: boolean = false
  private _lastSyncTime: Date | null = null
  private _lastError: string | null = null
  private _pendingCount: number = 0
  private _notSentCount: number = 0
  private _stillTryingCount: number = 0
  
  private listeners: Set<SyncStatusListener> = new Set()
  private syncIntervalId: ReturnType<typeof setInterval> | null = null
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null
  
  // There is no retry cap (ADR 0241, OD-203 (a)): a change is retried with
  // backoff (`nextAttemptAt`) until the server accepts it or refuses it for
  // good, and a permanent refusal parks it where the person can see it. The
  // old cap of 3 deleted the change with only a console line.
  private readonly SYNC_INTERVAL = 30000 // 30 seconds

  constructor() {
    // Fire-and-forget, so it must not reject unhandled: a queue that cannot
    // be read at start-up (IndexedDB blocked, a test's partial storage mock)
    // is reported and retried by the periodic pass, never thrown at the app.
    // Since ADR 0241 AuthContext imports this module, so every screen and
    // test that mounts auth constructs it.
    this.initialize().catch((error) => {
      console.error('[SyncManager] Could not start:', error)
    })
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private async initialize(): Promise<void> {
    // Set up online/offline listeners
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
    
    // Start periodic sync check first: it re-reads the queue itself, so a
    // start-up read that fails below is retried rather than ending the loop.
    this.startPeriodicSync()

    // Initial pending count
    await this.updatePendingCount()
    
    // If online, attempt initial sync
    if (this._isOnline) {
      setTimeout(() => this.syncNow(), 2000)
    }
    
    console.log('[SyncManager] Initialized', { isOnline: this._isOnline })
  }

  // ===========================================================================
  // STATUS
  // ===========================================================================

  get isOnline(): boolean {
    return this._isOnline
  }

  get isSyncing(): boolean {
    return this._isSyncing
  }

  get pendingCount(): number {
    return this._pendingCount
  }

  get lastSyncTime(): Date | null {
    return this._lastSyncTime
  }

  get lastError(): string | null {
    return this._lastError
  }

  getStatus(): SyncStatus {
    return {
      isOnline: this._isOnline,
      isSyncing: this._isSyncing,
      pendingCount: this._pendingCount,
      notSentCount: this._notSentCount,
      stillTryingCount: this._stillTryingCount,
      lastSyncTime: this._lastSyncTime,
      lastError: this._lastError,
    }
  }

  // ===========================================================================
  // MUTATION QUEUEING
  // ===========================================================================

  /**
   * Queue a mutation for later sync
   */
  async queueMutation(mutation: MutationDescriptor): Promise<string> {
    const id = await offlineStorage.addPendingMutation({
      type: mutation.type,
      data: mutation.data,
      tempId: mutation.tempId,
      timestamp: new Date(),
    })
    
    await this.updatePendingCount()
    this.notifyListeners()
    
    // If online, try to sync immediately
    if (this._isOnline && !this._isSyncing) {
      setTimeout(() => this.syncNow(), 100)
    }
    
    return id
  }

  // ===========================================================================
  // SYNC OPERATIONS
  // ===========================================================================

  /**
   * Send what is due now. `ignoreBackoff` sends every waiting change at once —
   * used when the network comes back and when the person taps "Try again".
   */
  async syncNow(options: { ignoreBackoff?: boolean } = {}): Promise<SyncResult> {
    // One flush at a time across every tab of this browser (ADR 0241): two
    // tabs walking the same queue would send the same change twice, and with
    // no retry cap a doubled create is likelier than it was. A tab that finds
    // the lock held skips this pass — the holder is sending.
    const locks = (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined)
    if (locks?.request) {
      return locks.request('mudavym.offline-queue', { ifAvailable: true }, (lock) =>
        lock
          ? this.runSync(options)
          : Promise.resolve({ success: true, synced: 0, failed: 0, errors: [] }),
      )
    }
    return this.runSync(options)
  }

  private async runSync(options: { ignoreBackoff?: boolean }): Promise<SyncResult> {
    if (this._isSyncing) {
      console.log('[SyncManager] Already syncing, skipping')
      return { success: true, synced: 0, failed: 0, errors: [] }
    }

    if (!this._isOnline) {
      console.log('[SyncManager] Offline, cannot sync')
      return { success: false, synced: 0, failed: 0, errors: [{ mutationId: '', error: 'Offline' }] }
    }

    this._isSyncing = true
    this._lastError = null
    this.notifyListeners()

    const result: SyncResult = {
      success: true,
      synced: 0,
      failed: 0,
      errors: [],
    }

    try {
      const mutations = await offlineStorage.getPendingMutations()
      const now = Date.now()
      console.log(`[SyncManager] Processing ${mutations.length} pending mutations`)

      for (const mutation of mutations) {
        // Mutations whose type has no handler here belong to another owner
        // (doorOutbox's 'receiving.door', spotCountOutbox's
        // 'inventory.spotCount' — both flush the shared queue themselves,
        // with their own idempotency keys and attempt budgets). Leave them
        // untouched: processing them throws, and three throws used to
        // DELETE a door receipt that was never sent.
        if (!(mutation.type in mutationHandlers)) {
          continue
        }

        // Parked: waits for the person, never for a timer.
        if (mutation.parked) continue

        // Re-read the session for EVERY entry: the API client stamps the house
        // header from storage at send time, so a house switch (in this tab or
        // another) part-way through a pass must stop the rest of the pass from
        // reaching the new house. An entry no longer this session's waits.
        const session = currentQueueOwner()
        if (!isVisibleTo(mutation, session)) continue

        // Queued before owners were stamped, naming no house: it cannot be
        // sent as anyone (sending it as whoever is signed in is OD-203's
        // defect), so it is parked for the person to discard — not deleted.
        if (!isReplayable(mutation, session)) {
          await offlineStorage.updatePendingMutation(mutation.id, {
            parked: { reason: 'unowned', at: new Date(now).toISOString() },
          })
          continue
        }

        if (!options.ignoreBackoff && !isDue(mutation, now)) continue

        try {
          await this.processMutation(mutation)
          await offlineStorage.removePendingMutation(mutation.id)
          result.synced++
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          const status = statusOf(error)
          result.errors.push({ mutationId: mutation.id, error: errorMessage })
          if (isPermanentRefusal(status)) {
            // The server will not take it as it is. Kept and shown as
            // "not sent" — the person retries or discards it.
            result.parked = (result.parked ?? 0) + 1
            await offlineStorage.updatePendingMutation(mutation.id, {
              lastError: errorMessage,
              parked: { reason: 'refused', status, at: new Date(now).toISOString() },
            })
          } else {
            result.failed++
            const attempts = mutation.retryCount + 1
            await offlineStorage.updatePendingMutation(mutation.id, {
              retryCount: attempts,
              lastError: errorMessage,
              nextAttemptAt: nextAttemptAt(attempts, now),
            })
          }
        }
      }

      this._lastSyncTime = new Date()
      result.success = result.failed === 0 && !result.parked

      if (result.synced > 0) {
        console.log(`[SyncManager] Synced ${result.synced} mutations`)
      }
      if (result.failed > 0) {
        console.warn(`[SyncManager] Failed ${result.failed} mutations`)
        this._lastError = `${result.failed} mutations failed to sync`
      }
      if (result.parked) {
        this._lastError = `${result.parked} refused by the server and kept as not sent`
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed'
      this._lastError = errorMessage
      result.success = false
      console.error('[SyncManager] Sync error:', error)
    } finally {
      this._isSyncing = false
      await this.updatePendingCount()
      this.notifyListeners()
    }

    return result
  }

  /**
   * Process a single mutation
   */
  private async processMutation(mutation: PendingMutation): Promise<unknown> {
    const handler = mutationHandlers[mutation.type]
    
    if (!handler) {
      throw new Error(`No handler for mutation type: ${mutation.type}`)
    }
    console.log(`[SyncManager] Processing mutation: ${mutation.type}`, mutation.id)
    return handler(mutation)
  }

  // ===========================================================================
  // PERIODIC SYNC
  // ===========================================================================

  private startPeriodicSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId)
    }
    
    this.syncIntervalId = setInterval(async () => {
      // Re-read first: the counts are per person and house (ADR 0241), and
      // either can change without anything being queued — a house switch, or
      // the same person signing back in to a queue their session left.
      try {
        await this.refresh()
      } catch (error) {
        console.error('[SyncManager] Could not read the queue:', error)
        return
      }
      if (this._isOnline && !this._isSyncing && this._pendingCount > 0) {
        await this.syncNow()
      }
    }, this.SYNC_INTERVAL)
  }

  private stopPeriodicSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId)
      this.syncIntervalId = null
    }
  }

  // ===========================================================================
  // ONLINE/OFFLINE HANDLERS
  // ===========================================================================

  private handleOnline = async (): Promise<void> => {
    console.log('[SyncManager] Online')
    this._isOnline = true
    this.notifyListeners()
    
    // Wait a moment for connection to stabilize, then sync
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
    }
    
    this.retryTimeoutId = setTimeout(async () => {
      if (this._pendingCount > 0) {
        // The network is back: whatever was waiting out a backoff goes now.
        await this.syncNow({ ignoreBackoff: true })
      }
    }, 1000)
  }

  private handleOffline = (): void => {
    console.log('[SyncManager] Offline')
    this._isOnline = false
    this.notifyListeners()
    
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
      this.retryTimeoutId = null
    }
  }

  // ===========================================================================
  // LISTENERS
  // ===========================================================================

  /**
   * Subscribe to status changes
   */
  onStatusChange(listener: SyncStatusListener): () => void {
    this.listeners.add(listener)
    
    // Immediately call with current status
    listener(this.getStatus())
    
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    const status = this.getStatus()
    this.listeners.forEach((listener) => {
      try {
        listener(status)
      } catch (error) {
        console.error('[SyncManager] Listener error:', error)
      }
    })
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private async updatePendingCount(): Promise<void> {
    // This session's entries only (`getPendingMutations` filters by owner).
    const mutations = await offlineStorage.getPendingMutations()
    const waiting = mutations.filter((m) => !m.parked)
    this._pendingCount = waiting.length
    this._notSentCount = mutations.length - waiting.length
    this._stillTryingCount = waiting.filter(
      (m) => m.retryCount >= STILL_TRYING_AFTER,
    ).length
  }

  /** This session's changes that are parked as "not sent". */
  async getNotSent(): Promise<PendingMutation[]> {
    return (await offlineStorage.getPendingMutations()).filter((m) => !!m.parked)
  }

  /**
   * "Try again" on the not-sent strip: un-park every refused change of this
   * session, reset its backoff and send now. An `unowned` change cannot be
   * retried — there is nobody to send it as — so it stays parked.
   */
  async retryNotSent(): Promise<SyncResult> {
    for (const m of await this.getNotSent()) {
      if (m.parked?.reason !== 'refused') continue
      await offlineStorage.updatePendingMutation(m.id, {
        parked: undefined,
        nextAttemptAt: undefined,
      })
    }
    await this.updatePendingCount()
    this.notifyListeners()
    return this.syncNow({ ignoreBackoff: true })
  }

  /** "Discard" on the not-sent strip: the person gives these changes up. */
  async discardNotSent(): Promise<number> {
    const parked = await this.getNotSent()
    for (const m of parked) await offlineStorage.removePendingMutation(m.id)
    await this.updatePendingCount()
    this.notifyListeners()
    return parked.length
  }

  /**
   * Before sign-out: try once to send what this session has waiting, then say
   * how many of THIS PERSON's changes (any house) are still unsent — the
   * number the sign-out warning names (OD-203 (c)).
   */
  async unsentBeforeSignOut(userId: string): Promise<number> {
    if (this._isOnline && this._pendingCount > 0) {
      try {
        await this.syncNow({ ignoreBackoff: true })
      } catch {
        /* counted below either way */
      }
    }
    return offlineStorage.countPendingMutationsOf(userId)
  }

  /** Sign-out: this person's queued changes end with their session. */
  async endSessionOf(userId: string): Promise<number> {
    const removed = await offlineStorage.removePendingMutationsOf(userId)
    await this.updatePendingCount()
    this.notifyListeners()
    return removed
  }

  /** Re-read the counts, e.g. after the signed-in person or house changed. */
  async refresh(): Promise<void> {
    await this.updatePendingCount()
    this.notifyListeners()
  }

  /**
   * Register a custom mutation handler
   */
  registerMutationHandler(
    type: string,
    handler: (mutation: PendingMutation) => Promise<unknown>
  ): void {
    mutationHandlers[type] = handler
  }

  /**
   * Clear all pending mutations
   */
  async clearPendingMutations(): Promise<void> {
    await offlineStorage.clearPendingMutations()
    await this.updatePendingCount()
    this.notifyListeners()
  }

  /**
   * Cleanup on unmount
   */
  destroy(): void {
    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('offline', this.handleOffline)
    this.stopPeriodicSync()
    
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
    }
    
    this.listeners.clear()
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const syncManager = new SyncManagerService()

export default syncManager
