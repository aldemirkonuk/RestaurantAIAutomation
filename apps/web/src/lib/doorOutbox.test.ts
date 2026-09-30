import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A door receipt the server refuses for good is PARKED as "Not sent", never
 * dropped (ADR 0241 amendment, 2026-09-29 — the founder: "option 1, not
 * sent."). It stays in the queue, is counted in `parked` (not `failed`), and
 * leaves only when a person discards it. These tests pin that, and that a
 * transient failure — a 401 included — is kept unparked and retried.
 *
 * Before the amendment a refusal deleted the entry and wrote ADR 0140's drop
 * record instead; the tests that pinned that (`dropped`, `stranded`) describe
 * superseded behaviour and were rewritten here, not deleted: each property
 * they guarded — nothing counted twice, nothing leaked across houses, nothing
 * destroyed when storage refuses a write — is still asserted, against parking.
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

import {
  clearDroppedDoorReceipts,
  discardDoorReceipt,
  dismissDroppedDoorReceipt,
  flushDoorOutbox,
  notSentDoorCount,
  pendingDoorCount,
  readDroppedDoorReceipts,
  resendDoorReceipt,
  watchDoorOutbox,
  type DoorFlushResult,
} from './doorOutbox'

/** Entries are stamped with the house that took the delivery (see H1 below). */
const RID = 'rest-A'
const pending = (id: string, retryCount = 0) => ({
  id,
  type: 'receiving.door',
  data: { orderId: `o-${id}`, orderLabel: id, restaurantId: RID, body: {} },
  timestamp: new Date(),
  retryCount,
})

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

/** Written by the flush itself; read here by key so the assertion does not
 *  depend on the reader the same commit added. Per restaurant — one global key
 *  showed one house's order label to the next house the tablet switched to. */
const DROPS_KEY = `mudavym.receiving.outboxDrops.${RID}`
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
  // A porter signed in to rest-A: since ADR 0241 (OD-203) a receipt is sent
  // only by a session of the house it names.
  window.localStorage.setItem(
    'accessToken',
    `h.${btoa(JSON.stringify({ sub: 'porter-1', restaurantId: RID }))}.s`,
  )
  window.localStorage.setItem('activeRestaurantId', RID)
  store.removePendingMutation.mockResolvedValue(undefined)
  store.updatePendingMutation.mockResolvedValue(undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

const parkedWith = (status: number) =>
  expect.objectContaining({
    lastError: `HTTP ${status}`,
    parked: expect.objectContaining({ reason: 'refused', status }),
  })

describe('flushDoorOutbox — a refused receipt is parked as Not sent, never dropped', () => {
  it.each([403, 404, 422, 400])('parks a %i and never deletes it', async (status) => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(status))

    const res = await flushDoorOutbox()

    // Kept: the queue is the only copy of the count.
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith('a', parkedWith(status))
    // Counted as parked, not as a failure that will be retried.
    expect(res).toEqual({ sent: 0, failed: 0, parked: 1, unreachable: false })
    // And no ADR 0140 drop record is written for it any more.
    expect(persistedDrops()).toEqual([])
  })

  it('never gives up on a transient failure, however many came before (ADR 0241)', async () => {
    // Before ADR 0241 the eighth attempt dropped this receipt.
    store.getPendingMutationsByType.mockResolvedValue([pending('b', 7)])
    recordDoorReceipt.mockRejectedValue(httpError(500))

    const res = await flushDoorOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ retryCount: 8 }),
    )
    expect(res).toEqual({ sent: 0, failed: 1, parked: 0, unreachable: false })
  })

  it('keeps a 401 queued and UNPARKED — the session ended; it goes after the same person signs in', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(401))

    const res = await flushDoorOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ retryCount: 1 }),
    )
    expect(store.updatePendingMutation).not.toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ parked: expect.anything() }),
    )
    expect(res).toEqual({ sent: 0, failed: 1, parked: 0, unreachable: false })
    expect(persistedDrops()).toEqual([])
  })

  it('reports a delivery and a park from the same pass separately', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('d'), pending('e')])
    recordDoorReceipt
      .mockResolvedValueOnce({ alreadyRecorded: false })
      .mockRejectedValueOnce(httpError(400))

    expect(await flushDoorOutbox()).toEqual({ sent: 1, failed: 0, parked: 1, unreachable: false })
    expect(store.removePendingMutation).toHaveBeenCalledTimes(1)
    expect(store.removePendingMutation).toHaveBeenCalledWith('d')
  })

  it('never sends a parked receipt on its own — it waits for Send again', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      { ...pending('p'), parked: { reason: 'refused', status: 422, at: '2026-09-29T00:00:00.000Z' } },
    ])

    const res = await flushDoorOutbox()

    expect(recordDoorReceipt).not.toHaveBeenCalled()
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(res).toEqual({ sent: 0, failed: 0, parked: 0, unreachable: false })
  })

  it('is zero on every axis when offline — nothing was attempted, nothing was lost', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    expect(await flushDoorOutbox()).toEqual({ sent: 0, failed: 0, parked: 0, unreachable: false })
    expect(store.getPendingMutationsByType).not.toHaveBeenCalled()
  })
})

