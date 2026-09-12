import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The orphan, in its own file on purpose.
 *
 * A strand whose queue entry disappeared without the outbox seeing it go —
 * `sync-manager` clears the whole pending queue (its own entry in
 * `v3.0-TECH-DEBT.md`), and a person can clear site data. The outbox's strand
 * ledger is module state that only an OBSERVED resolve empties, so an orphan
 * cannot be cleaned up by anything a sibling test could do; vitest gives each
 * FILE its own module registry, and that is the isolation this needs.
 *
 * What it pins: the orphan keeps shouting. Saying nothing about a delivery that
 * is gone is the one outcome this whole module exists to prevent, and the
 * alternative — quietly converting it into a "we gave up on this" record — was
 * measured writing that record for receipts that were still queued and still
 * deliverable, so it was withdrawn.
 */

const recordDoorReceipt = vi.hoisted(() => vi.fn())
vi.mock('../services/api/receiving', () => ({
  receivingApi: { recordDoorReceipt },
}))

import { offlineStorage } from './offline-storage'
import { flushDoorOutbox, readStrandedDoorReceipts, readDroppedDoorReceipts } from './doorOutbox'

const RID = 'rest-A'
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

describe('a strand whose queue entry vanished keeps shouting', () => {
  it('is still named after the queue is cleared from outside this module', async () => {
    await offlineStorage.addPendingMutation({
      type: 'receiving.door',
      data: { orderId: 'o-9', orderLabel: 'PO-9', restaurantId: RID, body: {} },
      timestamp: new Date(),
    })
    recordDoorReceipt.mockRejectedValue(httpError(400))

    const jam = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      const e = new Error('The quota has been exceeded.')
      e.name = 'QuotaExceededError'
      throw e
    })
    const strandPass = await flushDoorOutbox()
    jam.mockRestore()
    expect(strandPass.stranded).toBe(1)

    // Cleared from outside — nothing here observed the receipt resolve.
    for (const m of await offlineStorage.getPendingMutationsByType('receiving.door'))
      await offlineStorage.removePendingMutation(m.id)
    expect(await offlineStorage.getPendingMutationsByType('receiving.door')).toEqual([])

    await flushDoorOutbox()

    // Named, not merely counted, and not quietly rewritten into a drop record.
    expect(await readStrandedDoorReceipts(RID)).toMatchObject([{ orderLabel: 'PO-9' }])
    expect(readDroppedDoorReceipts(RID)).toEqual([])
  })
})
