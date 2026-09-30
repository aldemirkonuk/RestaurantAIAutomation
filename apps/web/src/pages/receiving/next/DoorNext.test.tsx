import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DoorNext from './DoorNext'

/**
 * The rebuilt door screen, and the distinctions it has to keep.
 *
 * `flushDoorOutbox` counts a RETRYABLE pass in `failed` — the receipt is still
 * in the queue and the next flush sends it. A receipt the server refuses for
 * good is PARKED as "Not sent" (ADR 0241 amendment, 2026-09-29 — the founder:
 * "option 1, not sent."): kept in the queue, counted in `parked`, never
 * deleted. Neither is a loss, so neither may raise the red alarm; the alarm is
 * reserved for a drop RECORD, which only receipts dropped before the amendment
 * have.
 *
 * This page once rendered its red "did not send — tell a manager" banner on
 * `failed`, so a single flaky flush on a phone at the dock sent a receiver to
 * find a manager about a delivery that was about to arrive on the server by
 * itself. These tests pin the split on the version the founder's house has
 * switched ON.
 */

const flushDoorOutbox = vi.hoisted(() => vi.fn())
const pendingDoorCount = vi.hoisted(() => vi.fn())
const notSentDoorCount = vi.hoisted(() => vi.fn())
const readDroppedDoorReceipts = vi.hoisted(() => vi.fn())
const clearDroppedDoorReceipts = vi.hoisted(() => vi.fn())
vi.mock('@/lib/doorOutbox', () => ({
  flushDoorOutbox,
  pendingDoorCount,
  notSentDoorCount,
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
    doorReceivedSoFar: vi.fn().mockResolvedValue({
      receivedQtyBottles: 0,
      packSize: 12,
      receivedBoxes: 0,
      receivedLooseBottles: 0,
      doorEventCount: 0,
    }),
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
  parked: number
  unreachable?: boolean
}

type Drop = {
  id: string
  orderLabel: string
  droppedAt: string
  reason: 'auth' | 'refused' | 'retries'
}

/**
 * Drop records written BEFORE the ADR 0241 amendment. Nothing writes a new
 * one; the page still reads and shows the ones already on a device.
 */
let record: Drop[] = []
const oldDrop = (orderLabel: string, reason: Drop['reason'] = 'refused'): Drop => ({
  id: `d-${orderLabel}`,
  orderLabel,
  droppedAt: '2026-09-12T09:15:00.000Z',
  reason,
})

/** Stands in for the queue's parked entries — what `notSentDoorCount` reads. */
let parkedOnPhone = 0

/**
 * A pass, mirrored the way the real outbox behaves: a refusal is parked in the
 * queue (so the parked count on the phone grows) BEFORE the count returns.
 */
const pass = (r: Flush): Flush => {
  parkedOnPhone += r.parked
  return { unreachable: false, ...r }
}

beforeEach(() => {
  vi.clearAllMocks()
  record = []
  parkedOnPhone = 0
  pendingDoorCount.mockResolvedValue(0)
  notSentDoorCount.mockImplementation(async () => parkedOnPhone)
  readDroppedDoorReceipts.mockImplementation(() => record)
  clearDroppedDoorReceipts.mockImplementation(() => {
    record = []
  })
  flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 0, parked: 0 }))
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

const notSent = () => document.querySelector('[data-ux-key="door:not-sent"]')

describe('DoorNext — a refused door report is parked as Not sent, never an alarm', () => {
  it('does NOT cry wolf over a retryable failure — that one is still queued', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 1, parked: 0 }))
    renderPage()

    // The quiet line proves the flush was actually observed, so the absent
    // alarm below is a decision and not a render that never happened.
    await waitFor(() => expect(quiet()).not.toBeNull())
    expect(quiet()?.textContent).toContain('still trying')
    expect(alarm()).toBeNull()
    expect(notSent()).toBeNull()
  })

  it('says a refused report is kept as Not sent, quietly, and where to act on it', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 0, parked: 1 }))
    renderPage()

    await waitFor(() => expect(notSent()).not.toBeNull())
    expect(notSent()?.textContent).toContain('1 delivery report on this phone was not sent')
    expect(notSent()?.textContent).toContain('Not sent')
    expect(notSent()?.textContent).toContain('Receiving')
    // Kept, not lost: no red alarm, and not "still trying" either — nothing
    // will send it on its own.
    expect(alarm()).toBeNull()
    expect(quiet()).toBeNull()
  })

  it('keeps the still-trying count and the Not sent count apart in one pass', async () => {
    renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())

    // Three did not send: one is still waiting, two were refused and parked.
    await flushAgain({ sent: 1, failed: 1, parked: 2 })

    await waitFor(() => expect(notSent()).not.toBeNull())
    expect(quiet()?.textContent).toContain('1 report did not send yet')
    expect(notSent()?.textContent).toContain('2 delivery reports on this phone were not sent')
    expect(alarm()).toBeNull()
  })

  it('counts ONE refused report once when two triggers join the same pass', async () => {
    // The walk from the dock to the office raises 'online' and
    // 'visibilitychange' in the same tick, and the outbox hands both callers
    // the SAME in-flight pass — one promise, not two.
    const onePass = Promise.resolve(pass({ sent: 0, failed: 0, parked: 1 }))
    flushDoorOutbox.mockReturnValue(onePass)
    renderPage()
    await waitFor(() => expect(notSent()).not.toBeNull())

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // The page re-READS the queue rather than adding the count.
    expect(notSent()?.textContent).toContain('1 delivery report on this phone was not sent')
  })

  it('stays silent when nothing failed at all', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 2, failed: 0, parked: 0 }))
    renderPage()

    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    expect(alarm()).toBeNull()
    expect(quiet()).toBeNull()
    expect(notSent()).toBeNull()
  })
})

