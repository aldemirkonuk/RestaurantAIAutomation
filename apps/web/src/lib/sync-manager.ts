/**
 * Sync Manager Service
 * ====================
 * Manages synchronization between local offline storage and remote API.
 * Handles online/offline detection, mutation queue processing, and retry logic.
 */

import { offlineStorage, PendingMutation } from './offline-storage'
import { apiClient } from '../services/api/client'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../services/api/calendar'
import { createProvider, updateProvider } from '../services/api/providers'

// =============================================================================
// TYPES
// =============================================================================

export interface SyncStatus {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  lastSyncTime: Date | null
  lastError: string | null
}

export interface SyncResult {
  success: boolean
  synced: number
  failed: number
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
    const data = (mutation.data ?? {}) as Record<string, unknown>
    return createProvider(data as any)
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
  
  private listeners: Set<SyncStatusListener> = new Set()
  private syncIntervalId: ReturnType<typeof setInterval> | null = null
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null
  
  // Retry configuration
  private readonly MAX_RETRIES = 3
  private readonly SYNC_INTERVAL = 30000 // 30 seconds

  constructor() {
    this.initialize()
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private async initialize(): Promise<void> {
    // Set up online/offline listeners
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
    
    // Initial pending count
    await this.updatePendingCount()
    
    // Start periodic sync check
    this.startPeriodicSync()
    
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
   * Force sync now
   */
  async syncNow(): Promise<SyncResult> {
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

        // Skip and discard mutations that already exhausted retries
        if (mutation.retryCount >= this.MAX_RETRIES) {
          console.warn(`[SyncManager] Discarding dead mutation ${mutation.id} (type: ${mutation.type}, retries: ${mutation.retryCount})`)
          await offlineStorage.removePendingMutation(mutation.id)
          continue
        }

        try {
          await this.processMutation(mutation)
          await offlineStorage.removePendingMutation(mutation.id)
          result.synced++
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          result.failed++
          result.errors.push({ mutationId: mutation.id, error: errorMessage })
          const newRetryCount = mutation.retryCount + 1
          if (newRetryCount >= this.MAX_RETRIES) {
            // Discard immediately — no point keeping a permanently-broken mutation
            console.error(`[SyncManager] Max retries reached for mutation ${mutation.id}, discarding`)
            await offlineStorage.removePendingMutation(mutation.id)
          } else {
            await offlineStorage.updatePendingMutation(mutation.id, {
              retryCount: newRetryCount,
              lastError: errorMessage,
            })
          }
        }
      }

      this._lastSyncTime = new Date()
      result.success = result.failed === 0

      if (result.synced > 0) {
        console.log(`[SyncManager] Synced ${result.synced} mutations`)
      }
      if (result.failed > 0) {
        console.warn(`[SyncManager] Failed ${result.failed} mutations`)
        this._lastError = `${result.failed} mutations failed to sync`
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
        await this.syncNow()
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
    const mutations = await offlineStorage.getPendingMutations()
    this._pendingCount = mutations.length
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
