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
const recordPour = vi.hoisted(() => vi.fn())
const adjustStock = vi.hoisted(() => vi.fn())
vi.mock('../services/api/inventory', () => ({ recordSpotCount, recordPour, adjustStock }))
const sessionsApi = vi.hoisted(() => ({ markCountShelfDone: vi.fn(), parkCountLine: vi.fn() }))
vi.mock('../services/api/countSessions', () => sessionsApi)

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
  submitParkedLine,
  submitShelfDone,
  submitSpotCount,
  submitAdjust,
  submitPour,
  ADJUST_TYPE,
  POUR_TYPE,
  PARK_TYPE,
  SHELF_DONE_TYPE,
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

describe('F-1544: a stock-take line rides this queue', () => {
  it('a spot count with no count session is sent exactly as before: no sessionId, no open bottle (strict no-op)', async () => {
    recordSpotCount.mockResolvedValue({ item: null, count: null })
    await submitSpotCount({
      itemId: 'i1',
      itemLabel: 'Barolo',
      restaurantId: H1,
      body: { countedQty: 3, clientCountId: 'k', locationId: 'L' },
    })
    const sent = recordSpotCount.mock.calls[0][1]
    expect(Object.keys(sent).sort()).toEqual(['clientCountId', 'countedQty', 'locationId'])
  })

  it("sends a walk line's count id and open tenths, and replays them with its age and the same key", async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await submitSpotCount({
      itemId: 'i1',
      itemLabel: 'Barolo',
      restaurantId: H1,
      body: { countedQty: 3, clientCountId: 'k', locationId: 'L', sessionId: 'S', openTenths: 7 },
    })
    const queued = store.addPendingMutation.mock.calls[0][0]
    expect(queued.type).toBe('inventory.spotCount')

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    store.getPendingMutationsByType.mockImplementation(async (t: string) =>
      t === 'inventory.spotCount' ? [{ ...count('q'), data: queued.data }] : [],
    )
    recordSpotCount.mockResolvedValue({ item: null, count: null })
    await flushSpotCountOutbox()
    expect(recordSpotCount).toHaveBeenCalledTimes(1)
    expect(recordSpotCount.mock.calls[0][1]).toMatchObject({
      clientCountId: 'k',
      sessionId: 'S',
      openTenths: 7,
      countedAgoMs: expect.any(Number),
    })
  })
})

