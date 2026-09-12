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
  dismissDroppedDoorReceipt,
  flushDoorOutbox,
  readStrandedDoorReceipts,
  readDroppedDoorReceipts,
} from './doorOutbox'

/** What the flush parks on an entry it gave up on and could not record. */
const MARK =
  'Given up on, and this device could not save a record of it. Kept here so the delivery is not lost — keep the paperwork.'

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
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  // The outbox's strand ledger is module state that only an OBSERVED resolve
  // empties — that is the property these tests exist to protect, so it cannot
  // be reached around here either. Drain the queue, then run one working pass:
  // storage is healthy, so the pass settles every orphan into a drop record and
  // the ledger empties exactly as it does in production. Then wipe the records.
  for (const m of await offlineStorage.getPendingMutationsByType('receiving.door'))
    await offlineStorage.removePendingMutation(m.id)
  await flushDoorOutbox()
  expect(await readStrandedDoorReceipts(RID)).toEqual([])
  window.localStorage.clear()
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
      lastError: MARK,
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

/**
 * The states where the strand must STOP, and the one where it must not.
 *
 * Round 5 matched the attempt ceiling as a strand in its own right. The only
 * writer of that ceiling is the strand branch — which writes the mark in the
 * same patch — so the ceiling covered nothing the mark missed, and its one
 * distinct effect was to survive every attempt to clear the strand. A delivery
 * the server had ACCEPTED then raised the app's loudest, undismissable alert,
 * forever. These pin the clearing, which is the half a strand test does not
 * naturally reach.
 */
describe('a strand stops when the receipt stops being lost', () => {
  /** Park an entry exactly as the strand branch does when the mark DOES land. */
  const seedMarkedStrand = async (orderLabel = 'PO-M') => {
    await queueOne(orderLabel)
    const [m] = await offlineStorage.getPendingMutationsByType('receiving.door')
    await offlineStorage.updatePendingMutation(m.id, { retryCount: 8, lastError: MARK })
    expect(await readStrandedDoorReceipts(RID)).toHaveLength(1)
    return m.id
  }

  it('clears when the server accepts it, even though the delete failed', async () => {
    await seedMarkedStrand('PO-5')
    recordDoorReceipt.mockResolvedValue({ alreadyRecorded: false })
    const remove = vi
      .spyOn(offlineStorage, 'removePendingMutation')
      .mockRejectedValue(new Error('delete failed'))
    const pass = await flushDoorOutbox()
    remove.mockRestore()

    expect(pass.sent).toBe(1)
    expect(await readStrandedDoorReceipts(RID)).toEqual([])
    // And it stays cleared: the entry is still queued, so a later read sees it.
    const [after] = await offlineStorage.getPendingMutationsByType('receiving.door')
    expect(after?.retryCount).toBe(0)
    expect(after?.lastError).toBeUndefined()
    expect(await readStrandedDoorReceipts(RID)).toEqual([])
  })

  it('does not come back when the porter dismisses the drop pin', async () => {
    const id = await seedMarkedStrand('PO-6')
    recordDoorReceipt.mockRejectedValue(httpError(422))
    const remove = vi
      .spyOn(offlineStorage, 'removePendingMutation')
      .mockRejectedValue(new Error('delete failed'))
    await flushDoorOutbox()
    remove.mockRestore()

    // One loss, one pin, and the pin is the dismissible one.
    expect(readDroppedDoorReceipts(RID)).toMatchObject([{ id, orderLabel: 'PO-6' }])
    expect(await readStrandedDoorReceipts(RID)).toEqual([])

    // The porter acknowledges it — RcOutboxRail's Dismiss button. Acknowledging
    // a loss must not uncover a louder, undismissable version of the same loss.
    dismissDroppedDoorReceipt(RID, id)
    expect(await readStrandedDoorReceipts(RID)).toEqual([])
  })
})

/**
 * The queue read that cannot fail.
 *
 * `getPendingMutationsByType` never rejects: `idbGetAll` catches every
 * IndexedDB error and falls through to `localStorageGetAll`, which catches its
 * own and returns `[]`. So "unreadable" and "empty" arrive identically, and
 * anything that treats the read as authoritative treats a broken disk as an
 * all-clear — which is this repo's named fault and was round 4's defect.
 */
describe('an unreadable queue never becomes an all-clear', () => {
  it('keeps reporting a mark-less strand when the queue reads as empty', async () => {
    await queueOne('PO-7')
    recordDoorReceipt.mockRejectedValue(httpError(400))
    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()
    expect(await readStrandedDoorReceipts(RID)).toHaveLength(1)

    // The store goes unreadable. Measured behaviour, not hypothesis: the read
    // comes back `[]`, not a rejection.
    const blind = vi.spyOn(offlineStorage, 'getPendingMutationsByType').mockResolvedValue([])
    const duringOutage = await readStrandedDoorReceipts(RID)
    blind.mockRestore()

    expect(duringOutage).toMatchObject([{ orderLabel: 'PO-7' }])
    // And it is still there once the store answers again.
    expect(await readStrandedDoorReceipts(RID)).toHaveLength(1)
  })
})

/**
 * The orphan: a strand whose queue entry is gone without this module seeing it
 * go. `sync-manager` clears the whole pending queue (its own register entry —
 * "SyncManager silently deletes every queued door receipt"), and a person can
 * clear site data.
 *
 * The strand alarm is undismissable on purpose, so an orphan that can never
 * resolve is a permanent alert on a shared dock tablet — which is exactly how a
 * real alarm gets trained out of the people it is for. It resolves by BECOMING
 * a drop: the receipt was given up on, so that is the correct record, and it is
 * one the porter can acknowledge. The only reason it was not written at the
 * time is that storage refused, and storage recovers.
 */
describe('a strand that can never resolve becomes one the porter can acknowledge', () => {
  it('settles an orphaned strand into a dismissible drop once storage recovers', async () => {
    await queueOne('PO-8')
    recordDoorReceipt.mockRejectedValue(httpError(400))
    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()
    expect(await readStrandedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-8' }])
    expect(readDroppedDoorReceipts(RID)).toEqual([])

    // The queue is emptied from outside this module — nothing here observed it.
    for (const m of await offlineStorage.getPendingMutationsByType('receiving.door'))
      await offlineStorage.removePendingMutation(m.id)

    await flushDoorOutbox()

    expect(await readStrandedDoorReceipts(RID)).toEqual([])
    // Not forgotten — converted. Named, and dismissible.
    const drops = readDroppedDoorReceipts(RID)
    expect(drops).toMatchObject([{ orderLabel: 'PO-8' }])
    dismissDroppedDoorReceipt(RID, drops[0].id)
    expect(readDroppedDoorReceipts(RID)).toEqual([])
  })

  it('keeps the alarm while storage is still refusing to record it', async () => {
    await queueOne('PO-9')
    recordDoorReceipt.mockRejectedValue(httpError(400))
    let jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()
    for (const m of await offlineStorage.getPendingMutationsByType('receiving.door'))
      await offlineStorage.removePendingMutation(m.id)

    jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()

    // The record still could not be written, so it is still a strand — the one
    // outcome that is never allowed is the screen going quiet about it.
    expect(await readStrandedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-9' }])
  })
})