/**
 * Drop records written before the amendment are still on devices. They stay
 * loud — the receipt really is gone — and they must name the right remedy.
 */
describe('DoorNext — a drop recorded before the amendment is still shown', () => {
  it('says so, in words a receiver can act on', async () => {
    record = [oldDrop('PO-1')]
    renderPage()

    await waitFor(() => expect(alarm()).not.toBeNull())
    const notice = alarm()
    // Named, because the record carries the order label — a count could not.
    expect(notice?.textContent).toContain('PO-1')
    expect(notice?.textContent).toContain('never sent')
    // The two things only the person standing at the door can still do.
    expect(notice?.textContent).toContain('Keep the paperwork')
    expect(notice?.textContent).toContain('tell a manager')
  })

  it('stays on screen after a later flush succeeds — a drop is permanent', async () => {
    record = [oldDrop('PO-1')]
    renderPage()
    await waitFor(() => expect(alarm()).not.toBeNull())

    await flushAgain({ sent: 3, failed: 0, parked: 0 })

    expect(alarm()?.textContent).toContain('never sent')
  })

  it('names several recorded drops together', async () => {
    record = [oldDrop('PO-1'), oldDrop('PO-2'), oldDrop('PO-3')]
    renderPage()

    await waitFor(() => expect(alarm()).not.toBeNull())
    expect(alarm()?.textContent).toContain('3 deliveries saved on this phone were never sent')
  })
})

/**
 * A stored `auth` reason means the server turned the account away — a 403 — because
 * ADR 0241 retries a 401 and never drops it. The notice used to say "The app
 * was signed out. Sign in again", which sent the porter after the wrong fix
 * and dropped "tell a manager" (#530 audit).
 */
describe('DoorNext — a 403 drop is not "signed out"', () => {
  it('says the server turned the account away, keeps the paperwork, tells a manager', async () => {
    record = [oldDrop('PO-9', 'auth')]
    renderPage()

    await waitFor(() => expect(alarm()).not.toBeNull())
    const text = alarm()?.textContent ?? ''
    expect(text).toContain('The server turned this account away')
    expect(text).toContain('Keep the paperwork')
    expect(text).toContain('tell a manager')
    expect(text).not.toContain('signed out')
    expect(text).not.toMatch(/sign in/i)
  })
})

/**
 * The strand has NO screen of its own, deliberately — ADR 0140 — and since the
 * amendment a refusal cannot strand at all (nothing is deleted). This pins
 * that no pass result alone raises an alarm.
 */
describe('DoorNext raises no standing alarm off a pass result', () => {
  const strand = () => document.querySelector('[data-ux-key="door:stranded"]')

  it('renders no alarm, however many passes report failures or parks', async () => {
    flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 1, parked: 0 }))
    renderPage()
    await waitFor(() => expect(quiet()).not.toBeNull())

    await flushAgain({ sent: 0, failed: 1, parked: 1 })
    await flushAgain({ sent: 0, failed: 1, parked: 0 })

    expect(strand()).toBeNull()
    expect(alarm()).toBeNull()
    expect(quiet()?.textContent).toContain('still trying')
  })
})
