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
 * Since the ADR 0241 amendment (2026-09-29) a receipt the server refuses for
 * good is PARKED as "Not sent" in the queue, never deleted — so this file now
 * pins that the refusal keeps it, and that a park write storage refuses keeps
 * it too.
 *
 * What is NOT tested here, because it deliberately no longer exists: any
 * durable, screen-facing claim that a receipt was given up on without a record.
 * See ADR 0140.
 */

const recordDoorReceipt = vi.hoisted(() => vi.fn())
vi.mock('../services/api/receiving', () => ({
  receivingApi: { recordDoorReceipt },
}))

import { offlineStorage } from './offline-storage'
import {
  flushDoorOutbox,
  notSentDoorCount,
  pendingDoorCount,
  readDroppedDoorReceipts,
  resendDoorReceipt,
} from './doorOutbox'

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
  // The queue is read only by the person and house that wrote it (ADR 0241,
  // OD-203): these receipts are queued and flushed by one porter in rest-A.
  window.localStorage.setItem(
    'accessToken',
    `h.${btoa(JSON.stringify({ sub: 'porter-1', restaurantId: RID }))}.s`,
  )
  window.localStorage.setItem('activeRestaurantId', RID)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

const signInAt = (restaurantId: string) => {
  window.localStorage.setItem(
    'accessToken',
    `h.${btoa(JSON.stringify({ sub: 'porter-1', restaurantId }))}.s`,
  )
  window.localStorage.setItem('activeRestaurantId', restaurantId)
}

describe('a refused receipt is PARKED, kept on the phone, never destroyed', () => {
  it('parks a refused receipt as Not sent and keeps it in the queue', async () => {
    const m = await queueOne('PO-1')
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const pass = await flushDoorOutbox()

    expect(pass).toMatchObject({ sent: 0, failed: 0, parked: 1 })
    const still = await offlineStorage.getPendingMutationsByType(TYPE)
    expect(still.map((x) => x.id)).toEqual([m.id])
    expect(still[0].parked).toMatchObject({ reason: 'refused', status: 400 })
    // Not waiting (nothing will send it on its own) — but not gone either.
    expect(await pendingDoorCount()).toBe(0)
    expect(await notSentDoorCount()).toBe(1)
    // And no drop record: nothing was dropped.
    expect(readDroppedDoorReceipts(RID)).toEqual([])
  })

  it('keeps the receipt when storage refuses the park write, and parks it once storage recovers', async () => {
    const m = await queueOne('PO-2')
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = jamStorage()
    const first = await flushDoorOutbox()
    jam.mockRestore()

    // Whatever the pass could claim, the delivery still exists.
    expect(first.sent).toBe(0)
    expect(first.failed + first.parked).toBe(1)
    expect((await offlineStorage.getPendingMutationsByType(TYPE)).map((x) => x.id)).toEqual([m.id])

    await flushDoorOutbox()

    const still = await offlineStorage.getPendingMutationsByType(TYPE)
    expect(still.map((x) => x.id)).toEqual([m.id])
    expect(still[0].parked).toMatchObject({ reason: 'refused' })
    expect(readDroppedDoorReceipts(RID)).toEqual([])
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

    expect(blip).toMatchObject({ sent: 0, failed: 0, parked: 0 })
    expect(readDroppedDoorReceipts(RID)).toEqual([])
    expect(await pendingDoorCount()).toBe(1)
  })

  it('reports the pass honestly: a parked receipt is not re-sent or re-counted by the next pass', async () => {
    await queueOne('PO-5')
    recordDoorReceipt.mockRejectedValue(httpError(422))

    const first = await flushDoorOutbox()
    const second = await flushDoorOutbox()

    expect(first.parked).toBe(1)
    expect(second.parked).toBe(0)
    expect(recordDoorReceipt).toHaveBeenCalledTimes(1)
    const api = await import('./doorOutbox')
    expect(Object.keys(api)).not.toContain('readStrandedDoorReceipts')
  })

  it("does not show one house's parked receipt to another", async () => {
    await queueOne('PO-A')
    recordDoorReceipt.mockRejectedValue(httpError(404))
    await flushDoorOutbox()

    signInAt('rest-B')
    expect(await notSentDoorCount()).toBe(0)
    signInAt(RID)
    expect(await notSentDoorCount()).toBe(1)
  })

  it('Send again delivers it once the server will take it', async () => {
    const m = await queueOne('PO-6')
    recordDoorReceipt.mockRejectedValueOnce(httpError(409))
    await flushDoorOutbox()
    expect(await notSentDoorCount()).toBe(1)

    recordDoorReceipt.mockResolvedValue({ alreadyRecorded: false })
    expect(await resendDoorReceipt(m.id)).toBe(true)

    expect(await notSentDoorCount()).toBe(0)
    expect(await pendingDoorCount()).toBe(0)
  })
})
