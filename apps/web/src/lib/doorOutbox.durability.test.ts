import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * THE ONE PROPERTY: a door receipt is never destroyed.
 *
 * This file mocks NOTHING but the network. That is the whole point. Every other
 * door test replaces `./offline-storage` with a store that always applies the
 * patch, and that mock cannot express the state this feature exists for —
 * storage REFUSING a write. It is why 920 green tests once passed over an alarm
 * that had gone silent.
 *
 * jsdom has no IndexedDB, so the real module takes the localStorage fallback
 * its own header advertises for "the old iPads a receiving desk actually has".
 * That is the device this is about.
 *
 * What is NOT tested here, because it deliberately no longer exists: any
 * durable, screen-facing claim that a receipt was given up on without a record.
 * See ADR 0139.
 */

const recordDoorReceipt = vi.hoisted(() => vi.fn())
vi.mock('../services/api/receiving', () => ({
  receivingApi: { recordDoorReceipt },
}))

import { offlineStorage } from './offline-storage'
import { flushDoorOutbox, readDroppedDoorReceipts, pendingDoorCount } from './doorOutbox'

const RID = 'rest-A'
const TYPE = 'receiving.door'

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

/** Refuse every write, the way a full disk does. Spied on the INSTANCE: a
 *  prototype spy never reaches `window.localStorage` in this jsdom. */
const jamStorage = () =>
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
    const e = new Error('The quota has been exceeded.')
    e.name = 'QuotaExceededError'
    throw e
  })

const queueOne = async (orderLabel: string, restaurantId = RID) => {
  await offlineStorage.addPendingMutation({
    type: TYPE,
    data: { orderId: `o-${orderLabel}`, orderLabel, restaurantId, body: {} },
    timestamp: new Date(),
  })
  const all = await offlineStorage.getPendingMutationsByType(TYPE)
  const m = all.find(
    (x) => (x.data as { orderLabel?: string } | undefined)?.orderLabel === orderLabel,
  )
  if (!m) throw new Error(`queueOne: ${orderLabel} did not reach the queue`)
  return m
}

beforeEach(async () => {
  vi.clearAllMocks()
  for (const m of await offlineStorage.getPendingMutationsByType(TYPE))
    await offlineStorage.removePendingMutation(m.id)
  window.localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe('a receipt whose loss cannot be recorded is KEPT, not destroyed', () => {
  it('keeps the queue entry when the drop record cannot be written', async () => {
    const m = await queueOne('PO-1')
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = jamStorage()
    const pass = await flushDoorOutbox()
    jam.mockRestore()

    // Nothing claims it was recorded...
    expect(pass.dropped).toBe(0)
    expect(pass.stranded).toBe(1)
    expect(pass.failed).toBe(1)
    expect(readDroppedDoorReceipts(RID)).toEqual([])
    // ...and the delivery still exists, which is the property that matters.
    const still = await offlineStorage.getPendingMutationsByType(TYPE)
    expect(still.map((x) => x.id)).toEqual([m.id])
    expect(await pendingDoorCount()).toBe(1)
  })

  it('records the loss, and only then deletes it, once storage recovers', async () => {
    await queueOne('PO-2')
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()
    expect(await pendingDoorCount()).toBe(1)

    await flushDoorOutbox()

    expect(readDroppedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-2' }])
    expect(await pendingDoorCount()).toBe(0)
  })

  it('still delivers a kept receipt when the network comes back', async () => {
    await queueOne('PO-3')
    recordDoorReceipt.mockRejectedValue(httpError(503))

    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()

    recordDoorReceipt.mockResolvedValue({ alreadyRecorded: false })
    const recovery = await flushDoorOutbox()

    // Delivered under its ORIGINAL idempotency key — never re-entered by hand,
    // which is what a false "we gave up on this" record would have caused.
    expect(recovery.sent).toBe(1)
    expect(readDroppedDoorReceipts(RID)).toEqual([])
    expect(await pendingDoorCount()).toBe(0)
  })

  it('never writes a loss record for a receipt that is merely unreadable', async () => {
    await queueOne('PO-4')
    // A read blip: `getPendingMutationsByType` cannot report failure — it
    // returns `[]` — so nothing may conclude the queue is empty from one.
    const blind = vi.spyOn(offlineStorage, 'getPendingMutationsByType').mockResolvedValue([])
    const blip = await flushDoorOutbox()
    blind.mockRestore()

    expect(blip).toMatchObject({ sent: 0, failed: 0, dropped: 0, stranded: 0 })
    expect(readDroppedDoorReceipts(RID)).toEqual([])
    expect(await pendingDoorCount()).toBe(1)
  })

  it('reports the pass honestly and claims nothing beyond it', async () => {
    await queueOne('PO-5')
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = jamStorage()
    const first = await flushDoorOutbox()
    const second = await flushDoorOutbox()
    jam.mockRestore()

    // Each pass says what IT did. Neither claims a running total, and the
    // module exposes no reader that would let a screen build one — that is the
    // mechanism ADR 0139 withdrew, five defects deep.
    expect(first.stranded).toBe(1)
    expect(second.stranded).toBe(1)
    const api = await import('./doorOutbox')
    expect(Object.keys(api)).not.toContain('readStrandedDoorReceipts')
  })

  it('does not leak one house\'s lost receipt to another', async () => {
    await queueOne('PO-B', 'rest-B')
    recordDoorReceipt.mockRejectedValue(httpError(422))
    await flushDoorOutbox()

    expect(readDroppedDoorReceipts('rest-A')).toEqual([])
    expect(readDroppedDoorReceipts('rest-B')).toMatchObject([{ orderLabel: 'PO-B' }])
  })
})
