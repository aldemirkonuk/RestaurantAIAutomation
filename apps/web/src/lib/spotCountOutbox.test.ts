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

import {
  flushSpotCountOutbox,
  isOvertakenCount,
  parkedSpotCountsOf,
  submitSpotCount,
  SPOT_COUNTS_CHANGED_EVENT,
} from './spotCountOutbox'

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

describe('flushSpotCountOutbox — a house switch in the middle of a flush', () => {
  it('stops sending the rest once the session is in another house', async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('a'), count('b')])
    recordSpotCount.mockImplementationOnce(async () => {
      window.localStorage.setItem(
        'accessToken',
        `h.${btoa(JSON.stringify({ sub: U1, restaurantId: H2 }))}.s`,
      )
      window.localStorage.setItem('activeRestaurantId', H2)
      return {}
    })

    await flushSpotCountOutbox()

    expect(recordSpotCount).toHaveBeenCalledTimes(1)
    expect(store.removePendingMutation).toHaveBeenCalledWith('a')
    expect(store.removePendingMutation).not.toHaveBeenCalledWith('b')
  })
})


describe('flushSpotCountOutbox — a failed mark never ends the flush', () => {
  it('still sends the counts after one whose queue update failed', async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('bad'), count('good')])
    recordSpotCount.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce({})
    store.updatePendingMutation.mockRejectedValueOnce(new Error('QuotaExceededError'))

    const res = await flushSpotCountOutbox()

    expect(recordSpotCount).toHaveBeenCalledTimes(2)
    expect(store.removePendingMutation).toHaveBeenCalledWith('good')
    expect(res).toEqual({ sent: 1, failed: 1, parked: 0 })
  })
})

describe('F-249: a queued count says how old it is', () => {
  it('sends the age of a count taken six hours ago, so the house can tell it from a fresh one', async () => {
    const takenAt = Date.now() - 6 * 60 * 60_000
    store.getPendingMutationsByType.mockResolvedValue([
      count('old', 0, {
        data: {
          itemId: 'i-old',
          itemLabel: 'old',
          restaurantId: H1,
          body: { countedQty: 12, clientCountId: 'old' },
          countedAt: new Date(takenAt).toISOString(),
        },
      }),
    ])
    recordSpotCount.mockResolvedValue({ item: null })

    await flushSpotCountOutbox()

    const body = recordSpotCount.mock.calls[0][1]
    expect(body.countedQty).toBe(12)
    expect(body.clientCountId).toBe('old')
    expect(body.countedAgoMs).toBeGreaterThanOrEqual(6 * 60 * 60_000)
    expect(body.countedAgoMs).toBeLessThan(6 * 60 * 60_000 + 60_000)
  })

  it('stamps the moment of the tap on a count it queues', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    store.addPendingMutation.mockResolvedValue('m1')
    const { submitSpotCount } = await import('./spotCountOutbox')
    const before = Date.now()

    await submitSpotCount({
      itemId: 'i1',
      itemLabel: 'Barolo',
      body: { countedQty: 4, clientCountId: 'k1' },
    })

    const queued = store.addPendingMutation.mock.calls[0][0].data
    expect(Date.parse(queued.countedAt)).toBeGreaterThanOrEqual(before)
  })

  it('sends a count queued before the stamp existed exactly as before', async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('legacy')])
    recordSpotCount.mockResolvedValue({ item: null })

    await flushSpotCountOutbox()

    expect(recordSpotCount.mock.calls[0][1]).toEqual({ countedQty: 3, clientCountId: 'legacy' })
  })
})

describe('submitSpotCount — the count comes back (F-645)', () => {
  it("returns what the books said, what was counted, and the difference", async () => {
    recordSpotCount.mockResolvedValue({
      item: null,
      count: { expectedQty: 12, countedQty: 10, varianceQty: -2, replayed: false },
    })
    const res = await submitSpotCount({
      itemId: 'i-1',
      itemLabel: 'Yakut',
      restaurantId: H1,
      body: { countedQty: 10, clientCountId: 'k' },
    })
    expect(res).toEqual({
      synced: true,
      count: { expectedQty: 12, countedQty: 10, varianceQty: -2, replayed: false },
    })
  })

  it('a queued count has no result yet', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    store.addPendingMutation.mockResolvedValue(undefined)
    const res = await submitSpotCount({
      itemId: 'i-1',
      itemLabel: 'Yakut',
      restaurantId: H1,
      body: { countedQty: 10, clientCountId: 'k' },
    })
    expect(res).toEqual({ synced: false })
  })
})

