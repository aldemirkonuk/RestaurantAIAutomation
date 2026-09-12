import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The strand, against the REAL `offlineStorage`.
 *
 * Every other door test mocks `./offline-storage` with a store whose
 * `updatePendingMutation` always applies the patch. That mock cannot express
 * the one state that matters here, and 920 green tests never saw it: jsdom has
 * no IndexedDB, so the module takes the localStorage fallback this file's
 * header advertises for "the old iPads a receiving desk actually has" — and on
 * that path a strand's own precondition (`localStorage.setItem` throwing) is
 * ALSO what stops the mark being written. Worse, `localStoragePut` catches the
 * quota error and `console.error`s it, so `updatePendingMutation` resolves
 * having written nothing.
 *
 * Measured before the fix: the flush returned `stranded: 1`, the entry stayed
 * at `retryCount: 0` with no `lastError`, and the reader returned `[]` — the
 * loudest alarm in the app, silent, about a delivery that exists nowhere.
 *
 * So: real storage, no mock but the network.
 */

const recordDoorReceipt = vi.hoisted(() => vi.fn())
vi.mock('../services/api/receiving', () => ({
  receivingApi: { recordDoorReceipt },
}))

import { offlineStorage } from './offline-storage'
import {
  flushDoorOutbox,
  readStrandedDoorReceipts,
  readDroppedDoorReceipts,
} from './doorOutbox'

const RID = 'rest-A'

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

beforeEach(async () => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  // Drain anything a previous test left behind, so the session ledger starts
  // empty — it is module state by design.
  for (const m of await offlineStorage.getPendingMutationsByType('receiving.door'))
    await offlineStorage.removePendingMutation(m.id)
  await readStrandedDoorReceipts(RID)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const queueOne = async (orderLabel = 'PO-1') => {
  await offlineStorage.addPendingMutation({
    type: 'receiving.door',
    data: { orderId: 'o-1', orderLabel, restaurantId: RID, body: {} },
    timestamp: new Date(),
  })
  const [m] = await offlineStorage.getPendingMutationsByType('receiving.door')
  return m
}

describe('a strand survives the disk that caused it', () => {
  it('is visible even though the mark could not be written', async () => {
    const m = await queueOne()
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = jamStorage()
    const pass = await flushDoorOutbox()
    jam.mockRestore()

    expect(pass.stranded).toBe(1)
    expect(pass.dropped).toBe(0)

    // The mark genuinely did NOT land — this is the control, not a hypothesis.
    const [after] = await offlineStorage.getPendingMutationsByType('receiving.door')
    expect(after.id).toBe(m.id)
    expect(after.lastError).toBeUndefined()
    expect(after.retryCount).toBe(0)

    // And the alarm is still raised.
    expect(await readStrandedDoorReceipts(RID)).toMatchObject([
      { id: m.id, orderLabel: 'PO-1' },
    ])
  })

  it('is still one strand after three passes', async () => {
    await queueOne()
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = jamStorage()
    const passes = [await flushDoorOutbox(), await flushDoorOutbox(), await flushDoorOutbox()]
    jam.mockRestore()

    expect(passes.map((p) => p.stranded)).toEqual([1, 1, 1])
    expect(await readStrandedDoorReceipts(RID)).toHaveLength(1)
  })

  it('stops alarming once the disk recovers and the drop is recorded', async () => {
    await queueOne('PO-2')
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()
    expect(await readStrandedDoorReceipts(RID)).toHaveLength(1)

    await flushDoorOutbox()

    expect(await readStrandedDoorReceipts(RID)).toEqual([])
    expect(readDroppedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-2' }])
  })

  it('is not also a drop, for a mark that outlived the session that made it', async () => {
    // The reload case: the mark DID land before the page was closed, so the
    // in-memory ledger is empty and only the mark identifies the strand. A
    // later pass then records the drop — and its delete fails, leaving a
    // marked entry and a drop record for one receipt. Without the read
    // excluding recorded ids, the porter sees both alarms for one delivery.
    await queueOne('PO-4')
    const [seeded] = await offlineStorage.getPendingMutationsByType('receiving.door')
    await offlineStorage.updatePendingMutation(seeded.id, {
      retryCount: 8,
      lastError:
        'Given up on, and this device could not save a record of it. Kept here so the delivery is not lost — keep the paperwork.',
    })
    expect(await readStrandedDoorReceipts(RID)).toHaveLength(1)

    recordDoorReceipt.mockRejectedValue(httpError(422))
    const remove = vi
      .spyOn(offlineStorage, 'removePendingMutation')
      .mockRejectedValue(new Error('delete failed'))
    const pass = await flushDoorOutbox()
    remove.mockRestore()

    expect(pass.dropped).toBe(1)
    expect(readDroppedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-4' }])
    expect(await readStrandedDoorReceipts(RID)).toEqual([])
  })

  it('never calls a delivery the server accepted a lost one', async () => {
    await queueOne('PO-3')
    recordDoorReceipt.mockRejectedValueOnce(httpError(500))

    // Strand it first: a 500 at the attempt ceiling with the disk refusing.
    const [m] = await offlineStorage.getPendingMutationsByType('receiving.door')
    await offlineStorage.updatePendingMutation(m.id, { retryCount: 7 })
    const jam = jamStorage()
    const first = await flushDoorOutbox()
    jam.mockRestore()
    expect(first.stranded).toBe(1)

    // Now the network returns and the server takes it, but the delete fails.
    recordDoorReceipt.mockResolvedValue({ alreadyRecorded: false })
    const remove = vi
      .spyOn(offlineStorage, 'removePendingMutation')
      .mockRejectedValue(new Error('delete failed'))
    const second = await flushDoorOutbox()
    remove.mockRestore()

    expect(second.sent).toBe(1)
    expect(await readStrandedDoorReceipts(RID)).toEqual([])
  })
})