describe('F-1544: "shelf done" and a parked bottle queue like a count', () => {
  const done = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    type: SHELF_DONE_TYPE,
    data: {
      restaurantId: H1,
      sessionId: 'S',
      locationId: 'L',
      shelfLabel: 'Back bar',
      body: { clientDoneId: `d-${id}`, zeroItemIds: ['i2'] },
      countedAt: new Date(Date.now() - 60_000).toISOString(),
    },
    timestamp: new Date(),
    retryCount: 0,
    owner: { userId: U1, restaurantId: H1 },
    ...over,
  })
  const byType = (map: Record<string, unknown[]>) =>
    store.getPendingMutationsByType.mockImplementation(async (t: string) => map[t] ?? [])

  it('queues a done made with no signal, and says so', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const out = await submitShelfDone({
      sessionId: 'S',
      locationId: 'L',
      shelfLabel: 'Back bar',
      body: { clientDoneId: 'd1', zeroItemIds: ['i2'] },
    })
    expect(out.synced).toBe(false)
    expect(sessionsApi.markCountShelfDone).not.toHaveBeenCalled()
    expect(store.addPendingMutation).toHaveBeenCalledWith(
      expect.objectContaining({ type: SHELF_DONE_TYPE }),
    )
  })

  it('a queued done is sent with the same key and its age, and leaves the queue once the shelf closed', async () => {
    byType({ [SHELF_DONE_TYPE]: [done('x')] })
    sessionsApi.markCountShelfDone.mockResolvedValue({ done: true, posted: ['i2'], held: [], refused: [] })
    const res = await flushSpotCountOutbox()
    expect(sessionsApi.markCountShelfDone).toHaveBeenCalledWith('S', 'L', {
      clientDoneId: 'd-x',
      zeroItemIds: ['i2'],
      countedAgoMs: expect.any(Number),
    })
    const age = sessionsApi.markCountShelfDone.mock.calls[0][2].countedAgoMs
    expect(age).toBeGreaterThanOrEqual(60_000)
    expect(store.removePendingMutation).toHaveBeenCalledWith('x')
    expect(res.sent).toBe(1)
  })

  it('a done the house could not close (bottles moved) is parked as "count again", never dropped', async () => {
    byType({ [SHELF_DONE_TYPE]: [done('y')] })
    sessionsApi.markCountShelfDone.mockResolvedValue({
      done: false,
      posted: [],
      held: [],
      refused: [{ inventoryId: 'i2', reason: 'moved' }],
      message: 'Count this shelf again: some bottles moved after it was counted.',
    })
    const res = await flushSpotCountOutbox()
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'y',
      expect.objectContaining({
        lastError: 'Count this shelf again: some bottles moved after it was counted.',
        parked: expect.objectContaining({ reason: 'refused', status: 409 }),
      }),
    )
    expect(res.parked).toBe(1)
  })

  it('a parked done keeps the answer: which items to count again and which zeros posted (F-1619)', async () => {
    byType({ [SHELF_DONE_TYPE]: [done('w', { data: { ...done('w').data, body: { clientDoneId: 'd-w', zeroItemIds: ['i1', 'i2'] } } })] })
    sessionsApi.markCountShelfDone.mockResolvedValue({
      done: false,
      posted: ['i1'],
      held: [],
      refused: [{ inventoryId: 'i2', reason: 'moved' }],
      message: 'Count this shelf again: some bottles moved after it was counted.',
    })
    await flushSpotCountOutbox()
    const patch = store.updatePendingMutation.mock.calls[0][1]
    expect(patch.data).toMatchObject({
      sessionId: 'S',
      locationId: 'L',
      body: { clientDoneId: 'd-w', zeroItemIds: ['i1', 'i2'] },
      answer: { posted: ['i1'], held: [], refused: [{ inventoryId: 'i2', reason: 'moved' }] },
    })
  })

  it('a done that fails on the network stays queued and is tried again', async () => {
    byType({ [SHELF_DONE_TYPE]: [done('z')] })
    sessionsApi.markCountShelfDone.mockRejectedValue(httpError(503))
    const res = await flushSpotCountOutbox()
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(res.failed).toBe(1)
  })

  it('does not send a done queued in another house', async () => {
    byType({ [SHELF_DONE_TYPE]: [done('h', { owner: { userId: U1, restaurantId: H2 } })] })
    await flushSpotCountOutbox()
    expect(sessionsApi.markCountShelfDone).not.toHaveBeenCalled()
  })

  it('a parked bottle queued offline is sent with its key and age, once', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await submitParkedLine({
      sessionId: 'S',
      body: { clientLineId: 'p1', locationId: 'L', description: 'Unknown rosé', countedQty: 2 },
    })
    const queued = store.addPendingMutation.mock.calls[0][0]
    expect(queued.type).toBe(PARK_TYPE)

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    byType({ [PARK_TYPE]: [{ ...done('p'), type: PARK_TYPE, data: queued.data }] })
    sessionsApi.parkCountLine.mockResolvedValue({ id: 'r', sessionId: 'S', state: 'parked' })
    await flushSpotCountOutbox()
    expect(sessionsApi.parkCountLine).toHaveBeenCalledWith('S', {
      clientLineId: 'p1',
      locationId: 'L',
      description: 'Unknown rosé',
      countedQty: 2,
      countedAgoMs: expect.any(Number),
    })
    expect(store.removePendingMutation).toHaveBeenCalledWith('p')
  })

  it('a done that closes the shelf clears that shelf\'s earlier "count again", and no other', async () => {
    const refused = { reason: 'refused' as const, status: 409, at: new Date().toISOString() }
    const older = done('old', { parked: refused })
    const otherShelf = done('other', {
      parked: refused,
      data: { ...done('other').data, locationId: 'L2' },
    })
    byType({ [SHELF_DONE_TYPE]: [older, otherShelf, done('new')] })
    sessionsApi.markCountShelfDone.mockResolvedValue({ done: true, posted: [], held: [], refused: [] })
    await flushSpotCountOutbox()
    expect(store.removePendingMutation).toHaveBeenCalledWith('new')
    expect(store.removePendingMutation).toHaveBeenCalledWith('old')
    expect(store.removePendingMutation).not.toHaveBeenCalledWith('other')
  })

  it('a done sent live that closes the shelf clears its earlier "count again" too', async () => {
    byType({
      [SHELF_DONE_TYPE]: [
        done('old', { parked: { reason: 'refused', status: 409, at: new Date().toISOString() } }),
      ],
    })
    sessionsApi.markCountShelfDone.mockResolvedValue({ done: true, posted: [], held: [], refused: [] })
    const out = await submitShelfDone({
      restaurantId: H1,
      sessionId: 'S',
      locationId: 'L',
      shelfLabel: 'Back bar',
      body: { clientDoneId: 'fresh', zeroItemIds: [] },
    })
    expect(out.synced).toBe(true)
    expect(store.removePendingMutation).toHaveBeenCalledWith('old')
  })

  it('a refused done is thrown to the screen, not queued', async () => {
    sessionsApi.markCountShelfDone.mockRejectedValue(httpError(409))
    await expect(
      submitShelfDone({
        sessionId: 'S',
        locationId: 'L',
        shelfLabel: 'Back bar',
        body: { clientDoneId: 'd2', zeroItemIds: [] },
      }),
    ).rejects.toThrow()
    expect(store.addPendingMutation).not.toHaveBeenCalled()
  })
})

