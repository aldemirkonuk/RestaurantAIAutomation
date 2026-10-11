import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const submitDoorReceipt = vi.hoisted(() => vi.fn())
const queuedDoorReceiptFor = vi.hoisted(() => vi.fn())
const newIdempotencyKey = vi.hoisted(() => vi.fn())
vi.mock('@/lib/doorOutbox', () => ({
  queuedDoorReceiptFor,
  flushDoorOutbox,
  pendingDoorCount,
  notSentDoorCount,
  readDroppedDoorReceipts,
  clearDroppedDoorReceipts,
  submitDoorReceipt,
  newIdempotencyKey,
}))

/** The page scopes the drop record by the active house. */
vi.mock('./useReceivingNextData', () => ({ useActiveRestaurantId: () => 'rest-A' }))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ availableRestaurants: [{ id: 'rest-A', name: 'Meyhane Kadıköy' }] }),
}))

const getOrder = vi.hoisted(() => vi.fn())
vi.mock('@/services/api/orders', () => ({ getOrder }))
const recordDoorReceipt = vi.hoisted(() => vi.fn())
const uploadDocument = vi.hoisted(() => vi.fn())
vi.mock('@/services/api/receiving', () => ({
  receivingApi: {
    recordDoorReceipt,
    doorReceivedSoFar: vi.fn().mockResolvedValue({
      receivedQtyBottles: 0,
      packSize: 12,
      receivedBoxes: 0,
      receivedLooseBottles: 0,
      doorEventCount: 0,
      checked: false,
    }),
    uploadDocument,
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
  sessionStorage.clear()
  getOrder.mockResolvedValue(null)
  record = []
  parkedOnPhone = 0
  pendingDoorCount.mockResolvedValue(0)
  notSentDoorCount.mockImplementation(async () => parkedOnPhone)
  readDroppedDoorReceipts.mockImplementation(() => record)
  clearDroppedDoorReceipts.mockImplementation(() => {
    record = []
  })
  flushDoorOutbox.mockResolvedValue(pass({ sent: 0, failed: 0, parked: 0 }))
  queuedDoorReceiptFor.mockResolvedValue(null)
  newIdempotencyKey.mockReturnValue('door:o1:test')
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

/**
 * Whose clock dated the delivery. The phone's time is the delivery's when it
 * is no more than 72 hours old, or older on an owner's or a manager's word
 * (marked back-dated); otherwise the server's. The screen says so in one quiet
 * line when it was not the ordinary case, and says nothing when it was.
 */
describe('DoorNext — says which clock dated the delivery, only when it matters', () => {
  const sealWith = async (res: Record<string, unknown>) => {
    submitDoorReceipt.mockResolvedValue(res)
    renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
    // The keyboard path: arm, then confirm.
    const seal = screen.getByRole('button', { name: 'Hold to seal — 1 box in' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    await waitFor(() => expect(submitDoorReceipt).toHaveBeenCalled())
    // The done step proves the response was read, so an absent line below is
    // a decision and not a render that never happened.
    await waitFor(() =>
      expect(document.querySelector('[data-ux-key="door:finish"]')).not.toBeNull(),
    )
  }
  const dated = () => document.querySelector('[data-ux-key="door:dated"]')
  const sent = '2026-08-20T14:00:00.000Z'

  it('sends the tap time with the receipt', async () => {
    await sealWith({ synced: true, stockBooked: true })
    const body = submitDoorReceipt.mock.calls[0][0].body
    expect(Number.isFinite(Date.parse(body.clientCapturedAt))).toBe(true)
  })

  it('[REVERT-FAILS] says a time older than 72 hours was refused, and that only an owner or a manager can keep one', async () => {
    await sealWith({
      synced: true,
      stockBooked: true,
      factTime: { at: '2026-10-04T12:00:00.000Z', basis: 'server', sentAt: sent, reason: 'too_old' },
    })
    const line = dated()
    expect(line?.textContent).toContain(`This phone took it at ${new Date(sent).toLocaleString()}`)
    expect(line?.textContent).toContain('Only an owner or a manager can keep a time that old')
    // A record, not an alarm.
    expect(line?.getAttribute('role')).toBeNull()
    expect(alarm()).toBeNull()
  })

  it('[REVERT-FAILS] says a back-dated delivery was marked back-dated', async () => {
    await sealWith({
      synced: true,
      stockBooked: true,
      factTime: { at: sent, basis: 'back_dated', sentAt: sent, reason: 'back_dated' },
    })
    expect(dated()?.textContent).toBe(
      `Dated ${new Date(sent).toLocaleString()}, more than 72 hours ago — marked back-dated.`,
    )
  })

  it("[REVERT-FAILS] says a phone clock that ran ahead was not used", async () => {
    await sealWith({
      synced: true,
      stockBooked: true,
      factTime: {
        at: '2026-10-04T12:00:00.000Z',
        basis: 'server',
        sentAt: '2026-10-04T13:00:00.000Z',
        reason: 'ahead',
      },
    })
    expect(dated()?.textContent).toBe("This phone's clock is ahead, so it is dated by ours.")
  })

  it('says nothing when the phone time stood', async () => {
    await sealWith({
      synced: true,
      stockBooked: true,
      factTime: { at: sent, basis: 'sent', sentAt: sent, reason: 'within_window' },
    })
    expect(dated()).toBeNull()
  })

  it('says nothing when an older gateway sends no factTime', async () => {
    await sealWith({ synced: true, stockBooked: true })
    expect(dated()).toBeNull()
  })

  it('says nothing when the receipt was only saved on the phone — the bell says it later', async () => {
    await sealWith({
      synced: false,
      factTime: { at: sent, basis: 'server', sentAt: sent, reason: 'too_old' },
    })
    expect(dated()).toBeNull()
  })
})

/**
 * The page reads `factTime` off what the outbox hands back, so the outbox must
 * pass it through. The REAL outbox, not the mock above, against a mocked API.
 */
describe('submitDoorReceipt passes the dating through to the page', () => {
  it('[REVERT-FAILS] returns the gateway factTime on a receipt that sent', async () => {
    const factTime = {
      at: '2026-10-04T12:00:00.000Z',
      basis: 'server',
      sentAt: '2026-08-20T14:00:00.000Z',
      reason: 'too_old',
    }
    recordDoorReceipt.mockResolvedValue({
      alreadyRecorded: false,
      countedQtyBottles: 12,
      stockBooked: true,
      factTime,
    })
    const real = await vi.importActual<typeof import('@/lib/doorOutbox')>('@/lib/doorOutbox')
    const res = await real.submitDoorReceipt({
      orderId: 'o1',
      orderLabel: 'PO-1',
      restaurantId: 'rest-A',
      body: { countedQty: 1, countedUom: 'case', idempotencyKey: 'door:o1:t' },
    } as Parameters<typeof real.submitDoorReceipt>[0])
    expect(res.synced).toBe(true)
    expect(res.factTime).toEqual(factTime)
  })
})

/**
 * F-711. A 404 from the order read is the gateway saying "no such order in
 * this house" — another house's, removed, or mistyped. It used to read as a
 * network blip: the porter photographed the paper (filed under that order
 * id), counted, signed, and only the seal refused.
 */
describe('DoorNext — an order that is not in this house stops before the count', () => {
  const notFound = () => Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } })

  it('[REVERT-FAILS] names the house and offers no count, no photo', async () => {
    getOrder.mockRejectedValue(notFound())
    renderPage()
    await waitFor(() =>
      expect(document.querySelector('[data-ux-key="door:order-missing"]')).not.toBeNull(),
    )
    expect(screen.getByText(/This order is not in Meyhane Kadıköy/)).toBeTruthy()
    expect(document.querySelector('[data-ux-key="door:photo"]')).toBeNull()
    expect(document.querySelector('[data-ux-key="door:skip-photo"]')).toBeNull()
    expect(document.querySelector('[data-ux-key="door:cases"]')).toBeNull()
  })

  it('[REVERT-FAILS] stops even when the porter had already skipped to the count', async () => {
    let refuse!: (e: unknown) => void
    getOrder.mockReturnValue(new Promise((_, reject) => { refuse = reject }))
    renderPage()
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    expect(document.querySelector('[data-ux-key="door:initials"]')).not.toBeNull()
    await act(async () => refuse(notFound()))
    expect(document.querySelector('[data-ux-key="door:initials"]')).toBeNull()
    expect(document.querySelector('[data-ux-key="door:order-missing"]')).not.toBeNull()
  })

  it('a network failure is still a blip — the count stands on its own', async () => {
    getOrder.mockRejectedValue(new Error('Network Error'))
    renderPage()
    await waitFor(() =>
      expect((document.querySelector('[data-ux-key="door:photo"]') as HTMLButtonElement)?.disabled).toBe(false),
    )
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    expect(screen.getByText(/The order could not be reached/)).toBeTruthy()
    expect(document.querySelector('[data-ux-key="door:order-missing"]')).toBeNull()
  })

  it('[REVERT-FAILS] does not send the paper before the order is found', async () => {
    getOrder.mockReturnValue(new Promise(() => {}))
    renderPage()
    const photo = document.querySelector('[data-ux-key="door:photo"]') as HTMLButtonElement
    expect(photo.disabled).toBe(true)
    expect(photo.textContent).toContain('Finding the order')
  })

  it('[REVERT-FAILS] does not file the paper under an order it could not check', async () => {
    getOrder.mockRejectedValue(new Error('Network Error'))
    renderPage()
    await waitFor(() =>
      expect((document.querySelector('[data-ux-key="door:photo"]') as HTMLButtonElement)?.disabled).toBe(false),
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'paper.jpg', { type: 'image/jpeg' })] } })
    })
    expect(uploadDocument).not.toHaveBeenCalled()
    expect(screen.getByText(/this photo is not sent/)).toBeTruthy()
  })
})

