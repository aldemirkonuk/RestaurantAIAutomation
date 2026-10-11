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
    countPendingMutationsOf: vi.fn().mockResolvedValue(0),
    getAllPendingMutationsOnDevice: vi.fn().mockResolvedValue([]),
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
// The two self-flushing outboxes. `retryNotSent` must flush them, since
// `syncNow` skips their entries.
const flushDoorOutbox = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ sent: 0, failed: 0, parked: 0, unreachable: false }),
)
const flushSpotCountOutbox = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ sent: 0, failed: 0, parked: 0 }),
)
vi.mock('./doorOutbox', () => ({ flushDoorOutbox }))
// The real queue's predicates (which counts are overtaken, how a refused one
// is named), with only its flush replaced.
vi.mock('./spotCountOutbox', async (importActual) => ({
  ...(await importActual<typeof import('./spotCountOutbox')>()),
  flushSpotCountOutbox,
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

describe('retryNotSent reaches the door and spot-count outboxes (ADR 0241 amendment, 2026-09-29)', () => {
  beforeEach(() => {
    vi.mocked(offlineStorage.updatePendingMutation).mockClear()
    flushDoorOutbox.mockClear()
    flushSpotCountOutbox.mockClear()
  })

  it('un-parks a refused door receipt and flushes the door outbox after it', async () => {
    const door: PendingMutation = {
      ...mutation('door-1', 'receiving.door', 0),
      parked: { reason: 'refused', status: 422, at: '2026-09-29T00:00:00.000Z' },
    }
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([door])

    await syncManager.retryNotSent()

    expect(offlineStorage.updatePendingMutation).toHaveBeenCalledWith(
      'door-1',
      expect.objectContaining({ parked: undefined }),
    )
    // `syncNow` skips 'receiving.door', so without this "Try again" was a no-op.
    expect(flushDoorOutbox).toHaveBeenCalledTimes(1)
    expect(flushSpotCountOutbox).toHaveBeenCalledTimes(1)
    const unparkedAt = vi.mocked(offlineStorage.updatePendingMutation).mock.invocationCallOrder[0]
    expect(flushDoorOutbox.mock.invocationCallOrder[0]).toBeGreaterThan(unparkedAt)
  })

  it('still finishes the retry when an outbox pass rejects', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([])
    flushSpotCountOutbox.mockRejectedValueOnce(new Error('offline'))

    await expect(syncManager.retryNotSent()).resolves.toBeDefined()
    expect(flushDoorOutbox).toHaveBeenCalledTimes(1)
  })
})

describe('F-246: door receipts and spot counts send themselves when the network returns', () => {
  beforeEach(() => {
    flushDoorOutbox.mockClear()
    flushSpotCountOutbox.mockClear()
  })

  it('flushes both outboxes when the browser comes back online, with no screen open', async () => {
    vi.useFakeTimers()
    try {
      // A spot count waits in the queue; nothing on screen owns it.
      vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
        mutation('count-1', 'inventory.spotCount', 0),
      ])
      await syncManager.refresh()

      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(1_000)

      expect(flushSpotCountOutbox).toHaveBeenCalledTimes(1)
      expect(flushDoorOutbox).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes both outboxes on the start-up pass and again on the periodic pass', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
        mutation('door-1', 'receiving.door', 0),
      ])
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
      const fresh = (await import('./sync-manager')).syncManager
      flushDoorOutbox.mockClear()
      flushSpotCountOutbox.mockClear()

      await vi.advanceTimersByTimeAsync(2_000)
      expect(flushDoorOutbox).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(28_000)
      expect(flushDoorOutbox).toHaveBeenCalledTimes(2)
      expect(flushSpotCountOutbox).toHaveBeenCalledTimes(2)
      fresh.destroy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('F-246 (audit nit): sign-out sends door receipts and spot counts before it counts', () => {
  it('flushes both outboxes before naming what is still unsent', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([
      mutation('door-1', 'receiving.door', 0),
      mutation('count-1', 'inventory.spotCount', 0),
    ])
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await syncManager.refresh()
    flushDoorOutbox.mockClear()
    flushSpotCountOutbox.mockClear()
    vi.mocked(offlineStorage.countPendingMutationsOf).mockClear()

    await syncManager.unsentBeforeSignOut(U1)

    expect(flushDoorOutbox).toHaveBeenCalledTimes(1)
    expect(flushSpotCountOutbox).toHaveBeenCalledTimes(1)
    const countedAt = vi.mocked(offlineStorage.countPendingMutationsOf).mock.invocationCallOrder[0]
    expect(flushSpotCountOutbox.mock.invocationCallOrder[0]).toBeLessThan(countedAt)
  })
})

describe('F-831: a count refused as overtaken is counted again, never tried again', () => {
  const overtaken: PendingMutation = {
    id: 'count-1',
    type: 'inventory.spotCount',
    data: { itemId: 'inv-1', itemLabel: 'Barolo 2019', body: { countedQty: 3, clientCountId: 'k' } },
    timestamp: new Date(),
    retryCount: 0,
    owner: { userId: U1, restaurantId: H1 },
    lastError: 'Bottles of this item were sold, received or moved after this count was taken, so it was not applied. Count it again.',
    parked: { reason: 'refused', status: 409, at: '2026-10-10T00:00:00.000Z' },
  }
  const refusedDoor: PendingMutation = {
    ...mutation('door-1', 'receiving.door', 0),
    parked: { reason: 'refused', status: 422, at: '2026-10-10T00:00:00.000Z' },
  }

  beforeEach(() => {
    vi.mocked(offlineStorage.updatePendingMutation).mockClear()
    vi.mocked(offlineStorage.removePendingMutation).mockClear()
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([overtaken, refusedDoor])
  })

  it('names the refused count by item in the status the strip reads', async () => {
    await syncManager.refresh()

    expect(syncManager.getStatus().notSentCount).toBe(2)
    expect(syncManager.getStatus().parkedCounts).toEqual([
      expect.objectContaining({ id: 'count-1', itemLabel: 'Barolo 2019', overtaken: true }),
    ])
  })

  it('"Try again" leaves the overtaken count parked and still retries the rest', async () => {
    await syncManager.retryNotSent()

    const unparked = vi.mocked(offlineStorage.updatePendingMutation).mock.calls.map((c) => c[0])
    expect(unparked).toContain('door-1')
    expect(unparked).not.toContain('count-1')
  })

  it('"Discard" on the strip leaves the listed count to its own Discard', async () => {
    await syncManager.discardNotSent()

    expect(removedIds()).toEqual(['door-1'])
  })

  it('its own Discard removes just that count', async () => {
    await syncManager.discardNotSentOne('count-1')

    expect(removedIds()).toEqual(['count-1'])
  })

  it('re-reads when the spot-count queue says it changed', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([])
    await syncManager.refresh()
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([overtaken])

    window.dispatchEvent(new Event('mdv:spot-counts-changed'))
    await vi.waitFor(() => expect(syncManager.getStatus().parkedCounts).toHaveLength(1))
  })
})

describe('F-1258: every parked change is named for the strip, and Discard removes only what it showed', () => {
  const parked = { reason: 'refused' as const, status: 422, at: '2026-10-10T00:00:00.000Z' }
  const door: PendingMutation = {
    ...mutation('door-1', 'receiving.door', 0),
    data: { orderId: 'o1', orderLabel: 'PO-104', restaurantId: H1, body: {} },
    parked,
  }
  const vendor: PendingMutation = {
    ...mutation('vendor-1', 'provider.create', 0),
    data: { name: 'Ege Şarap' },
    parked,
  }
  const waiting = mutation('cal-1', 'calendar.create', 0)

  beforeEach(() => {
    vi.mocked(offlineStorage.removePendingMutation).mockClear()
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([door, vendor, waiting])
  })

  it('names each parked change in plain words; a door receipt points at /receiving', async () => {
    await syncManager.refresh()

    expect(syncManager.getStatus().parkedChanges).toEqual([
      { id: 'door-1', label: 'Delivery PO-104', href: '/receiving' },
      { id: 'vendor-1', label: 'New vendor Ege Şarap' },
    ])
  })

  it('Discard all removes only the ids the strip listed, never one parked since', async () => {
    const removed = await syncManager.discardNotSent(['door-1'])

    expect(removed).toBe(1)
    expect(removedIds()).toEqual(['door-1'])
  })
})

describe('F-1259: this person\'s changes in another house are counted, by house', () => {
  const H2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const U2 = '22222222-2222-4222-8222-222222222222'
  const inHouse = (id: string, userId: string, house: string): PendingMutation => ({
    ...mutation(id, 'calendar.create', 0),
    owner: { userId, restaurantId: house },
  })

  it('counts this person\'s entries from other houses only', async () => {
    vi.mocked(offlineStorage.getPendingMutations).mockResolvedValue([])
    vi.mocked(offlineStorage.getAllPendingMutationsOnDevice).mockResolvedValue([
      inHouse('a', U1, H2),
      { ...inHouse('b', U1, H2), parked: { reason: 'refused', status: 422, at: 'x' } },
      inHouse('c', U1, H1), // this house: already on the strip
      inHouse('d', U2, H2), // another person's
      { ...mutation('e', 'receiving.door', 0), owner: undefined, data: { restaurantId: H2 } }, // names no person
    ])
    await syncManager.refresh()

    expect(syncManager.getStatus().waitingElsewhere).toEqual([{ restaurantId: H2, count: 2 }])
  })

  it('a failed device read keeps the last answer instead of saying nothing waits', async () => {
    vi.mocked(offlineStorage.getAllPendingMutationsOnDevice).mockResolvedValueOnce([inHouse('a', U1, H2)])
    await syncManager.refresh()
    vi.mocked(offlineStorage.getAllPendingMutationsOnDevice).mockRejectedValueOnce(new Error('blocked'))
    await syncManager.refresh()

    expect(syncManager.getStatus().waitingElsewhere).toEqual([{ restaurantId: H2, count: 1 }])
  })
})
