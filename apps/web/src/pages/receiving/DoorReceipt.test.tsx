import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
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
 * the loss rendered as progress. These tests pin the three states apart.
 */

const watchDoorOutbox = vi.hoisted(() => vi.fn())
const pendingDoorCount = vi.hoisted(() => vi.fn())
vi.mock('../../lib/doorOutbox', () => ({
  watchDoorOutbox,
  pendingDoorCount,
  submitDoorReceipt: vi.fn(),
  newIdempotencyKey: () => 'door:o1:test',
}))

vi.mock('../../services/api/receiving', () => ({ receivingApi: { uploadDocument: vi.fn() } }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ orderId: 'o1' }) }
})

/** The flush callback the page hands the watcher, so a flush can be simulated. */
type Flush = { sent: number; failed: number; dropped: number }
let onFlush: (r: Flush) => void

beforeEach(() => {
  vi.clearAllMocks()
  pendingDoorCount.mockResolvedValue(0)
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

const flush = async (r: Flush) => {
  await act(async () => {
    onFlush(r)
  })
}

const dropNotice = () => screen.queryByRole('alert')

describe('DoorReceipt — a dropped receipt is not a delivered one', () => {
  it('says so, in words a porter can act on, when the outbox gives one up', async () => {
    renderPage()
    expect(dropNotice()).toBeNull()

    await flush({ sent: 0, failed: 1, dropped: 1 })

    const notice = dropNotice()
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('never sent')
    // The two things only the person standing at the door can still do.
    expect(notice?.textContent).toContain('Keep the paperwork')
    expect(notice?.textContent).toContain('tell a manager')
  })

  it('stays on screen after a later flush succeeds — a drop is permanent', async () => {
    renderPage()
    await flush({ sent: 0, failed: 1, dropped: 1 })
    await flush({ sent: 3, failed: 0, dropped: 0 })

    expect(dropNotice()?.textContent).toContain('never sent')
  })

  it('accumulates, so a second drop does not overwrite the first', async () => {
    renderPage()
    await flush({ sent: 0, failed: 1, dropped: 1 })
    await flush({ sent: 1, failed: 2, dropped: 2 })

    expect(dropNotice()?.textContent).toContain('3 deliveries saved on this phone were never sent')
  })

  it('does not cry wolf over a retryable failure — that one is still queued', async () => {
    pendingDoorCount.mockResolvedValue(1)
    renderPage()

    await flush({ sent: 0, failed: 1, dropped: 0 })

    expect(dropNotice()).toBeNull()
    expect(await screen.findByText('1 to send')).toBeTruthy()
  })
})
