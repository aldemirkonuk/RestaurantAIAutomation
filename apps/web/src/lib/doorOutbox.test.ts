import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The outbox is the only place in the app that knows the difference between a
 * receipt that was DELIVERED and one it GAVE UP ON — both leave the queue, so
 * downstream every trace of the distinction is a pending count that fell by
 * one. These tests pin `dropped`, the number that carries it out.
 *
 * `failed` deliberately still counts both kinds (a retryable failure did not
 * send either, and two consumers gate on it), so `dropped` is a subset of it,
 * never a replacement.
 */

const recordDoorReceipt = vi.hoisted(() => vi.fn())
vi.mock('../services/api/receiving', () => ({
  receivingApi: { recordDoorReceipt },
}))

const store = vi.hoisted(() => ({
  getPendingMutationsByType: vi.fn(),
  removePendingMutation: vi.fn(),
  updatePendingMutation: vi.fn(),
  addPendingMutation: vi.fn(),
}))
vi.mock('./offline-storage', () => ({ offlineStorage: store }))

import { flushDoorOutbox, watchDoorOutbox, type DoorFlushResult } from './doorOutbox'

const pending = (id: string, retryCount = 0) => ({
  id,
  type: 'receiving.door',
  data: { orderId: `o-${id}`, orderLabel: id, body: {} },
  timestamp: new Date(),
  retryCount,
})

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

/** Written by the flush itself; read here by key so the assertion does not
 *  depend on the reader the same commit added. */
const DROPS_KEY = 'mudavym.door.drops.v1'
const persistedDrops = (): Array<{
  id: string
  orderLabel: string
  droppedAt: string
  reason: string
}> => JSON.parse(window.localStorage.getItem(DROPS_KEY) ?? '[]')

/** Let every queued microtask AND one macrotask turn land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  store.removePendingMutation.mockResolvedValue(undefined)
  store.updatePendingMutation.mockResolvedValue(undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe('flushDoorOutbox — the drop is counted where it happens', () => {
  it('counts a 4xx refusal as dropped, not merely failed', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    const res = await flushDoorOutbox()

    // Deleted from the queue: the pending badge falls by one exactly as it
    // would on a delivery. That is the whole defect.
    expect(store.removePendingMutation).toHaveBeenCalledWith('a')
    expect(res).toEqual({ sent: 0, failed: 1, dropped: 1 })
  })

  it('counts an exhausted retry budget as dropped', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('b', 7)])
    recordDoorReceipt.mockRejectedValue(httpError(500))

    const res = await flushDoorOutbox()

    expect(store.removePendingMutation).toHaveBeenCalledWith('b')
    expect(res).toEqual({ sent: 0, failed: 1, dropped: 1 })
  })

  it('does NOT count a retryable failure as dropped — it is still in the queue', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('c', 1)])
    recordDoorReceipt.mockRejectedValue(httpError(503))

    const res = await flushDoorOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(res).toEqual({ sent: 0, failed: 1, dropped: 0 })
  })

  it('reports a delivery and a drop from the same pass separately', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('d'), pending('e')])
    recordDoorReceipt
      .mockResolvedValueOnce({ alreadyRecorded: false })
      .mockRejectedValueOnce(httpError(400))

    expect(await flushDoorOutbox()).toEqual({ sent: 1, failed: 1, dropped: 1 })
  })

  it('is zero on every axis when offline — nothing was attempted, nothing was lost', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    expect(await flushDoorOutbox()).toEqual({ sent: 0, failed: 0, dropped: 0 })
    expect(store.getPendingMutationsByType).not.toHaveBeenCalled()
  })
})


/**
 * C1. `flushDoorOutbox` used to read the whole pending list before removing
 * anything, with no in-flight guard, while three triggers fire it — mount,
 * 'online' and 'visibilitychange' — and the walk from the dock to the office
 * raises the last two together. Two passes over ONE pending receipt therefore
 * each returned `dropped: 1`, and the screen accumulates that number: the
 * porter was told two deliveries were lost when one was.
 */
describe('flushDoorOutbox — two passes over one receipt are one loss', () => {
  it('joins the pass already running instead of attempting the same receipt twice', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    const [first, second] = await Promise.all([flushDoorOutbox(), flushDoorOutbox()])

    expect(recordDoorReceipt).toHaveBeenCalledTimes(1)
    expect(store.removePendingMutation).toHaveBeenCalledTimes(1)
    // One pass, so one result: there is no second reading to add to the first.
    expect(first).toBe(second)
    expect(first.dropped).toBe(1)
  })

  it('reports one lost receipt ONCE when online and visibilitychange fire together', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    const seen: DoorFlushResult[] = []
    const stop = watchDoorOutbox((r) => seen.push(r))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    stop()

    // The number the screen adds up. Summed across every callback, because
    // that is exactly what the screen does with it.
    expect(seen.reduce((n, r) => n + r.dropped, 0)).toBe(1)
    expect(recordDoorReceipt).toHaveBeenCalledTimes(1)
  })

  it('removes BOTH listeners on cleanup, so an unmounted screen stops flushing', async () => {
    store.getPendingMutationsByType.mockResolvedValue([])
    const stop = watchDoorOutbox()
    await settle()
    stop()
    store.getPendingMutationsByType.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await settle()

    // C3: the visibilitychange handler used to be anonymous and was never
    // removed, so every mount of the door screen left one behind.
    expect(store.getPendingMutationsByType).not.toHaveBeenCalled()
  })
})

/**
 * C2. A drop deletes the queue entry, so before this the only record of a
 * permanent loss was a counter in component state on one phone — gone on the
 * next navigation. The flush writes the loss down itself.
 */
describe('flushDoorOutbox — the drop outlives the screen that saw it', () => {
  it('persists the lost receipt, named, with the reason it was given up on', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    await flushDoorOutbox()

    expect(persistedDrops()).toHaveLength(1)
    expect(persistedDrops()[0]).toMatchObject({
      id: 'a',
      orderLabel: 'a',
      reason: 'refused',
    })
    expect(Number.isNaN(Date.parse(persistedDrops()[0].droppedAt))).toBe(false)
  })

  it('calls an expired session what it is, so the notice can name the right remedy', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(401))

    await flushDoorOutbox()

    // C4: a 401 that survived the api client's refresh-and-retry still deletes
    // the receipt. That is filed, not fixed here — but "sign in again" and
    // "tell a manager" are different instructions and the record says which.
    expect(persistedDrops()[0].reason).toBe('auth')
  })

  it('distinguishes a spent retry budget from a refusal', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('b', 7)])
    recordDoorReceipt.mockRejectedValue(httpError(500))

    await flushDoorOutbox()

    expect(persistedDrops()[0]).toMatchObject({ id: 'b', reason: 'retries' })
  })

  it('records nothing for a retryable failure — that receipt is still in the queue', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('c', 1)])
    recordDoorReceipt.mockRejectedValue(httpError(503))

    await flushDoorOutbox()

    expect(persistedDrops()).toEqual([])
  })

  it('is keyed on the queue id, so seeing the same drop again does not double it', async () => {
    // A store that did not complete the delete hands the same entry back.
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    await flushDoorOutbox()
    await flushDoorOutbox()

    expect(persistedDrops()).toHaveLength(1)
  })
})