/**
 * C1. `flushDoorOutbox` used to read the whole pending list before touching
 * anything, with no in-flight guard, while three triggers fire it — mount,
 * 'online' and 'visibilitychange' — and the walk from the dock to the office
 * raises the last two together. Two passes over ONE pending receipt therefore
 * each reported it, and the porter was told two when there was one.
 */
describe('flushDoorOutbox — two passes over one receipt are one refusal', () => {
  it('joins the pass already running instead of attempting the same receipt twice', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    const [first, second] = await Promise.all([flushDoorOutbox(), flushDoorOutbox()])

    expect(recordDoorReceipt).toHaveBeenCalledTimes(1)
    expect(store.updatePendingMutation).toHaveBeenCalledTimes(1)
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    // One pass, so one result: there is no second reading to add to the first.
    expect(first).toBe(second)
    expect(first.parked).toBe(1)
  })

  it('reports one refused receipt ONCE when online and visibilitychange fire together', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    const seen: DoorFlushResult[] = []
    const stop = watchDoorOutbox((r) => seen.push(r))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    stop()

    expect(seen.reduce((n, r) => n + r.parked, 0)).toBe(1)
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
 * C2 as it stands after the amendment. The drop record survived the screen
 * that saw it; it is now READ-ONLY — the flush writes none — while the records
 * already on devices are still read, scoped by house, and adopted from the
 * legacy keys (H1 below).
 */
describe('flushDoorOutbox — writes no drop record any more', () => {
  it('writes nothing for a refusal, a 403 included (it is parked instead)', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a'), pending('b')])
    recordDoorReceipt.mockRejectedValueOnce(httpError(422)).mockRejectedValueOnce(httpError(403))

    await flushDoorOutbox()

    expect(persistedDrops()).toEqual([])
    expect(window.localStorage.getItem('mudavym.receiving.outboxDrops')).toBeNull()
    expect(window.localStorage.getItem('mudavym.door.drops.v1')).toBeNull()
    expect(store.updatePendingMutation).toHaveBeenCalledWith('b', parkedWith(403))
  })

  it('records nothing for a retryable failure — that receipt is still in the queue', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('c', 1)])
    recordDoorReceipt.mockRejectedValue(httpError(503))

    await flushDoorOutbox()

    expect(persistedDrops()).toEqual([])
  })
})

/* ═════════════════════════════════ round 3 — what the durability fix broke ══ */

/** A queue entry stamped with the house that took the delivery. */
const pendingAt = (
  id: string,
  restaurantId: string,
  retryCount = 0,
  orderLabel = id,
) => ({
  id,
  type: 'receiving.door',
  data: { orderId: `o-${id}`, orderLabel, restaurantId, body: {} },
  timestamp: new Date(),
  retryCount,
})