/** F-712. A refresh or a swipe-back mid-count used to drop everything. */
describe('DoorNext — the count survives a refresh', () => {
  it('[REVERT-FAILS] brings back the count, the initials and the seal key for this house and order', async () => {
    const first = renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
    first.unmount()

    renderPage()
    expect((document.querySelector('[data-ux-key="door:initials"]') as HTMLInputElement).value).toBe('AK')
    const kept = JSON.parse(sessionStorage.getItem('mdv:door-draft:rest-A:o1') as string)
    expect(kept.idem).toBe('door:o1:test')
  })

  it('[REVERT-FAILS] asks before a reload while the count is open, and forgets it once recorded', async () => {
    submitDoorReceipt.mockResolvedValue({ synced: true, stockBooked: true })
    renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)

    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
    const seal = screen.getByRole('button', { name: 'Hold to seal — 1 box in' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    await waitFor(() =>
      expect(document.querySelector('[data-ux-key="door:finish"]')).not.toBeNull(),
    )
    expect(sessionStorage.getItem('mdv:door-draft:rest-A:o1')).toBeNull()
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})

/* F-744, F-745, F-747 — what the photograph is allowed to do to the count. */
describe('DoorNext — the paper is a reading, not a count', () => {
  const order = { orderNumber: 'PO-0042', wineName: 'SYNTHETIC Yakut', quantity: 3, unitType: 'cases' }

  const photograph = async () => {
    renderPage()
    await waitFor(() =>
      expect((document.querySelector('[data-ux-key="door:photo"]') as HTMLButtonElement)?.disabled).toBe(false),
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'paper.jpg', { type: 'image/jpeg' })] } })
    })
    await waitFor(() => expect(uploadDocument).toHaveBeenCalled())
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
  }
  const sealOf = (name: RegExp) => screen.getByRole('button', { name })

  beforeEach(() => {
    getOrder.mockResolvedValue(order)
  })

  it('[REVERT-FAILS] pre-fills a clean delivery paper, then waits for a person to stand by it', async () => {
    uploadDocument.mockResolvedValue({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'invoice', docNumber: 'INV-7', lines: [{ qty: 3, uom: 'case' }], warningCount: 0 },
    })
    await photograph()
    await waitFor(() => expect(screen.getByText(/The paper reads 3 boxes\. Count them/)).toBeTruthy())
    expect(sealOf(/Hold to seal — 3 boxes in/).getAttribute('aria-disabled')).toBe('true')

    fireEvent.click(document.querySelector('[data-ux-key="door:confirm-paper-count"]') as Element)
    expect(document.querySelector('[data-ux-key="door:confirm-paper-count"]')).toBeNull()
    expect(sealOf(/Hold to seal — 3 boxes in/).getAttribute('aria-disabled')).toBe('false')
  })

  it('[REVERT-FAILS] shows a credit note\'s number as a hint and leaves the count alone', async () => {
    uploadDocument.mockResolvedValue({
      documentId: 'doc-1',
      duplicate: false,
      document: { docType: 'credit_memo', docNumber: 'CM-2', lines: [{ qty: 8, uom: 'case' }] },
    })
    await photograph()
    await waitFor(() =>
      expect(screen.getByText(/may read 8 boxes, but this is not a delivery paper — count them yourself/)).toBeTruthy(),
    )
    // The count stays the porter's 1 (so the order reads short), and the seal is free.
    expect(sealOf(/Hold to seal — short-shipped/).getAttribute('aria-disabled')).toBe('false')
    expect(document.querySelector('[data-ux-key="door:confirm-paper-count"]')).toBeNull()
  })

  it('[REVERT-FAILS] says a paper for another order was not filed here, and claims no attachment', async () => {
    uploadDocument.mockResolvedValue({
      documentId: 'doc-9',
      duplicate: false,
      document: { docType: 'invoice', docNumber: 'INV-9', lines: [{ qty: 5, uom: 'case' }] },
      orderLink: {
        orderId: 'o1',
        linked: false,
        conflict: 'This paper prints order PO-0043, not PO-0042, so it was not filed to PO-0042. Check which delivery it came with.',
      },
    })
    await photograph()
    await waitFor(() => expect(screen.getByText(/prints order PO-0043, not PO-0042/)).toBeTruthy())
    expect(screen.queryByText(/Paper attached/)).toBeNull()
    // Nothing from it reaches the count.
    expect(sealOf(/Hold to seal — short-shipped/).getAttribute('aria-disabled')).toBe('false')
  })

  it('[REVERT-FAILS] says a paper already on file is now filed to this order, and uses its first reading', async () => {
    uploadDocument.mockResolvedValue({
      documentId: 'doc-first',
      duplicate: true,
      document: { docType: 'invoice', docNumber: 'INV-7', lines: [{ qty: 3, uom: 'case' }] },
      orderLink: { orderId: 'o1', linked: true, conflict: null },
    })
    await photograph()
    await waitFor(() =>
      expect(screen.getByText(/This paper is already on file, now filed to PO-0042\. The paper reads 3 boxes/)).toBeTruthy(),
    )
    expect(screen.queryByText(/nothing legible/)).toBeNull()
  })
})

