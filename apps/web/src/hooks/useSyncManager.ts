/**
 * useSyncManager Hook
 * ===================
 * React hook for accessing the sync manager and its status.
 * Provides reactive updates when sync status changes.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  syncManager,
  SyncStatus,
  SyncResult,
  MutationDescriptor,
  type ParkedChange,
  type WaitingElsewhere,
} from '../lib/sync-manager'
import type { ParkedSpotCount } from '../lib/spotCountOutbox'

export interface UseSyncManagerReturn {
  /** Current sync status */
  status: SyncStatus
  
  /** Whether the device is online */
  isOnline: boolean
  
  /** Whether a sync operation is in progress */
  isSyncing: boolean
  
  /** Number of pending mutations */
  pendingCount: number

  /** This session's changes parked as "not sent" (ADR 0241, OD-203). */
  notSentCount: number

  /** Waiting changes that have failed several times and are still retried. */
  stillTryingCount: number

  /** Un-park refused changes and send everything waiting now. */
  retryNotSent: () => Promise<SyncResult>

  /** Remove the parked changes (only `ids`, when given): the person gives them up. */
  discardNotSent: (ids?: string[]) => Promise<number>

  /** Refused spot counts, by item and in the house's words (F-831). */
  parkedCounts: ParkedSpotCount[]

  /** Remove one parked change the strip names. */
  discardNotSentOne: (id: string) => Promise<void>

  /** The other parked changes, one row each, by name (F-1258). */
  parkedChanges: ParkedChange[]

  /** This person's changes waiting in other houses on this device (F-1259). */
  waitingElsewhere: WaitingElsewhere[]

  /** Re-read the counts, e.g. after a house switch. */
  refresh: () => Promise<void>
  
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

  const retryNotSent = useCallback(() => syncManager.retryNotSent(), [])
  const discardNotSent = useCallback((ids?: string[]) => syncManager.discardNotSent(ids), [])
  const refresh = useCallback(() => syncManager.refresh(), [])
  const discardNotSentOne = useCallback((id: string) => syncManager.discardNotSentOne(id), [])

  return {
    status,
    isOnline: status.isOnline,
    isSyncing: status.isSyncing,
    pendingCount: status.pendingCount,
    notSentCount: status.notSentCount ?? 0,
    stillTryingCount: status.stillTryingCount ?? 0,
    retryNotSent,
    discardNotSent,
    parkedCounts: status.parkedCounts ?? [],
    discardNotSentOne,
    parkedChanges: status.parkedChanges ?? [],
    waitingElsewhere: status.waitingElsewhere ?? [],
    refresh,
    lastSyncTime: status.lastSyncTime,
    lastError: status.lastError,
    queueMutation,
    syncNow,
    clearPendingMutations,
  }
}

export default useSyncManager
