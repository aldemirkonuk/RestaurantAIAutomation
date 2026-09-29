/**
 * A spot count is never dropped for failing (ADR 0241, OD-203 (a)), and is
 * sent only as the person and house that took it (OD-203 (b)).
 *
 * Before ADR 0241 `flushSpotCountOutbox` deleted a count after 8 failed
 * attempts, and on ANY 4xx, with nothing said to anyone — the count simply
 * vanished. Every case here fails on that code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordSpotCount = vi.hoisted(() => vi.fn())
vi.mock('../services/api/inventory', () => ({ recordSpotCount }))

const store = vi.hoisted(() => ({
  getPendingMutationsByType: vi.fn(),
  removePendingMutation: vi.fn(),
  updatePendingMutation: vi.fn(),
  addPendingMutation: vi.fn(),
}))
vi.mock('./offline-storage', () => ({ offlineStorage: store }))

import { flushSpotCountOutbox } from './spotCountOutbox'

const U1 = '11111111-1111-4111-8111-111111111111'
const H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const H2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const count = (id: string, retryCount = 0, over: Record<string, unknown> = {}) => ({
  id,
  type: 'inventory.spotCount',
  data: { itemId: `i-${id}`, itemLabel: id, restaurantId: H1, body: { countedQty: 3, clientCountId: id } },
  timestamp: new Date(),
  retryCount,
  owner: { userId: U1, restaurantId: H1 },
  ...over,
})

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem(
    'accessToken',
    `h.${btoa(JSON.stringify({ sub: U1, restaurantId: H1 }))}.s`,
  )
  window.localStorage.setItem('activeRestaurantId', H1)
  store.removePendingMutation.mockResolvedValue(undefined)
  store.updatePendingMutation.mockResolvedValue(undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe('flushSpotCountOutbox — never dropped for failing', () => {
  it('keeps a count that has already failed 7 times and fails again (the old eighth attempt deleted it)', async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('c', 7)])
    recordSpotCount.mockRejectedValue(httpError(503))

    const res = await flushSpotCountOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({ retryCount: 8 }),
    )
    expect(res).toEqual({ sent: 0, failed: 1, parked: 0 })
  })

  it('parks — does not delete — a count the server refuses for good', async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('r')])
    recordSpotCount.mockRejectedValue(httpError(422))

    const res = await flushSpotCountOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'r',
      expect.objectContaining({ parked: expect.objectContaining({ reason: 'refused', status: 422 }) }),
    )
    expect(res.parked).toBe(1)
  })

  it('treats a 401 as "the session ended": kept and retried, never parked', async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('a')])
    recordSpotCount.mockRejectedValue(httpError(401))

    await flushSpotCountOutbox()

    const patch = store.updatePendingMutation.mock.calls[0][1]
    expect(patch.parked).toBeUndefined()
    expect(patch.retryCount).toBe(1)
    expect(store.removePendingMutation).not.toHaveBeenCalled()
  })

  it('leaves a parked count alone until the person acts on it', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      count('p', 0, { parked: { reason: 'refused', status: 422, at: 'x' } }),
    ])

    await flushSpotCountOutbox()

    expect(recordSpotCount).not.toHaveBeenCalled()
  })

  it('still sends and removes a count the server takes', async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('ok')])
    recordSpotCount.mockResolvedValue({})

    const res = await flushSpotCountOutbox()

    expect(store.removePendingMutation).toHaveBeenCalledWith('ok')
    expect(res).toEqual({ sent: 1, failed: 0, parked: 0 })
  })
})

describe('flushSpotCountOutbox — only as the person and house that took it', () => {
  it('does not send a count taken in another house', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      count('other', 0, { owner: { userId: U1, restaurantId: H2 } }),
    ])

    await flushSpotCountOutbox()

    expect(recordSpotCount).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).not.toHaveBeenCalled()
  })

  it('parks a legacy count that names no house, instead of sending it as whoever is signed in', async () => {
    const legacy = count('old')
    delete (legacy as Record<string, unknown>).owner
    ;(legacy.data as Record<string, unknown>).restaurantId = undefined
    store.getPendingMutationsByType.mockResolvedValue([legacy])

    await flushSpotCountOutbox()

    expect(recordSpotCount).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'old',
      expect.objectContaining({ parked: expect.objectContaining({ reason: 'unowned' }) }),
    )
  })
})
