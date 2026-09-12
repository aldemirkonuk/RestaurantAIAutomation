import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DoorNext from './DoorNext'

/**
 * The rebuilt door screen, and the one distinction it was crying wolf over.
 *
 * `flushDoorOutbox` counts a RETRYABLE pass in `failed` — the receipt is still
 * in the queue and the next flush sends it (lib/doorOutbox.ts:152-158). Only
 * `dropped` means the app has given up: a 4xx, or the retry budget spent, with
 * the item deleted from the queue (lib/doorOutbox.ts:143-150).
 *
 * This page rendered its red "did not send — tell a manager" banner on
 * `failed`, so a single flaky flush on a phone at the dock sent a receiver to
 * find a manager about a delivery that was about to arrive on the server by
 * itself. The legacy page pins the opposite (DoorReceipt.test.tsx:92); this
 * pins it here, on the version the founder's house has switched ON.
 */

const flushDoorOutbox = vi.hoisted(() => vi.fn())
const pendingDoorCount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/doorOutbox', () => ({
  flushDoorOutbox,
  pendingDoorCount,
  submitDoorReceipt: vi.fn(),
  newIdempotencyKey: () => 'door:o1:test',
}))

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

type Flush = { sent: number; failed: number; dropped: number }

beforeEach(() => {
  vi.clearAllMocks()
  pendingDoorCount.mockResolvedValue(0)
  flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 0, dropped: 0 })
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <DoorNext />
    </MemoryRouter>,
  )

/** The page flushes on mount and on `online`; this drives a second pass. */
const flushAgain = async (r: Flush) => {
  flushDoorOutbox.mockResolvedValue(r)
  await act(async () => {
    window.dispatchEvent(new Event('online'))
  })
}

const alarm = () => screen.queryByRole('alert')
const quiet = () => document.querySelector('[data-ux-key="door:retrying"]')

describe('DoorNext — a dropped door report is not a retried one', () => {
  it('does NOT cry wolf over a retryable failure — that one is still queued', async () => {
    flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 1, dropped: 0 })
    renderPage()

    // The quiet line proves the flush was actually observed, so the absent
    // alarm below is a decision and not a render that never happened.
    await waitFor(() => expect(quiet()).not.toBeNull())
    expect(quiet()?.textContent).toContain('still trying')
    expect(alarm()).toBeNull()
  })

  it('says so, in words a receiver can act on, when the outbox gives one up', async () => {
    flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 1, dropped: 1 })
    renderPage()

    await waitFor(() => expect(alarm()).not.toBeNull())
    const notice = alarm()
    expect(notice?.textContent).toContain('never sent')
    // The two things only the person standing at the door can still do.
    expect(notice?.textContent).toContain('Keep the paperwork')
    expect(notice?.textContent).toContain('tell a manager')
    // A drop is not also "still trying".
    expect(quiet()).toBeNull()
  })

  it('stays on screen after a later flush succeeds — a drop is permanent', async () => {
    flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 1, dropped: 1 })
    renderPage()
    await waitFor(() => expect(alarm()).not.toBeNull())

    await flushAgain({ sent: 3, failed: 0, dropped: 0 })

    expect(alarm()?.textContent).toContain('never sent')
  })

  it('accumulates, so a second drop does not overwrite the first', async () => {
    flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 1, dropped: 1 })
    renderPage()
    await waitFor(() => expect(alarm()).not.toBeNull())

    // Three failures in that pass, two of them permanent: the alarm counts the
    // two drops (plus the first), the quiet line counts the one still queued.
    await flushAgain({ sent: 1, failed: 3, dropped: 2 })

    expect(alarm()?.textContent).toContain('3 door reports saved on this phone were never sent')
    expect(quiet()?.textContent).toContain('1 report did not send yet')
    expect(quiet()?.textContent).toContain('still trying')
  })

  it('stays silent when nothing failed at all', async () => {
    flushDoorOutbox.mockResolvedValue({ sent: 2, failed: 0, dropped: 0 })
    renderPage()

    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    expect(alarm()).toBeNull()
    expect(quiet()).toBeNull()
  })
})
