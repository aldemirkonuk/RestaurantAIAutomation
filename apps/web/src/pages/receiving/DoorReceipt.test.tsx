import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DoorReceipt from './DoorReceipt'

/**
 * The legacy door page — the one every porter actually hits, because the
 * rebuilt DoorNext sits behind `mudavym_design_receiving_door` and production
 * has no feature-flag rows.
 *
 * It used to read the pending count and nothing else. `flushDoorOutbox` deletes
 * a receipt it gives up on (a 4xx, or eight failed attempts), so that count
 * falls by one for a DROPPED delivery exactly as it does for a delivered one:
 * the loss rendered as progress. These tests pin the three states apart — and
 * pin the drop to the outbox's durable record rather than to a counter in this
 * component, which the next navigation erased.
 */

type Drop = {
  id: string
  orderLabel: string
  droppedAt: string
  reason: 'auth' | 'refused' | 'retries'
}

const watchDoorOutbox = vi.hoisted(() => vi.fn())
const pendingDoorCount = vi.hoisted(() => vi.fn())
const readDroppedDoorReceipts = vi.hoisted(() => vi.fn())
const clearDroppedDoorReceipts = vi.hoisted(() => vi.fn())
vi.mock('../../lib/doorOutbox', () => ({
  watchDoorOutbox,
  pendingDoorCount,
  readDroppedDoorReceipts,
  clearDroppedDoorReceipts,
  submitDoorReceipt: vi.fn(),
  newIdempotencyKey: () => 'door:o1:test',
}))

vi.mock('../../services/api/receiving', () => ({ receivingApi: { uploadDocument: vi.fn() } }))

/**
 * The drop record is scoped per restaurant — a door tablet is shared, and one
 * global key showed one house's order label to the next house it switched to.
 * The page reads the active house from auth to scope both the record and the
 * receipt it queues.
 */
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', user: { restaurantId: 'rest-A' } }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ orderId: 'o1' }) }
})

/** The flush callback the page hands the watcher, so a flush can be simulated. */
type Flush = { sent: number; failed: number; dropped: number }
let onFlush: (r: Flush) => void

/** Stands in for the outbox's durable record, which the flush writes. */
let record: Drop[] = []
const drop = (id: string, reason: Drop['reason'] = 'refused'): Drop => ({
  id,
  orderLabel: `order-${id}`,
  droppedAt: '2026-09-12T09:15:00.000Z',
  reason,
})

beforeEach(() => {
  vi.clearAllMocks()
  record = []
  pendingDoorCount.mockResolvedValue(0)
  readDroppedDoorReceipts.mockImplementation(() => record)
  clearDroppedDoorReceipts.mockImplementation(() => {
    record = []
  })
  watchDoorOutbox.mockImplementation((cb: (r: Flush) => void) => {
    onFlush = cb
    return () => {}
  })
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <DoorReceipt />
    </MemoryRouter>,
  )

/** A flush that gave up on `drops`, exactly as the outbox reports one: the
 *  record is written first, then the counts are handed to the callback. */
const flush = async (r: Flush, drops: Drop[] = []) => {
  record = [...record, ...drops]
  await act(async () => {
    onFlush(r)
  })
}

const dropNotice = () => screen.queryByRole('alert')

describe('DoorReceipt — a dropped receipt is not a delivered one', () => {
  it('says so, in words a porter can act on, when the outbox gives one up', async () => {
    renderPage()
    expect(dropNotice()).toBeNull()

    await flush({ sent: 0, failed: 1, dropped: 1 }, [drop('a')])

    const notice = dropNotice()
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('never sent')
    // Names the order. A count cannot say which delivery left, and the porter
    // is holding paperwork for several.
    expect(notice?.textContent).toContain('order-a')
    // The two things only the person standing at the door can still do.
    expect(notice?.textContent).toContain('Keep the paperwork')
    expect(notice?.textContent).toContain('tell a manager')
  })

  it('stays on screen after a later flush succeeds — a drop is permanent', async () => {
    renderPage()
    await flush({ sent: 0, failed: 1, dropped: 1 }, [drop('a')])
    await flush({ sent: 3, failed: 0, dropped: 0 })

    expect(dropNotice()?.textContent).toContain('never sent')
  })

  it('survives the navigation that unmounts this screen', async () => {
    const first = renderPage()
    await flush({ sent: 0, failed: 1, dropped: 1 }, [drop('a')])
    expect(dropNotice()).not.toBeNull()

    // Tapping Finish leaves the page. The record is the outbox's, not this
    // component's, so coming back to the door still shows the loss.
    first.unmount()
    renderPage()

    expect(dropNotice()?.textContent).toContain('order-a')
  })

  it('accumulates, so a second drop does not overwrite the first', async () => {
    renderPage()
    await flush({ sent: 0, failed: 1, dropped: 1 }, [drop('a')])
    await flush({ sent: 1, failed: 2, dropped: 2 }, [drop('b'), drop('c')])

    expect(dropNotice()?.textContent).toContain('3 deliveries saved on this phone were never sent')
    expect(dropNotice()?.textContent).toContain('order-b')
  })

  it('counts one loss once when the same flush result arrives twice', async () => {
    renderPage()
    // Two triggers overlapping used to add `dropped` twice for one receipt.
    // The record is keyed on the queue id, so re-reading it cannot double.
    await flush({ sent: 0, failed: 1, dropped: 1 }, [drop('a')])
    await act(async () => {
      onFlush({ sent: 0, failed: 1, dropped: 1 })
    })

    expect(dropNotice()?.textContent).toContain('Delivery order-a')
    expect(dropNotice()?.textContent).not.toContain('2 deliveries')
  })

  it('sends the porter after the right remedy when the app was signed out', async () => {
    renderPage()
    await flush({ sent: 0, failed: 1, dropped: 1 }, [drop('a', 'auth')])

    const notice = dropNotice()
    expect(notice?.textContent).toContain('Sign in again')
    // Not upstairs: a manager cannot fix an expired session, and the walk is
    // the minutes in which the paperwork gets put down and lost.
    expect(notice?.textContent).not.toContain('tell a manager')
    // Still told to hold on to it — signing in again does not bring back a
    // receipt the flush already deleted.
    expect(notice?.textContent?.toLowerCase()).toContain('keep the paperwork')
  })

  it('claims no cause when the drops are mixed', async () => {
    renderPage()
    await flush({ sent: 0, failed: 2, dropped: 2 }, [drop('a', 'auth'), drop('b', 'retries')])

    expect(dropNotice()?.textContent).not.toContain('Sign in again')
    expect(dropNotice()?.textContent).toContain('tell a manager')
  })

  it('lets the porter acknowledge it, and that is the only thing that clears it', async () => {
    renderPage()
    await flush({ sent: 0, failed: 1, dropped: 1 }, [drop('a')])

    await act(async () => {
      fireEvent.click(screen.getByText('I have the paperwork'))
    })

    expect(clearDroppedDoorReceipts).toHaveBeenCalledTimes(1)
    expect(dropNotice()).toBeNull()
  })

  it('does not cry wolf over a retryable failure — that one is still queued', async () => {
    pendingDoorCount.mockResolvedValue(1)
    renderPage()

    await flush({ sent: 0, failed: 1, dropped: 0 })

    expect(dropNotice()).toBeNull()
    expect(await screen.findByText('1 to send')).toBeTruthy()
  })
})
