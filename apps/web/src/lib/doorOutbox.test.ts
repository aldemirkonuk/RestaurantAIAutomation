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

import { flushDoorOutbox } from './doorOutbox'

const pending = (id: string, retryCount = 0) => ({
  id,
  type: 'receiving.door',
  data: { orderId: `o-${id}`, orderLabel: id, body: {} },
  timestamp: new Date(),
  retryCount,
})

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

beforeEach(() => {
  vi.clearAllMocks()
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
