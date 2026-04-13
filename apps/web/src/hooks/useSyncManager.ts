/**
 * useSyncManager Hook
 * ===================
 * React hook for accessing the sync manager and its status.
 * Provides reactive updates when sync status changes.
 */

import { useState, useEffect, useCallback } from 'react'
import { syncManager, SyncStatus, SyncResult, MutationDescriptor } from '../lib/sync-manager'

export interface UseSyncManagerReturn {
  /** Current sync status */
  status: SyncStatus
  
  /** Whether the device is online */
  isOnline: boolean
  
  /** Whether a sync operation is in progress */
  isSyncing: boolean
  
  /** Number of pending mutations */
  pendingCount: number
  
  /** Last successful sync time */
  lastSyncTime: Date | null
  
  /** Last error message */
  lastError: string | null
  
  /** Queue a mutation for sync */
  queueMutation: (mutation: MutationDescriptor) => Promise<string>
  
  /** Force sync now */
  syncNow: () => Promise<SyncResult>
  
  /** Clear all pending mutations */
  clearPendingMutations: () => Promise<void>
}

/**
 * Hook to access sync manager and reactive status updates
 */
export function useSyncManager(): UseSyncManagerReturn {
  const [status, setStatus] = useState<SyncStatus>(syncManager.getStatus())

  useEffect(() => {
    // Subscribe to status changes
    const unsubscribe = syncManager.onStatusChange((newStatus) => {
      setStatus(newStatus)
    })

    return unsubscribe
  }, [])

  const queueMutation = useCallback(async (mutation: MutationDescriptor): Promise<string> => {
    return syncManager.queueMutation(mutation)
  }, [])

  const syncNow = useCallback(async (): Promise<SyncResult> => {
    return syncManager.syncNow()
  }, [])

  const clearPendingMutations = useCallback(async (): Promise<void> => {
    return syncManager.clearPendingMutations()
  }, [])

  return {
    status,
    isOnline: status.isOnline,
    isSyncing: status.isSyncing,
    pendingCount: status.pendingCount,
    lastSyncTime: status.lastSyncTime,
    lastError: status.lastError,
    queueMutation,
    syncNow,
    clearPendingMutations,
  }
}

export default useSyncManager