/**
 * F-813, on the door screen: the same split order the staff lane test holds
 * (2 boxes of 12; truck one brought a box with one bottle broken and refused).
 * The lane says 12 bottles still to come; the door must agree that the one box
 * on this truck completes the order, and send one box as expected.
 */
describe('DoorNext — a bottle refused on an earlier truck is not still owed (F-813)', () => {
  it('[REVERT-FAILS] calls the second truck all there and expects one box of it', async () => {
    const { getOrder } = await import('@/services/api/orders')
    const { receivingApi } = await import('@/services/api/receiving')
    vi.mocked(getOrder).mockResolvedValueOnce({
      id: 'o1',
      orderNumber: 'ORD-1',
      wineName: 'Barolo',
      quantity: 2,
      unitType: 'case',
      bottlesTotal: 24,
    } as never)
    vi.mocked(receivingApi.doorReceivedSoFar).mockResolvedValueOnce({
      receivedQtyBottles: 11,
      packSize: 12,
      receivedBoxes: 0,
      receivedLooseBottles: 11,
      doorEventCount: 1,
      received: { readable: true, rejectedAtDoorBottles: 1, rejectedAtDeskBottles: null },
    })
    submitDoorReceipt.mockResolvedValue({ synced: true, stockBooked: true })
    renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)

    await waitFor(() =>
      expect(document.querySelector('[data-ux-key="door:match"]')?.textContent).toBe(
        '1 box + 11 bottles of 2 with the earlier 11 bottles, 1 bottle refused earlier — all there.',
      ),
    )
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
    const seal = screen.getByRole('button', { name: 'Hold to seal — 1 box in' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    await waitFor(() => expect(submitDoorReceipt).toHaveBeenCalled())
    expect(submitDoorReceipt.mock.calls[0][0].body.expectedQtyInCountedUom).toBe(1)
  })
})

describe('F-247 — a delivery already counted on this phone is not counted twice', () => {
  const onPhoneNote = () => document.querySelector('[data-ux-key="door:already-on-phone"]')
  const trySeal = async () => {
    renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
    const seal = screen.getByRole('button', { name: /Hold to seal/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })
  }

  it('[REVERT-FAILS] says so, and does not seal a second receipt with a new key', async () => {
    queuedDoorReceiptFor.mockResolvedValue({ id: 'm1', idempotencyKey: 'door:o1:first', parked: false })
    submitDoorReceipt.mockResolvedValue({ synced: false })
    await trySeal()
    await waitFor(() => expect(onPhoneNote()).not.toBeNull())
    expect(onPhoneNote()?.textContent).toContain('already counted on this phone')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(submitDoorReceipt).not.toHaveBeenCalled()
  })

  it('sends Receiving the way for one that was not sent', async () => {
    queuedDoorReceiptFor.mockResolvedValue({ id: 'm1', idempotencyKey: 'door:o1:first', parked: true })
    renderPage()
    await waitFor(() => expect(onPhoneNote()).not.toBeNull())
    expect(onPhoneNote()?.textContent).toContain('Open Receiving')
  })

  it('seals as before when nothing for this order is on the phone', async () => {
    submitDoorReceipt.mockResolvedValue({ synced: true, stockBooked: true })
    await trySeal()
    await waitFor(() => expect(submitDoorReceipt).toHaveBeenCalled())
    expect(onPhoneNote()).toBeNull()
  })
})

describe('queuedDoorReceiptFor — reads the queue entry for one order', () => {
  it('[REVERT-FAILS] returns that entry and its key, and null for another order', async () => {
    const offline = await import('@/lib/offline-storage')
    const spy = vi
      .spyOn(offline.offlineStorage, 'getPendingMutationsByType')
      .mockResolvedValue([
        {
          id: 'm1',
          type: 'receiving.door',
          data: { orderId: 'o1', orderLabel: 'PO-1', restaurantId: 'rest-A', body: { idempotencyKey: 'door:o1:first' } },
          timestamp: new Date(),
          retryCount: 0,
        },
      ] as never)
    const real = await vi.importActual<typeof import('@/lib/doorOutbox')>('@/lib/doorOutbox')
    expect(await real.queuedDoorReceiptFor('o1')).toEqual({
      id: 'm1',
      idempotencyKey: 'door:o1:first',
      parked: false,
    })
    expect(await real.queuedDoorReceiptFor('o2')).toBeNull()
    expect([...(await real.queuedDoorOrderIds())]).toEqual(['o1'])
    spy.mockRestore()
  })
})

describe('F-1022 — the broken boxes are some of the boxes delivered', () => {
  const tap = (name: string, times = 1) => {
    for (let i = 0; i < times; i++) fireEvent.click(screen.getByRole('button', { name }))
  }
  const brokenShown = () =>
    document.querySelector('[data-ux-key="door:damaged"] [aria-live]')?.textContent

  it('[REVERT-FAILS] says boxes, stops at the count, follows a lowered count, and seals "N in, M broken"', async () => {
    renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })

    // One box delivered: the second tap on broken does nothing.
    tap('Increase Boxes visibly broken', 2)
    expect(brokenShown()).toBe('1')

    tap('Increase Boxes delivered', 2)
    tap('Increase Boxes visibly broken')
    expect(brokenShown()).toBe('2')
    expect(screen.getByRole('button', { name: 'Hold to seal — 1 in, 2 broken' })).toBeTruthy()

    // Lowering the delivered count takes the broken count down with it.
    tap('Decrease Boxes delivered', 2)
    await waitFor(() => expect(brokenShown()).toBe('1'))
    expect(screen.getByRole('button', { name: 'Hold to seal — 0 in, 1 broken' })).toBeTruthy()
  })
})

