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
  // The strand ledger is module state that ONLY an observed resolve empties —
  // that is the property these tests exist to protect, so it is not reached
  // around here either. Deliver whatever the last test left queued: the pass
  // walks it, the server takes it, and the ledger clears exactly as it does in
  // production. (A test that ORPHANS a strand — removes its entry behind the
  // module's back — therefore cannot be cleaned up this way, and lives in its
  // own file, where the module registry gives it a fresh ledger.)
  recordDoorReceipt.mockResolvedValue({ alreadyRecorded: false })
  await flushDoorOutbox()
  expect(await readStrandedDoorReceipts(RID)).toEqual([])
  for (const m of await offlineStorage.getPendingMutationsByType('receiving.door'))
    await offlineStorage.removePendingMutation(m.id)
  window.localStorage.clear()
  recordDoorReceipt.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Queue one receipt and return the entry that was actually just added.
 *
 * By label, not by `[0]`: the queue is real storage and its order is not
 * guaranteed, so indexing into it made these tests depend on each other — one
 * run in three failed under `--sequence.shuffle.tests`, which is exactly the
 * order dependence the shuffle exists to find.
 */
const queueOne = async (orderLabel = 'PO-1') => {
  await offlineStorage.addPendingMutation({
    type: 'receiving.door',
    data: { orderId: 'o-1', orderLabel, restaurantId: RID, body: {} },
    timestamp: new Date(),
  })
  const all = await offlineStorage.getPendingMutationsByType('receiving.door')
  const m = all.find(
    (x) => (x.data as { orderLabel?: string } | undefined)?.orderLabel === orderLabel,
  )
  if (!m) throw new Error(`queueOne: ${orderLabel} did not reach the queue`)
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
    const seeded = await queueOne('PO-4')
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
    const m = await queueOne('PO-3')
    recordDoorReceipt.mockRejectedValueOnce(httpError(500))

    // Strand it first: a 500 at the attempt ceiling with the disk refusing.
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
    const m = await queueOne(orderLabel)
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
 * A queue read that came back empty proves nothing.
 *
 * An earlier version converted an apparently-orphaned strand into a dismissible
 * drop record. It was WITHDRAWN: the only way to know an entry is gone is a
 * queue read, and that read cannot report failure, so one IndexedDB blip
 * recorded a permanent loss for a receipt that was still queued — and which
 * then delivered. This pins the withdrawal.
 */
describe('a queue read that came back empty is not evidence of anything', () => {
  it('does not record a loss for a receipt that is merely unreadable this pass', async () => {
    await queueOne('PO-8')
    recordDoorReceipt.mockRejectedValue(httpError(400))
    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()
    expect(await readStrandedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-8' }])

    // One blip: the queue reads as empty although the receipt is still in it.
    const blind = vi.spyOn(offlineStorage, 'getPendingMutationsByType').mockResolvedValue([])
    const blip = await flushDoorOutbox()
    blind.mockRestore()

    // Nothing was recorded as lost, and nothing was reported as resolved.
    expect(readDroppedDoorReceipts(RID)).toEqual([])
    expect(blip.dropped).toBe(0)
    // The receipt is still queued, and still shouting.
    const still = await offlineStorage.getPendingMutationsByType('receiving.door')
    expect(still).toHaveLength(1)
    expect(await readStrandedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-8' }])

    // And it can still be delivered, under its original idempotency key.
    recordDoorReceipt.mockResolvedValue({ alreadyRecorded: false })
    const recovery = await flushDoorOutbox()
    expect(recovery.sent).toBe(1)
    expect(readDroppedDoorReceipts(RID)).toEqual([])
    expect(await readStrandedDoorReceipts(RID)).toEqual([])
  })

})

/**
 * Scoping. The banners are label-free, so a count crossing houses costs no
 * order name — but a strand hidden from the house it belongs to costs the
 * delivery, which is the asymmetry these two encode.
 */
describe('a strand belongs to a house, and an unstamped one belongs to all of them', () => {
  const queueFor = async (restaurantId: string, orderLabel: string) => {
    await offlineStorage.addPendingMutation({
      type: 'receiving.door',
      data: { orderId: `o-${orderLabel}`, orderLabel, restaurantId, body: {} },
      timestamp: new Date(),
    })
  }

  it('does not report another house\'s strand', async () => {
    await queueFor('rest-B', 'PO-B')
    recordDoorReceipt.mockRejectedValue(httpError(400))
    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()

    expect(await readStrandedDoorReceipts('rest-A')).toEqual([])
    expect(await readStrandedDoorReceipts('rest-B')).toMatchObject([{ orderLabel: 'PO-B' }])
  })

  it('reports an unstamped strand to every house rather than hiding it', async () => {
    await queueFor('', 'PO-U')
    recordDoorReceipt.mockRejectedValue(httpError(400))
    const jam = jamStorage()
    await flushDoorOutbox()
    jam.mockRestore()

    expect(await readStrandedDoorReceipts('rest-A')).toHaveLength(1)
    expect(await readStrandedDoorReceipts('rest-B')).toHaveLength(1)
  })

  it('says nothing rather than all-clear when the queue read REJECTS', async () => {
    const blind = vi
      .spyOn(offlineStorage, 'getPendingMutationsByType')
      .mockRejectedValue(new Error('IndexedDB unavailable'))
    const answer = await readStrandedDoorReceipts('rest-A')
    blind.mockRestore()
    // `null`, not `[]`. Both screens keep what they last knew on a null.
    expect(answer).toBeNull()
  })
})
