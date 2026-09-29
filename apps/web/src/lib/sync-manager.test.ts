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
import { createProvider } from '../services/api/providers'
import { syncManager } from './sync-manager'

// The session the tests run as: person U1 in house H1 (ADR 0241 stamps and
// matches every queued change on this pair).
const U1 = '11111111-1111-4111-8111-111111111111'
const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function signInAs(userId: string, house: string) {
  const body = btoa(JSON.stringify({ sub: userId, restaurantId: house }))
  window.localStorage.setItem('accessToken', `h.${body}.s`)
  window.localStorage.setItem('activeRestaurantId', house)
}

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
  owner: { userId: U1, restaurantId: H1 },
})

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

beforeEach(() => signInAs(U1, H1))

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

})

describe('OD-203 (a): a change is never deleted for failing — ADR 0241', () => {
  beforeEach(() => {
    vi.mocked(offlineStorage.removePendingMutation).mockClear()
    vi.mocked(offlineStorage.updatePendingMutation).mockClear()
    vi.mocked(deleteCalendarEvent).mockClear().mockResolvedValue({ deleted: true } as never)
  })

  it('still SENDS a change that failed three times (the old cap deleted it unsent)', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('cal-old', 'calendar.delete', 3),
    ])

    const result = await syncManager.syncNow()

    expect(deleteCalendarEvent).toHaveBeenCalledWith('evt-1')
    expect(removedIds()).toEqual(['cal-old'])
    expect(result.synced).toBe(1)
  })

  it('keeps a change that keeps failing, with a backoff, however many times it failed', async () => {
    vi.mocked(deleteCalendarEvent).mockRejectedValue(httpError(503))
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('cal-stuck', 'calendar.delete', 40),
    ])

    const result = await syncManager.syncNow()

    expect(removedIds()).toEqual([])
    const [id, patch] = vi.mocked(offlineStorage.updatePendingMutation).mock.calls[0]
    expect(id).toBe('cal-stuck')
    expect(patch.retryCount).toBe(41)
    expect(Date.parse(patch.nextAttemptAt as string)).toBeGreaterThan(Date.now())
    expect(patch.parked).toBeUndefined()
    expect(result.failed).toBe(1)
  })

  it('parks — does not delete — a permanent refusal, and names it as not sent', async () => {
    vi.mocked(deleteCalendarEvent).mockRejectedValue(httpError(422))
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('cal-refused', 'calendar.delete', 0),
    ])

    const result = await syncManager.syncNow()

    expect(removedIds()).toEqual([])
    expect(offlineStorage.updatePendingMutation).toHaveBeenCalledWith(
      'cal-refused',
      expect.objectContaining({
        parked: expect.objectContaining({ reason: 'refused', status: 422 }),
      }),
    )
    expect(result.parked).toBe(1)
    expect(result.success).toBe(false)
  })

  it('treats 401 (session ended) and 429 as "try later", never as a refusal', async () => {
    for (const status of [401, 429]) {
      vi.mocked(offlineStorage.updatePendingMutation).mockClear()
      vi.mocked(deleteCalendarEvent).mockRejectedValue(httpError(status))
      vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
        mutation(`cal-${status}`, 'calendar.delete', 0),
      ])
      await syncManager.syncNow()
      const patch = vi.mocked(offlineStorage.updatePendingMutation).mock.calls[0][1]
      expect(patch.parked).toBeUndefined()
      expect(patch.retryCount).toBe(1)
    }
    expect(removedIds()).toEqual([])
  })

  it('waits out the backoff, unless the network just came back', async () => {
    const waiting = {
      ...mutation('cal-wait', 'calendar.delete', 2),
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
    }
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([waiting])

    await syncManager.syncNow()
    expect(deleteCalendarEvent).not.toHaveBeenCalled()

    await syncManager.syncNow({ ignoreBackoff: true })
    expect(deleteCalendarEvent).toHaveBeenCalledTimes(1)
  })

  it('leaves a parked change alone until the person acts on it', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      { ...mutation('cal-parked', 'calendar.delete', 0), parked: { reason: 'refused', status: 403, at: 'x' } },
    ])

    await syncManager.syncNow({ ignoreBackoff: true })

    expect(deleteCalendarEvent).not.toHaveBeenCalled()
    expect(removedIds()).toEqual([])
  })
})

describe('OD-203 (b): a change is sent only as the person and house that made it', () => {
  beforeEach(() => {
    vi.mocked(offlineStorage.removePendingMutation).mockClear()
    vi.mocked(offlineStorage.updatePendingMutation).mockClear()
    vi.mocked(deleteCalendarEvent).mockClear().mockResolvedValue({ deleted: true } as never)
  })

  it('stops a pass part-way when the house changes under it (a switch in this tab or another)', async () => {
    const H2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    vi.mocked(deleteCalendarEvent).mockImplementationOnce(async () => {
      signInAs(U1, H2) // the switch lands while the first send is in flight
      return { deleted: true } as never
    })
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('cal-first', 'calendar.delete', 0),
      mutation('cal-second', 'calendar.delete', 0),
    ])

    await syncManager.syncNow({ ignoreBackoff: true })

    expect(deleteCalendarEvent).toHaveBeenCalledTimes(1)
    expect(removedIds()).toEqual(['cal-first'])
  })

  it('parks a legacy change that names no owner instead of sending it as whoever is signed in', async () => {
    const legacy = mutation('cal-legacy', 'calendar.delete', 0)
    delete legacy.owner
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([legacy])

    await syncManager.syncNow({ ignoreBackoff: true })

    expect(deleteCalendarEvent).not.toHaveBeenCalled()
    expect(removedIds()).toEqual([])
    expect(offlineStorage.updatePendingMutation).toHaveBeenCalledWith(
      'cal-legacy',
      expect.objectContaining({ parked: expect.objectContaining({ reason: 'unowned' }) }),
    )
  })
})

describe('provider.create replay (PR #508 audit, 2026-09-29)', () => {
  it('sends the queued idempotency key as the key, not as a vendor field', async () => {
    vi.mocked(createProvider).mockClear().mockResolvedValue({ id: 'p1' } as never)
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      {
        id: 'm1',
        type: 'provider.create',
        data: { name: 'Kavaklıdere', idempotencyKey: 'provider-create:k1' },
        timestamp: new Date(),
        retryCount: 0,
        owner: { userId: U1, restaurantId: H1 },
      },
    ])
    await syncManager.syncNow()
    expect(createProvider).toHaveBeenCalledWith(
      { name: 'Kavaklıdere' },
      { idempotencyKey: 'provider-create:k1' },
    )
  })
})