describe('F-831: a count refused as overtaken is named, and clears once counted again', () => {
  const OVERTAKEN =
    'Bottles of this item were sold, received or moved after this count was taken, so it was not applied. Count it again.'
  const refused409 = () =>
    Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409, data: { statusCode: 409, message: OVERTAKEN } },
    })
  const parked = (id: string, over: Record<string, unknown> = {}) =>
    count(id, 0, {
      parked: { reason: 'refused', status: 409, at: '2026-10-10T12:00:00.000Z' },
      lastError: OVERTAKEN,
      ...over,
    })

  it("keeps the house's sentence, not axios's, on the parked count", async () => {
    store.getPendingMutationsByType.mockResolvedValue([count('o')])
    recordSpotCount.mockRejectedValue(refused409())

    await flushSpotCountOutbox()

    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'o',
      expect.objectContaining({
        lastError: OVERTAKEN,
        parked: expect.objectContaining({ reason: 'refused', status: 409 }),
      }),
    )
  })

  it('tells the app a count was parked, so the strip re-reads', async () => {
    const heard = vi.fn()
    window.addEventListener(SPOT_COUNTS_CHANGED_EVENT, heard)
    store.getPendingMutationsByType.mockResolvedValue([count('o')])
    recordSpotCount.mockRejectedValue(refused409())

    await flushSpotCountOutbox()

    window.removeEventListener(SPOT_COUNTS_CHANGED_EVENT, heard)
    expect(heard).toHaveBeenCalled()
  })

  it('names each refused count by its item, and marks only a 409 as overtaken', () => {
    const list = parkedSpotCountsOf([
      parked('a', { data: { itemId: 'i-a', itemLabel: 'Barolo 2019', body: {} } }),
      count('b', 0, {
        parked: { reason: 'refused', status: 422, at: 'x' },
        lastError: 'Request failed with status code 422',
      }),
      count('c'),
      count('d', 0, { parked: { reason: 'unowned', at: 'x' } }),
    ] as never)

    expect(list).toEqual([
      { id: 'a', itemId: 'i-a', itemLabel: 'Barolo 2019', overtaken: true, message: OVERTAKEN },
      // axios's words are never shown
      expect.objectContaining({ id: 'b', overtaken: false, message: 'The house did not accept this count.' }),
    ])
    expect(isOvertakenCount(parked('a') as never)).toBe(true)
    expect(isOvertakenCount(count('c') as never)).toBe(false)
  })

  it('a fresh count of the item clears its overtaken count, and leaves other items alone', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      parked('old', { data: { itemId: 'i-x', itemLabel: 'x', restaurantId: H1, body: {} } }),
      parked('other', { data: { itemId: 'i-y', itemLabel: 'y', restaurantId: H1, body: {} } }),
    ])
    recordSpotCount.mockResolvedValue({})

    const res = await submitSpotCount({
      itemId: 'i-x',
      itemLabel: 'x',
      restaurantId: H1,
      body: { countedQty: 4, clientCountId: 'new' },
    })

    expect(res).toEqual({ synced: true, count: null })
    expect(store.removePendingMutation).toHaveBeenCalledWith('old')
    expect(store.removePendingMutation).not.toHaveBeenCalledWith('other')
  })

  it('a count of one shelf clears only that shelf\'s overtaken count; a count of every shelf clears any (F-291)', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      parked('cellar', { data: { itemId: 'i-x', itemLabel: 'x', restaurantId: H1, body: { locationId: 'L-cellar' } } }),
      parked('bar', { data: { itemId: 'i-x', itemLabel: 'x', restaurantId: H1, body: { locationId: 'L-bar' } } }),
      parked('whole', { data: { itemId: 'i-x', itemLabel: 'x', restaurantId: H1, body: {} } }),
    ])
    recordSpotCount.mockResolvedValue({})

    await submitSpotCount({
      itemId: 'i-x',
      itemLabel: 'x',
      restaurantId: H1,
      body: { countedQty: 2, clientCountId: 'bar-again', locationId: 'L-bar' },
    })

    expect(store.removePendingMutation).toHaveBeenCalledWith('bar')
    expect(store.removePendingMutation).not.toHaveBeenCalledWith('cellar')
    expect(store.removePendingMutation).not.toHaveBeenCalledWith('whole')

    store.removePendingMutation.mockClear()
    await submitSpotCount({
      itemId: 'i-x',
      itemLabel: 'x',
      restaurantId: H1,
      body: { countedQty: 9, clientCountId: 'every-shelf' },
    })

    expect(store.removePendingMutation).toHaveBeenCalledWith('cellar')
    expect(store.removePendingMutation).toHaveBeenCalledWith('whole')
  })

  it('a count taken before the overtaken one does not clear it', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      count('early', 0, {
        data: { itemId: 'i-x', itemLabel: 'x', restaurantId: H1, countedAt: '2026-10-10T09:00:00.000Z', body: { countedQty: 1, clientCountId: 'early' } },
      }),
      parked('late', {
        data: { itemId: 'i-x', itemLabel: 'x', restaurantId: H1, countedAt: '2026-10-10T10:00:00.000Z', body: {} },
      }),
    ])
    recordSpotCount.mockResolvedValue({})

    await flushSpotCountOutbox()

    expect(store.removePendingMutation).toHaveBeenCalledWith('early')
    expect(store.removePendingMutation).not.toHaveBeenCalledWith('late')
  })
})