describe('F-1678: a pour and a row adjust ride this queue', () => {
  const pourBody = { pours: 1, source: 'manual', reason: 'manual pour', locationId: 'L-bar', idempotencyKey: 'pour:i1:n:h' }
  const adjustBody = { quantityChange: -1, reason: 'Breakage', transactionType: 'waste' as const, idempotencyKey: 'adjust:i1:n:h' }
  const pour = (id: string, at: string) => ({
    ...count(id),
    type: POUR_TYPE,
    data: { itemId: 'i1', itemLabel: 'Yakut', body: pourBody },
    timestamp: new Date(at),
  })

  it('[REVERT-FAILS] a pour with no signal is kept, not sent', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const res = await submitPour({ itemId: 'i1', itemLabel: 'Yakut', body: pourBody })
    expect(res).toEqual({ synced: false })
    expect(recordPour).not.toHaveBeenCalled()
    expect(store.addPendingMutation).toHaveBeenCalledWith(
      expect.objectContaining({ type: POUR_TYPE, data: expect.objectContaining({ body: pourBody }) }),
    )
  })

  it('[REVERT-FAILS] an adjust whose answer never came back, or met a 5xx, is kept with its key', async () => {
    adjustStock.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(httpError(503))
    expect(await submitAdjust({ itemId: 'i1', itemLabel: 'Yakut', body: adjustBody })).toEqual({ synced: false })
    expect(await submitAdjust({ itemId: 'i1', itemLabel: 'Yakut', body: adjustBody })).toEqual({ synced: false })
    expect(store.addPendingMutation).toHaveBeenCalledTimes(2)
    expect(store.addPendingMutation.mock.calls[0][0]).toMatchObject({ type: ADJUST_TYPE, data: { body: adjustBody } })
  })

  it("a refusal is the house's answer: thrown to the screen, not queued", async () => {
    recordPour.mockRejectedValueOnce(httpError(400))
    await expect(submitPour({ itemId: 'i1', itemLabel: 'Yakut', body: pourBody })).rejects.toThrow('HTTP 400')
    expect(store.addPendingMutation).not.toHaveBeenCalled()
  })

  it('[REVERT-FAILS] a queued pour and adjust are sent once, with the key the tap minted', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      pour('p', '2026-10-14T20:00:00.000Z'),
      { ...count('a'), type: ADJUST_TYPE, data: { itemId: 'i1', itemLabel: 'Yakut', body: adjustBody } },
    ])
    recordPour.mockResolvedValue({ pour: {}, item: null })
    adjustStock.mockResolvedValue({})

    const res = await flushSpotCountOutbox()

    expect(recordPour).toHaveBeenCalledWith('i1', pourBody)
    expect(adjustStock).toHaveBeenCalledWith('i1', adjustBody)
    expect(store.removePendingMutation.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'p'])
    expect(res).toEqual({ sent: 2, failed: 0, parked: 0 })
  })

  it('a pour poured before a count is sent before it (tap order)', async () => {
    const order: string[] = []
    store.getPendingMutationsByType.mockResolvedValue([
      { ...count('c'), timestamp: new Date('2026-10-14T21:00:00.000Z') },
      pour('p', '2026-10-14T20:00:00.000Z'),
    ])
    recordSpotCount.mockImplementation(async () => void order.push('count'))
    recordPour.mockImplementation(async () => void order.push('pour'))

    await flushSpotCountOutbox()

    expect(order).toEqual(['pour', 'count'])
  })

  it('parks — never drops — a queued pour the house refuses', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pour('p', '2026-10-14T20:00:00.000Z')])
    recordPour.mockRejectedValue(httpError(422))

    const res = await flushSpotCountOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({ parked: expect.objectContaining({ reason: 'refused', status: 422 }) }),
    )
    expect(res.parked).toBe(1)
  })
})

