/**
 * The shared pending-mutation queue has two kinds of tenants: mutations the
 * SyncManager owns (calendar.*, provider.*, notification.archive) and
 * mutations that belong to self-flushing outboxes (doorOutbox's
 * 'receiving.door', spotCountOutbox's 'inventory.spotCount'). The manager
 * used to process foreign types too: no handler → throw → three retries →
 * silent delete, which destroyed door receipts that were never sent. These
 * tests pin the fix — foreign types are invisible to the manager — and the
 * behaviours that must survive it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingMutation } from './offline-storage'

vi.mock('./offline-storage', () => ({
  offlineStorage: {
    getPendingMutations: vi.fn().mockResolvedValue([]),
    getPendingMutationsByType: vi.fn().mockResolvedValue([]),
    removePendingMutation: vi.fn().mockResolvedValue(undefined),
    updatePendingMutation: vi.fn().mockResolvedValue(undefined),
    clearPendingMutations: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../services/api/client', () => ({
  apiClient: { post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('../services/api/calendar', () => ({
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn().mockResolvedValue({ deleted: true }),
}))
vi.mock('../services/api/providers', () => ({
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
}))

import { offlineStorage } from './offline-storage'
import { deleteCalendarEvent } from '../services/api/calendar'
import { syncManager } from './sync-manager'

const mutation = (
  id: string,
  type: string,
  retryCount: number,
): PendingMutation => ({
  id,
  type,
  data: { id: 'evt-1' },
  timestamp: new Date(),
  retryCount,
})

const removedIds = () =>
  vi.mocked(offlineStorage.removePendingMutation).mock.calls.map((c) => c[0])

describe('syncNow and foreign mutation types', () => {
  beforeEach(() => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([])
    vi.mocked(offlineStorage.removePendingMutation).mockClear()
    vi.mocked(offlineStorage.updatePendingMutation).mockClear()
    vi.mocked(deleteCalendarEvent).mockClear().mockResolvedValue({ deleted: true } as never)
  })

  it('never touches foreign outbox mutations, even ones past the retry cap', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('door-fresh', 'receiving.door', 0),
      // retryCount already past MAX_RETRIES — the pre-fix code deleted this
      // at the top of the loop without even attempting it
      mutation('door-scarred', 'receiving.door', 5),
      mutation('spot-1', 'inventory.spotCount', 3),
      mutation('cal-1', 'calendar.delete', 0),
    ])

    const result = await syncManager.syncNow()

    expect(removedIds()).toEqual(['cal-1'])
    expect(offlineStorage.updatePendingMutation).not.toHaveBeenCalled()
    expect(result.synced).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.success).toBe(true)
  })

  it('still retries, not deletes, a handled mutation that fails below the cap', async () => {
    vi.mocked(deleteCalendarEvent).mockRejectedValue(new Error('500'))
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('cal-flaky', 'calendar.delete', 0),
    ])

    const result = await syncManager.syncNow()

    expect(removedIds()).toEqual([])
    expect(offlineStorage.updatePendingMutation).toHaveBeenCalledWith(
      'cal-flaky',
      expect.objectContaining({ retryCount: 1 }),
    )
    expect(result.failed).toBe(1)
  })

  it('still discards a handled mutation that exhausted its retries', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('cal-dead', 'calendar.delete', 3),
    ])

    await syncManager.syncNow()

    expect(removedIds()).toEqual(['cal-dead'])
    expect(deleteCalendarEvent).not.toHaveBeenCalled()
  })
})