/**
 * F-1076. The door took the key of a receipt already on the phone; once that
 * receipt sent, the key was spent. The next truck sealed with it reached the
 * server as a resend of the first, came back "already recorded", and booked
 * nothing — while the porter saw "done".
 */
describe('F-1076 — the next truck gets its own key once the last one has sent', () => {
  const sealNow = async () => {
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
    const seal = screen.getByRole('button', { name: /Hold to seal/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })
  }
  const onPhoneNote = () => document.querySelector('[data-ux-key="door:already-on-phone"]')

  it('[REVERT-FAILS] seals the second truck with a new key, not the first one\'s', async () => {
    queuedDoorReceiptFor.mockResolvedValue({ id: 'm1', idempotencyKey: 'door:o1:first', parked: false })
    submitDoorReceipt.mockResolvedValue({ synced: true, stockBooked: true })
    renderPage()
    await waitFor(() => expect(onPhoneNote()).not.toBeNull())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)

    // Truck one sends; the phone is empty again. Truck two is at the door.
    newIdempotencyKey.mockReturnValue('door:o1:second')
    queuedDoorReceiptFor.mockResolvedValue(null)
    await flushAgain({ sent: 1, failed: 0, parked: 0 })
    await waitFor(() => expect(onPhoneNote()).toBeNull())
    await sealNow()
    await waitFor(() => expect(submitDoorReceipt).toHaveBeenCalledTimes(1))
    expect(submitDoorReceipt.mock.calls[0][0].body.idempotencyKey).toBe('door:o1:second')
    const kept = sessionStorage.getItem('mdv:door-draft:rest-A:o1')
    // Recorded, so the draft is gone; no spent key is left behind for a reload.
    expect(kept).toBeNull()
  })

  it('[REVERT-FAILS] does not bring a spent key back from the kept count after a reload', async () => {
    queuedDoorReceiptFor.mockResolvedValue({ id: 'm1', idempotencyKey: 'door:o1:first', parked: false })
    const first = renderPage()
    await waitFor(() => expect(onPhoneNote()).not.toBeNull())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem('mdv:door-draft:rest-A:o1') as string).idem).toBe(
        'door:o1:first',
      ),
    )
    first.unmount()

    // The first truck sent while the page was closed.
    newIdempotencyKey.mockReturnValue('door:o1:second')
    queuedDoorReceiptFor.mockResolvedValue(null)
    submitDoorReceipt.mockResolvedValue({ synced: true, stockBooked: true })
    renderPage()
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem('mdv:door-draft:rest-A:o1') as string).idem).toBe(
        'door:o1:second',
      ),
    )
    await sealNow()
    await waitFor(() => expect(submitDoorReceipt).toHaveBeenCalledTimes(1))
    expect(submitDoorReceipt.mock.calls[0][0].body.idempotencyKey).toBe('door:o1:second')
  })

  it('keeps the same key for a true retry of the same delivery', async () => {
    submitDoorReceipt
      .mockRejectedValueOnce(new Error('Could not reach the office.'))
      .mockResolvedValueOnce({ synced: true, stockBooked: true, alreadyRecorded: true })
    renderPage()
    await waitFor(() => expect(flushDoorOutbox).toHaveBeenCalled())
    fireEvent.click(document.querySelector('[data-ux-key="door:skip-photo"]') as Element)
    newIdempotencyKey.mockReturnValue('door:o1:other')
    await sealNow()
    await waitFor(() => expect(submitDoorReceipt).toHaveBeenCalledTimes(1))
    await flushAgain({ sent: 0, failed: 0, parked: 0 })
    const seal = await screen.findByRole('button', { name: /Hold to seal/ })
    fireEvent.keyDown(seal, { key: 'Enter' })
    fireEvent.keyDown(seal, { key: 'Enter' })
    await waitFor(() => expect(submitDoorReceipt).toHaveBeenCalledTimes(2))
    expect(submitDoorReceipt.mock.calls[1][0].body.idempotencyKey).toBe(
      submitDoorReceipt.mock.calls[0][0].body.idempotencyKey,
    )
    expect(submitDoorReceipt.mock.calls[0][0].body.idempotencyKey).toBe('door:o1:test')
    // The server had it already: the porter is told nothing was added twice.
    await waitFor(() =>
      expect(document.querySelector('[data-ux-key="door:already-recorded"]')).not.toBeNull(),
    )
  })
})

