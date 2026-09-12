import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DoorNext from './DoorNext'

/**
 * The rebuilt door screen, and the one distinction it was crying wolf over.
 *
 * `flushDoorOutbox` counts a RETRYABLE pass in `failed` — the receipt is still
 * in the queue and the next flush sends it (the `updatePendingMutation` retry
 * path in `flushDoorOutbox`, lib/doorOutbox.ts). Only `dropped` means the app
 * has given up: a 4xx, or the retry budget spent, with the item deleted from
 * the queue (the `if (permanent || m.retryCount + 1 >= MAX_ATTEMPTS)` branch in
 * the same loop).
 *
 * This page rendered its red "did not send — tell a manager" banner on
 * `failed`, so a single flaky flush on a phone at the dock sent a receiver to
 * find a manager about a delivery that was about to arrive on the server by
 * itself. The legacy page pins the same pair — DoorReceipt.test.tsx,
 * `describe('DoorReceipt — a dropped receipt is not a delivered one')`; this
 * pins it here, on the version the founder's house has switched ON.
 */

const flushDoorOutbox = vi.hoisted(() => vi.fn())
const pendingDoorCount = vi.hoisted(() => vi.fn())
const readDroppedDoorReceipts = vi.hoisted(() => vi.fn())
const clearDroppedDoorReceipts = vi.hoisted(() => vi.fn())
vi.mock('@/lib/doorOutbox', () => ({
  flushDoorOutbox,
  pendingDoorCount,
  readDroppedDoorReceipts,
  clearDroppedDoorReceipts,
  submitDoorReceipt: vi.fn(),
  newIdempotencyKey: () => 'door:o1:test',
}))

/** The page scopes the drop record by the active house. */
vi.mock('./useReceivingNextData', () => ({ useActiveRestaurantId: () => 'rest-A' }))

vi.mock('@/services/api/orders', () => ({ getOrder: vi.fn().mockResolvedValue(null) }))
vi.mock('@/services/api/receiving', () => ({
  receivingApi: {
    doorReceivedSoFar: vi.fn().mockResolvedValue({ receivedBoxes: 0 }),
    uploadDocument: vi.fn(),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ orderId: 'o1' }) }
})

type Flush = {
  sent: number
  failed: number
  dropped: number
  stranded?: number
  unreachable?: boolean
}

type Drop = {
  id: string
  orderLabel: string
  droppedAt: string
  reason: 'auth' | 'refused' | 'retries'
}

/**
 * Stands in for the outbox's durable record — the thing this page now reads
 * instead of keeping a count in state that died on the Finish navigate.
 */
let record: Drop[] = []

/**
 * A pass, mirrored the way the real outbox behaves: it writes one record per
 * dropped receipt, from the flush that caused it, BEFORE returning the count.
 * The page reads the record; the count only tells it to re-read.
 */
const pass = (r: Flush): Flush => {
  for (let i = 0; i < r.dropped; i += 1) {
    record.push({
      id: `d${record.length + 1}`,
      orderLabel: `PO-${record.length + 1}`,
      droppedAt: '2026-09-12T09:15:00.000Z',
      reason: 'refused',
    })
  }
  return { stranded: 0, unreachable: false, ...r }
}

beforeEach(() => {
  vi.clearAllMocks()
  record = []
  pendingDoorCount.mockResolvedValue(0)
  readDroppedDoorReceipts.mockImplementation(() => record)
  clearDroppedDoorReceipts.mockImplementation(() => {
    record = []
  })
  flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 0, dropped: 0 }))
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <DoorNext />
    </MemoryRouter>,
  )

/** The page flushes on mount and on `online`; this drives a second pass. */
const flushAgain = async (r: Flush) => {
  flushDoorOutbox.mockResolvedValue(pass(r))
  await act(async () => {
    window.dispatchEvent(new Event('online'))
  })
}

const alarm = () => screen.queryByRole('alert')
const quiet = () => document.querySelector('[data-ux-key="door:retrying"]')

describe('DoorNext — a dropped door report is not a retried one', () => {
  it('does NOT cry wolf over a retryable failure — that one is still queued', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 1, dropped: 0 }))
    renderPage()

    // The quiet line proves the flush was actually observed, so the absent
    // alarm below is a decision and not a render that never happened.
    await waitFor(() => expect(quiet()).not.toBeNull())
    expect(quiet()?.textContent).toContain('still trying')
    expect(alarm()).toBeNull()
  })

  it('says so, in words a receiver can act on, when the outbox gives one up', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 1, dropped: 1 }))
    renderPage()

    await waitFor(() => expect(alarm()).not.toBeNull())
    const notice = alarm()
    // Named, because the record carries the order label — a count could not.
    expect(notice?.textContent).toContain('PO-1')
    expect(notice?.textContent).toContain('never sent')
    // The two things only the person standing at the door can still do.
    expect(notice?.textContent).toContain('Keep the paperwork')
    expect(notice?.textContent).toContain('tell a manager')
    // A drop is not also "still trying".
    expect(quiet()).toBeNull()
  })

  it('stays on screen after a later flush succeeds — a drop is permanent', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 1, dropped: 1 }))
    renderPage()
    await waitFor(() => expect(alarm()).not.toBeNull())

    await flushAgain({ sent: 3, failed: 0, dropped: 0 })

    expect(alarm()?.textContent).toContain('never sent')
  })

  it('accumulates, so a second drop does not overwrite the first', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 1, dropped: 1 }))
    renderPage()
    await waitFor(() => expect(alarm()).not.toBeNull())

    // Three failures in that pass, two of them permanent: the alarm counts the
    // two drops (plus the first), the quiet line counts the one still queued.
    await flushAgain({ sent: 1, failed: 3, dropped: 2 })

    expect(alarm()?.textContent).toContain('3 deliveries saved on this phone were never sent')
    expect(quiet()?.textContent).toContain('1 report did not send yet')
    expect(quiet()?.textContent).toContain('still trying')
  })

  it('counts ONE lost report once when two triggers join the same pass', async () => {
    // The walk from the dock to the office raises 'online' and
    // 'visibilitychange' in the same tick, and the outbox hands both callers
    // the SAME in-flight pass (lib/doorOutbox.ts, `inFlight`) — so this returns
    // one promise, not two. Adding its `dropped` once per caller reported two
    // lost reports where one was lost.
    const onePass = Promise.resolve(pass({ sent: 0, failed: 1, dropped: 1 }))
    flushDoorOutbox.mockReturnValue(onePass)
    renderPage()
    await waitFor(() => expect(alarm()).not.toBeNull())

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // The page re-READS the record rather than adding the count, so a pass
    // reported to two callers cannot turn one lost delivery into two.
    expect(alarm()?.textContent).toContain('was saved on this phone and never sent')
    expect(alarm()?.textContent).not.toContain('2 deliveries')
  })

  it('stays silent when nothing failed at all', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 2, failed: 0, dropped: 0 }))
    renderPage()

    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    expect(alarm()).toBeNull()
    expect(quiet()).toBeNull()
  })
})