const SCOPED = (rid: string) => `mudavym.receiving.outboxDrops.${rid}`
const scoped = (rid: string): Array<Record<string, unknown>> =>
  JSON.parse(window.localStorage.getItem(SCOPED(rid)) ?? '[]')

/**
 * H1. Drop records were once written to ONE global key. A receiving tablet at
 * the door is shared and restaurant switching is a first-class gesture, so one
 * house's dropped order label rendered on another's screen. The records already
 * on devices are still read under that scoping.
 */
describe('H1 — a recorded lost delivery belongs to the house that took it', () => {
  it("does not show restaurant A's recorded delivery to restaurant B", () => {
    window.localStorage.setItem(
      SCOPED('rest-A'),
      JSON.stringify([
        { id: 'a', orderLabel: 'PO-SECRET · Restaurant A', droppedAt: '2026-09-01T10:00:00.000Z', reason: 'refused' },
      ]),
    )

    expect(readDroppedDoorReceipts('rest-A')).toHaveLength(1)
    expect(readDroppedDoorReceipts('rest-B')).toEqual([])
  })

  it('adopts a record left under the pre-scoping key rather than orphaning it', () => {
    window.localStorage.setItem(
      'mudavym.door.drops.v1',
      JSON.stringify([
        { id: 'old', orderLabel: 'PO-OLD', droppedAt: '2026-09-01T10:00:00.000Z', reason: 'refused' },
      ]),
    )

    const got = readDroppedDoorReceipts('rest-A')

    expect(got).toMatchObject([{ id: 'old', orderLabel: 'PO-OLD', tenantUnknown: true }])
    // Moved, not copied: otherwise it fans out to every house that opens the door.
    expect(window.localStorage.getItem('mudavym.door.drops.v1')).toBeNull()
    expect(scoped('rest-A')).toHaveLength(1)
  })
})

/**
 * H2 — the adversary's probe, re-cut for parking. Queue [PO-77], server 400,
 * and the park write itself fails. Before ADR 0140 the flush deleted the entry
 * with nothing on disk; the entry must be kept, queued and unparked, and the
 * next flush meets it again.
 */
describe('H2 — a receipt cannot vanish because this phone could not park it', () => {
  it('keeps the queue entry, unparked, when the park write fails', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pendingAt('m-77', 'rest-A', 0, 'PO-77')])
    recordDoorReceipt.mockRejectedValue(httpError(400))
    store.updatePendingMutation.mockRejectedValue(new Error('QuotaExceededError'))

    const res = await flushDoorOutbox()

    // Nothing was destroyed.
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    // And nothing claims it was parked: it is still waiting, so it is `failed`.
    expect(res).toEqual({ sent: 0, failed: 1, parked: 0, unreachable: false })
  })
})

/**
 * M2. The in-flight guard handed a joining caller the running pass's result.
 * A receipt queued after that pass read the list was never attempted, and the
 * joiner was told `sent: 1, failed: 0, dropped: 0` about it.
 */
describe('M2 — a caller that joined after the read gets a pass that saw its receipt', () => {
  it('re-runs for the joiner instead of reporting a pass that never saw it', async () => {
    let release!: () => void
    const blocked = new Promise<void>((r) => {
      release = r
    })
    store.getPendingMutationsByType
      .mockResolvedValueOnce([pendingAt('a', 'rest-A')])
      .mockResolvedValue([pendingAt('b', 'rest-A')])
    recordDoorReceipt
      .mockImplementationOnce(async () => {
        await blocked
        return { alreadyRecorded: false }
      })
      .mockResolvedValue({ alreadyRecorded: false })

    const first = flushDoorOutbox()
    await settle() // pass 1 has read [a] and is blocked on the send
    const second = flushDoorOutbox()
    release()

    expect(await first).toMatchObject({ sent: 1 })
    expect(await second).toMatchObject({ sent: 1 })
    expect(recordDoorReceipt).toHaveBeenCalledTimes(2)
    expect(store.removePendingMutation).toHaveBeenCalledWith('b')
  })
})

