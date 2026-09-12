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

import {
  flushDoorOutbox,
  readDroppedDoorReceipts,
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
    expect(res).toEqual({ sent: 0, failed: 1, dropped: 1, stranded: 0, unreachable: false })
  })

  it('counts an exhausted retry budget as dropped', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('b', 7)])
    recordDoorReceipt.mockRejectedValue(httpError(500))

    const res = await flushDoorOutbox()

    expect(store.removePendingMutation).toHaveBeenCalledWith('b')
    expect(res).toEqual({ sent: 0, failed: 1, dropped: 1, stranded: 0, unreachable: false })
  })

  it('does NOT count a retryable failure as dropped — it is still in the queue', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('c', 1)])
    recordDoorReceipt.mockRejectedValue(httpError(503))

    const res = await flushDoorOutbox()

    expect(store.removePendingMutation).not.toHaveBeenCalled()
    expect(res).toEqual({ sent: 0, failed: 1, dropped: 0, stranded: 0, unreachable: false })
  })

  it('reports a delivery and a drop from the same pass separately', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pending('d'), pending('e')])
    recordDoorReceipt
      .mockResolvedValueOnce({ alreadyRecorded: false })
      .mockRejectedValueOnce(httpError(400))

    expect(await flushDoorOutbox()).toEqual({
      sent: 1,
      failed: 1,
      dropped: 1,
      stranded: 0,
      unreachable: false,
    })
  })

  it('is zero on every axis when offline — nothing was attempted, nothing was lost', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    expect(await flushDoorOutbox()).toEqual({
      sent: 0,
      failed: 0,
      dropped: 0,
      stranded: 0,
      unreachable: false,
    })
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
 * H1. The record landed on ONE global key. A receiving tablet at the door is
 * shared and restaurant switching is a first-class gesture, so one house's
 * dropped order label rendered on another's screen — the exact leak the
 * sibling store (useReceivingNextData.ts, `dropsKey`) had already closed.
 */
describe('H1 — a lost delivery belongs to the house that took it', () => {
  it('writes the record under the receiving restaurant, never a global key', async () => {
    store.getPendingMutationsByType.mockResolvedValue([pendingAt('a', 'rest-A')])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    await flushDoorOutbox()

    expect(scoped('rest-A')).toHaveLength(1)
    expect(window.localStorage.getItem('mudavym.door.drops.v1')).toBeNull()
    expect(window.localStorage.getItem('mudavym.receiving.outboxDrops')).toBeNull()
  })

  it("does not show restaurant A's lost delivery to restaurant B", async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      pendingAt('a', 'rest-A', 0, 'PO-SECRET · Restaurant A'),
    ])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    await flushDoorOutbox()

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
 * H2 — the adversary's probe, verbatim. Queue [PO-77], server 400, storage
 * throws QuotaExceededError. Before this the flush deleted the queue entry,
 * failed to write the record, and returned `dropped: 1` with nothing on screen
 * and nothing on disk: a permanently lost delivery with no trace, produced by
 * the commit whose whole purpose was to stop exactly that.
 */
describe('H2 — a receipt cannot vanish because this phone could not write it down', () => {
  it('keeps the queue entry when the record cannot be written, and says so', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      pendingAt('m-77', 'rest-A', 0, 'PO-77'),
    ])
    recordDoorReceipt.mockRejectedValue(httpError(400))
    // Spied on the INSTANCE, not on Storage.prototype: in this jsdom a
    // prototype spy never reaches `window.localStorage`, so the probe would
    // pass without ever simulating a full disk.
    const setItem = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation(() => {
        const e = new Error('The quota has been exceeded.')
        e.name = 'QuotaExceededError'
        throw e
      })

    const res = await flushDoorOutbox()
    setItem.mockRestore()

    // Nothing was destroyed.
    expect(store.removePendingMutation).not.toHaveBeenCalled()
    // And nothing claims it was recorded.
    expect(res.dropped).toBe(0)
    expect(res.stranded).toBe(1)
    expect(res.failed).toBe(1)
    expect(store.updatePendingMutation).toHaveBeenCalledWith(
      'm-77',
      expect.objectContaining({ retryCount: 8 }),
    )
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

    expect(a).toEqual({ sent: 0, failed: 0, dropped: 0, stranded: 0, unreachable: true })
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
  it('files an unstamped entry where the adoption will find it, marked', async () => {
    store.getPendingMutationsByType.mockResolvedValue([
      {
        id: 'pre',
        type: 'receiving.door',
        // No restaurantId: queued before the stamp existed.
        data: { orderId: 'o-pre', orderLabel: 'PO-PRE', body: {} },
        timestamp: new Date(),
        retryCount: 0,
      },
    ])
    recordDoorReceipt.mockRejectedValue(httpError(422))

    await flushDoorOutbox()

    expect(window.localStorage.getItem('mudavym.receiving.outboxDrops.unscoped')).toBeNull()

    const seen = readDroppedDoorReceipts('rest-A')
    expect(seen).toMatchObject([{ id: 'pre', orderLabel: 'PO-PRE', tenantUnknown: true }])
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