/**
 * F-1126: "Mark delivered" on /orders no longer books every ordered bottle in
 * one tap. It opens this screen with `?count=ordered`, and the count starts at
 * what the order still expects — held, like the paper's number, until a person
 * stands by it or changes it. Without the parameter the door is unchanged.
 */
describe('F-1126 — the door opened from /orders starts at the ordered boxes', () => {
  const order = { orderNumber: 'PO-0042', wineName: 'SYNTHETIC Yakut', quantity: 3, unitType: 'cases' }
  const open = async (path: string) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <DoorNext />
      </MemoryRouter>,
    )
    await waitFor(() => expect(getOrder).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'No paper with this delivery' }))
    fireEvent.change(document.querySelector('[data-ux-key="door:initials"]') as Element, {
      target: { value: 'AK' },
    })
  }

  beforeEach(() => {
    getOrder.mockResolvedValue(order)
  })

  it('[REVERT-FAILS] fills in the ordered boxes and books nothing until a person confirms', async () => {
    await open('/receiving/o1/door?count=ordered')
    await waitFor(() =>
      expect(screen.getByText(/Filled in with what was ordered: 3 boxes\. Count them/)).toBeTruthy(),
    )
    const seal = () => screen.getByRole('button', { name: /Hold to seal — 3 boxes in/ })
    expect(seal().getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(document.querySelector('[data-ux-key="door:confirm-paper-count"]') as Element)
    expect(seal().getAttribute('aria-disabled')).toBe('false')
    expect(submitDoorReceipt).not.toHaveBeenCalled()
  })

  it('leaves the count alone when the door is opened from anywhere else', async () => {
    await open('/receiving/o1/door')
    await screen.findByRole('button', { name: /Hold to seal/ })
    expect(screen.queryByText(/Filled in with what was ordered/)).toBeNull()
    expect(document.querySelector('[data-ux-key="door:confirm-paper-count"]')).toBeNull()
  })
})