/**
 * L1. The pass used to reject when the queue itself could not be read, and
 * every joined caller rejected with it — while no consumer has a catch, so the
 * rail's "last sync" simply froze.
 */
describe('L1 — a pass that cannot read the queue reports that, not health', () => {
  it('returns `unreachable` rather than rejecting, for the joiner too', async () => {
    store.getPendingMutationsByType.mockRejectedValue(new Error('IndexedDB is gone'))

    const [a, b] = await Promise.all([flushDoorOutbox(), flushDoorOutbox()])

    expect(a).toEqual({ sent: 0, failed: 0, parked: 0, unreachable: true })
    expect(b).toEqual(a)
  })
})
/**
 * The gap the scoping opens: a receipt queued BEFORE `restaurantId` existed on
 * the entry has no house to file under. Writing it to a `.unscoped` bucket no
 * screen reads would be a durable record that renders as nothing — the same
 * fault, one layer down.
 */
describe('H1 — a drop with no house recorded is still shown to someone', () => {
  it('never SENDS an entry that names no house or person — it is parked as not sent (ADR 0241)', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      {
        id: 'pre',
        type: 'receiving.door',
        // No restaurantId and no owner: queued before either stamp existed.
        data: { orderId: 'o-pre', orderLabel: 'PO-PRE', body: {} },
        timestamp: new Date(),
        retryCount: 0,
      },
    ])

    await flushDoorOutbox()

    // Sending it as whoever is signed in is the defect OD-203 closed.
    expect(recordDoorReceipt).not.toHaveBeenCalled()
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'pre',
      expect.objectContaining({ parked: expect.objectContaining({ reason: 'unowned' }) }),
    )
  })

  it('shows but does not adopt an unattributed record when no house is active', () => {
    window.localStorage.setItem(
      'mudavym.receiving.outboxDrops',
      JSON.stringify([{ id: 'pre', orderLabel: 'PO-PRE', droppedAt: '2026-09-01T00:00:00.000Z' }]),
    )

    expect(readDroppedDoorReceipts('')).toMatchObject([{ id: 'pre', tenantUnknown: true }])
    // Still there for the house it belongs to, rather than moved under ''.
    expect(window.localStorage.getItem('mudavym.receiving.outboxDrops')).not.toBeNull()
    expect(readDroppedDoorReceipts('rest-A')).toMatchObject([{ id: 'pre', tenantUnknown: true }])
    expect(window.localStorage.getItem('mudavym.receiving.outboxDrops')).toBeNull()
  })
})

/*
 * The `stranded` suite that used to sit here is gone: ADR 0140 withdrew the
 * durable strand witness entirely. What replaced it is
 * `doorOutbox.durability.test.ts`, which mocks nothing but the network and
 * asserts the property that actually matters — the receipt is never destroyed.
 *
 * Not a tidy-up. These tests mocked `./offline-storage` with a store that always
 * applies the patch, and that mock cannot express the state the whole feature
 * exists for — storage REFUSING the write. It is why 920 green tests did not see
 * an alarm that had gone silent. A strand test that mocks the store is a test of
 * the mock.
 */

/**
 * Acknowledging a drop with no active house told the caller it was gone and
 * left it on disk. The read falls back to the legacy key when there is no house
 * (adoption deliberately does not run), but both writers only ever touched the
 * scoped key — so the record came back on the very next read.
 */