describe('F-1731: a queued pour or adjust is dated by its tap', () => {
  const pourBody = { pours: 1, source: 'manual', reason: 'manual pour', locationId: 'L-cellar', idempotencyKey: 'pour:i1:n:t' }
  const adjustBody = { quantityChange: -1, reason: 'Breakage', transactionType: 'waste' as const, idempotencyKey: 'adjust:i1:n:t' }

  it('[REVERT-FAILS] stamps the moment of the tap on a pour and an adjust it keeps', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const before = Date.now()

    await submitPour({ itemId: 'i1', itemLabel: 'Yakut', body: pourBody })
    await submitAdjust({ itemId: 'i1', itemLabel: 'Yakut', body: adjustBody })

    for (const [call] of store.addPendingMutation.mock.calls) {
      expect(Date.parse(call.data.tappedAt)).toBeGreaterThanOrEqual(before)
    }
    expect(store.addPendingMutation).toHaveBeenCalledTimes(2)
  })

  it('a pour sent at once carries no age, exactly as before', async () => {
    recordPour.mockResolvedValue({ pour: {}, item: null })
    await submitPour({ itemId: 'i1', itemLabel: 'Yakut', body: pourBody })
    expect(recordPour).toHaveBeenCalledWith('i1', pourBody)
  })

  it('[REVERT-FAILS] a pour tapped at 23:40 and sent 30 minutes later says how old it is', async () => {
    const tappedAt = new Date(Date.now() - 30 * 60_000).toISOString()
    store.getPendingMutationsByType.mockResolvedValue([
      { ...count('p'), type: POUR_TYPE, data: { itemId: 'i1', itemLabel: 'Yakut', body: pourBody, tappedAt } },
      { ...count('a'), type: ADJUST_TYPE, data: { itemId: 'i1', itemLabel: 'Yakut', body: adjustBody, tappedAt } },
    ])
    recordPour.mockResolvedValue({ pour: {}, item: null })
    adjustStock.mockResolvedValue({})

    await flushSpotCountOutbox()

    for (const sent of [recordPour.mock.calls[0][1], adjustStock.mock.calls[0][1]]) {
      expect(sent.idempotencyKey).toMatch(/:t$/)
      expect(sent.occurredAgoMs).toBeGreaterThanOrEqual(30 * 60_000)
      expect(sent.occurredAgoMs).toBeLessThan(31 * 60_000)
    }
  })

  it('parks a pour the house refuses because the shelf was counted after it', async () => {
    const tappedAt = new Date(Date.now() - 30 * 60_000).toISOString()
    store.getPendingMutationsByType.mockResolvedValue([
      { ...count('p'), type: POUR_TYPE, data: { itemId: 'i1', itemLabel: 'Yakut', body: pourBody, tappedAt } },
    ])
    const said = 'This shelf was counted after this pour was made, so the count already has it. It was not applied again.'
    recordPour.mockRejectedValue(
      Object.assign(new Error('HTTP 409'), { response: { status: 409, data: { message: said } } }),
    )

    const res = await flushSpotCountOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({ lastError: said, parked: expect.objectContaining({ status: 409 }) }),
    )
    expect(res.parked).toBe(1)
  })
})