describe('dismiss/clear reach the key the read actually used', () => {
  const seedLegacy = () =>
    window.localStorage.setItem(
      'mudavym.receiving.outboxDrops',
      JSON.stringify([
        { id: 'pre-1', orderLabel: 'PO-A', droppedAt: '2026-09-01T00:00:00.000Z' },
        { id: 'pre-2', orderLabel: 'PO-B', droppedAt: '2026-09-01T00:00:00.000Z' },
      ]),
    )

  it('dismissing with no active house actually forgets it', () => {
    seedLegacy()
    expect(dismissDroppedDoorReceipt('', 'pre-1')).toMatchObject([{ id: 'pre-2' }])
    expect(readDroppedDoorReceipts('')).toMatchObject([{ id: 'pre-2' }])
  })

  it('clearing with no active house actually clears it', () => {
    seedLegacy()
    clearDroppedDoorReceipts('')
    expect(readDroppedDoorReceipts('')).toEqual([])
  })

  it('an acknowledged inherited record does not come back for the next house', () => {
    seedLegacy()
    // House A opens the page: the records are adopted, marked, and shown.
    expect(readDroppedDoorReceipts('rest-A')).toHaveLength(2)
    clearDroppedDoorReceipts('rest-A')
    expect(readDroppedDoorReceipts('rest-A')).toEqual([])
    expect(readDroppedDoorReceipts('rest-B')).toEqual([])
  })
})

describe('ADR 0241 — a house switch in the middle of a flush', () => {
  it('leaves the rest of the flush queued for its own house', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('a'), pending('b')])
    recordDoorReceipt.mockImplementationOnce(async () => {
      window.localStorage.setItem(
        'accessToken',
        `h.${btoa(JSON.stringify({ sub: 'porter-1', restaurantId: 'rest-B' }))}.s`,
      )
      window.localStorage.setItem('activeRestaurantId', 'rest-B')
      return {}
    })

    const res = await flushDoorOutbox()

    expect(recordDoorReceipt).toHaveBeenCalledTimes(1)
    expect(res.sent).toBe(1)
    expect(store.removePendingMutation).not.toHaveBeenCalledWith('b')
  })
})


describe('Send again and Discard — one parked receipt, by a person', () => {
  const parked = (id: string, reason: 'refused' | 'unowned') => ({
    ...pending(id),
    parked: { reason, status: reason === 'refused' ? 422 : undefined, at: '2026-09-29T00:00:00.000Z' },
  })

  it('Send again un-parks a refused receipt and flushes it', async () => {
    store.getPendingMutationsByType
      .mockResolvedValueOnce([parked('r', 'refused')])
      .mockResolvedValue([pending('r')])
    recordDoorReceipt.mockResolvedValue({ alreadyRecorded: false })

    expect(await resendDoorReceipt('r')).toBe(true)

    expect(store.updatePendingMutation).toHaveBeenCalledWith('r', { parked: undefined })
    expect(recordDoorReceipt).toHaveBeenCalledTimes(1)
    expect(store.removePendingMutation).toHaveBeenCalledWith('r')
  })

  it('cannot send an unowned receipt again — there is nobody to send it as', async () => {
    store.getPendingMutationsByType.mockResolvedValue([parked('u', 'unowned')])

    expect(await resendDoorReceipt('u')).toBe(false)

    expect(store.updatePendingMutation).not.toHaveBeenCalled()
    expect(recordDoorReceipt).not.toHaveBeenCalled()
  })

  it('Discard removes the entry — the only path that does', async () => {
    store.getPendingMutationsByType.mockResolvedValue([parked('u', 'unowned')])

    expect(await discardDoorReceipt('u')).toBe(true)
    expect(store.removePendingMutation).toHaveBeenCalledWith('u')
  })

  it('Discard never removes a receipt that is queued to send, or one this session cannot see', async () => {
    // A stale rail row: another tab un-parked it, or the house changed since
    // the row was drawn. The scoped read no longer shows it as parked.
    store.getPendingMutationsByType.mockResolvedValue([pending('q')])

    expect(await discardDoorReceipt('q')).toBe(false)
    expect(await discardDoorReceipt('elsewhere')).toBe(false)
    expect(store.removePendingMutation).not.toHaveBeenCalled()
  })

  it('counts a parked receipt as Not sent, never as waiting', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      pending('w'),
      parked('r', 'refused'),
      parked('u', 'unowned'),
    ])

    expect(await pendingDoorCount()).toBe(1)
    expect(await notSentDoorCount()).toBe(2)
  })
})
