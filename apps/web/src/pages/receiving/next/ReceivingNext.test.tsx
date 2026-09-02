import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RcStaffLane } from './RcStaffLane'
import { RcManagerQueue } from './RcManagerQueue'
import { RcOwnerLedger } from './RcOwnerLedger'
import { RcOutboxRail } from './RcOutboxRail'
import {
  useStaffDeliveries,
  useManagerQueue,
  useOwnerRecovery,
  useDoorOutbox,
} from './useReceivingNextData'

/**
 * The honesty defects on the rebuilt /receiving, pinned.
 *
 * Every case here fails against the pre-fix tree, and each names the specific
 * untruth it forbids:
 *
 *   F1  `quantity` is denominated in `unit_type`, so rendering it as bottles
 *       told a receiver a five-CASE order was five bottles — ADR 0054's
 *       arithmetic, reintroduced in the view model.
 *   F3  one global localStorage key meant a receipt dropped under restaurant A
 *       rendered as a role="alert" under restaurant B.
 *   F4  an offline non-attempt was stamped as a clean sync, contradicting the
 *       rail's own "offline — holding" header two lines above.
 *   F5  ADR 0051 clause 2 — a windowed figure renders as a floor. There was not
 *       one `≥` on the page.
 *   F6  a measured $0 and an absent figure both rendered as an em dash.
 *   F7  the uncounted safety net went silent exactly when its query failed.
 *   F8  403 was indistinguishable from 500 and the message was never printed.
 *   F9  the credited-list failure was honest only by accident.
 *   F10 the settlement rate sat under "They refused", a population it does not
 *       describe.
 */

const get = vi.hoisted(() => vi.fn())
vi.mock('../../../services/api/client', () => ({ apiClient: { get } }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const activeRestaurantId = vi.hoisted(() => ({ current: 'rest-A' }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: activeRestaurantId.current,
    user: { userId: 'u1', restaurantId: activeRestaurantId.current, role: 'manager' },
  }),
}))

const pendingByType = vi.hoisted(() => vi.fn())
const flushDoorOutbox = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/offline-storage', () => ({
  offlineStorage: {
    getPendingMutationsByType: pendingByType,
    removePendingMutation: vi.fn(),
    updatePendingMutation: vi.fn(),
  },
}))
vi.mock('../../../lib/doorOutbox', () => ({ flushDoorOutbox }))

/** `GET /procurement/orders` returns `OrderListResponseDto` — `orders`, plus `total`/`hasMore`. */
const orderList = (orders: unknown[], over: Record<string, unknown> = {}) => ({
  data: { orders, total: orders.length, page: 1, limit: 25, hasMore: false, ...over },
})

function harness(Body: () => JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Body />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const StaffBody = () => <RcStaffLane data={useStaffDeliveries()} />
const ManagerBody = () => <RcManagerQueue data={useManagerQueue()} />
const OwnerBody = () => <RcOwnerLedger data={useOwnerRecovery()} />
const OutboxBody = () => <RcOutboxRail data={useDoorOutbox()} />

/** Serve rows under one status only — an order holds exactly one. */
const onlyForStatus =
  (status: string, orders: unknown[], over: Record<string, unknown> = {}) =>
  async (_url: string, config: any) =>
    config?.params?.status === status ? orderList(orders, over) : orderList([])

const httpError = (status: number, message = 'request failed') =>
  Object.assign(new Error(message), { response: { status } })

const queuePayload = (over: Record<string, unknown> = {}) => ({
  data: { items: [], unverified: [], totalAtRisk: 0, ...over },
})

const queueItem = (over: Record<string, unknown> = {}) => ({
  orderId: 'ord-1',
  orderNumber: 'PO-1',
  verdict: 'qty_short',
  summary: 'Two bottles short',
  backorderQty: 0,
  verifiedAt: '2026-08-30T09:00:00.000Z',
  dollarsAtRisk: 120,
  selfEvidenced: false,
  openClaims: 1,
  ...over,
})

beforeEach(() => {
  get.mockReset()
  navigate.mockReset()
  pendingByType.mockReset().mockResolvedValue([])
  flushDoorOutbox.mockReset().mockResolvedValue({ sent: 0, failed: 0 })
  activeRestaurantId.current = 'rest-A'
  window.localStorage.clear()
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(() => {
  window.localStorage.clear()
})

/* ═══════════════════════════════════════════ F1 — the unit of the count ══ */

describe('F1 — the door counts bottles, and the order is not denominated in them', () => {
  it('renders the server-computed bottle total, never the raw quantity', async () => {
    get.mockImplementation(
      onlyForStatus('IN_TRANSIT', [
        {
          id: 'ord-case',
          orderNumber: 'PO-CASE',
          quantity: 5,
          unitType: 'case',
          bottlesTotal: 60,
          wineName: 'Produttori Barbaresco',
        },
      ]),
    )
    harness(StaffBody)

    expect(await screen.findByText(/60 bottles expected/)).toBeInTheDocument()
    // The pre-fix render. Five CASES on a pallet is not five bottles, and a
    // receiver who counts to five and signs has just accepted 55 missing.
    expect(screen.queryByText(/5 bottles expected/)).not.toBeInTheDocument()
  })

  it('says the ordered quantity in its own unit when the bottle total is absent', async () => {
    get.mockImplementation(
      onlyForStatus('CONFIRMED', [
        { id: 'ord-x', orderNumber: 'PO-X', quantity: 5, unitType: 'case', wineName: 'Chablis' },
      ]),
    )
    harness(StaffBody)

    // Never a guess at pack size — the em dash, plus what was actually ordered.
    expect(await screen.findByText(/5 cases ordered · bottles —/)).toBeInTheDocument()
    expect(screen.queryByText(/bottles expected/)).not.toBeInTheDocument()
  })

  it('shows an unrecognised unit verbatim rather than folding it into bottles', async () => {
    get.mockImplementation(
      onlyForStatus('CONFIRMED', [
        { id: 'ord-k', orderNumber: 'PO-K', quantity: 2, unitType: 'keg', wineName: 'Pét-nat' },
      ]),
    )
    harness(StaffBody)
    expect(await screen.findByText(/2 kegs ordered · bottles —/)).toBeInTheDocument()
  })
})

/* ══════════════════════════════════════════════════ F2 — the distributor ══ */

describe('F2 — the vendor slot never passes the wine off as a distributor', () => {
  it('announces the fallback when the gateway names no provider', async () => {
    get.mockImplementation(
      onlyForStatus('CONFIRMED', [
        { id: 'o1', orderNumber: 'PO-1', bottlesTotal: 6, wineName: 'Chablis', providerId: 'prov-1234abcd' },
      ]),
    )
    harness(StaffBody)

    expect(await screen.findByText(/Distributor not named by the gateway/)).toBeInTheDocument()
    expect(screen.getByText(/vendor ref prov-123/)).toBeInTheDocument()
  })

  it('uses the provider name the moment the gateway emits one, under either spelling', async () => {
    get.mockImplementation(
      onlyForStatus('CONFIRMED', [
        { id: 'o1', orderNumber: 'PO-1', bottlesTotal: 6, wineName: 'Chablis', providerName: 'Skurnik' },
      ]),
    )
    harness(StaffBody)

    expect(await screen.findByText('Skurnik')).toBeInTheDocument()
    expect(screen.queryByText(/Distributor not named/)).not.toBeInTheDocument()
  })
})

/* ═══════════════════════════════════════ F3 — the outbox is tenant-scoped ══ */

describe('F3 — a dropped receipt does not follow the tablet into another restaurant', () => {
  const pinFor = (rid: string) => `mudavym.receiving.outboxDrops.${rid}`
  const drop = {
    id: 'drop-1',
    label: 'PO-SECRET · Restaurant A',
    droppedAt: '2026-08-30T14:00:00.000Z',
    exact: true,
  }

  it('renders a pin stored under the active restaurant', async () => {
    window.localStorage.setItem(pinFor('rest-A'), JSON.stringify([drop]))
    harness(OutboxBody)
    expect(await screen.findByText('PO-SECRET · Restaurant A')).toBeInTheDocument()
  })

  it('does NOT render restaurant A’s pin while restaurant B is active', async () => {
    window.localStorage.setItem(pinFor('rest-A'), JSON.stringify([drop]))
    activeRestaurantId.current = 'rest-B'

    harness(OutboxBody)
    await screen.findByText(/Nothing queued on this device/)

    // The pre-fix key was global, so this receipt's label and its order-id
    // prefix rendered as a role="alert" to a tenant with no right to either.
    expect(screen.queryByText('PO-SECRET · Restaurant A')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('writes a new pin under the scoped key, not the global one', async () => {
    pendingByType
      .mockResolvedValueOnce([{ id: 'm1', type: 'receiving.door', data: { orderId: 'ord-9', orderLabel: 'PO-9' }, timestamp: new Date(), retryCount: 7 }])
      .mockResolvedValueOnce([{ id: 'm1', type: 'receiving.door', data: { orderId: 'ord-9', orderLabel: 'PO-9' }, timestamp: new Date(), retryCount: 7 }])
      .mockResolvedValue([])
    flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 1 })

    harness(OutboxBody)
    await waitFor(() => expect(window.localStorage.getItem(pinFor('rest-A'))).toBeTruthy())
    expect(window.localStorage.getItem('mudavym.receiving.outboxDrops')).toBeNull()
  })

  it('adopts a pre-scoping pin rather than discarding it, and does not claim it', async () => {
    // Losing a pinned drop is the inv-09 defect this rail exists to fix, so
    // the migration keeps it — marked, because its restaurant was never recorded.
    window.localStorage.setItem('mudavym.receiving.outboxDrops', JSON.stringify([drop]))
    harness(OutboxBody)

    expect(await screen.findByText('PO-SECRET · Restaurant A')).toBeInTheDocument()
    expect(
      screen.getByText(/without being claimed as this restaurant's/),
    ).toBeInTheDocument()
    // Moved, not copied — otherwise it fans out to every tenant that opens the page.
    expect(window.localStorage.getItem('mudavym.receiving.outboxDrops')).toBeNull()
  })
})

/* ══════════════════════════════════════ F4 — a non-attempt is not a sync ══ */

describe('F4 — an offline non-attempt does not render as a clean sync', () => {
  it('says it is holding, and never prints a sent/failed tally it did not measure', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    harness(OutboxBody)

    expect(await screen.findByText(/no sync attempted — offline/)).toBeInTheDocument()
    // The pre-fix line, printed directly under a header reading "offline — holding".
    expect(screen.queryByText(/sent 0 · failed 0/)).not.toBeInTheDocument()
    expect(screen.getByText('offline — holding')).toBeInTheDocument()
  })

  it('still reports a real flush that found nothing to send', async () => {
    pendingByType.mockResolvedValue([])
    flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 0 })
    harness(OutboxBody)

    expect(await screen.findByText(/last sync .* · sent 0 · failed 0/)).toBeInTheDocument()
  })

  it('catches the race: a queue that returned 0+0 cannot have been walked', async () => {
    // doorOutbox iterates the pending queue and every iteration increments
    // exactly one of sent/failed, so a non-empty queue returning 0+0 proves the
    // early return fired — even if navigator flipped after our own check.
    pendingByType.mockResolvedValue([
      { id: 'm1', type: 'receiving.door', data: { orderId: 'o', orderLabel: 'PO-1' }, timestamp: new Date(), retryCount: 0 },
    ])
    flushDoorOutbox.mockResolvedValue({ sent: 0, failed: 0 })
    harness(OutboxBody)

    expect(await screen.findByText(/no sync attempted — offline/)).toBeInTheDocument()
  })
})

/* ════════════════════════════════════════ F5 — windowed figures are floors ══ */

describe('F5 — a windowed figure renders as a floor (ADR 0051 clause 2)', () => {
  it('uses the gateway’s exact total for the staff count instead of the page length', async () => {
    // 25 rows come back per status but the gateway knows there are 40. The page
    // used to render `deliveries.length` — a page size dressed as a total.
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `o${i}`,
      orderNumber: `PO-${i}`,
      bottlesTotal: 6,
      wineName: 'Chablis',
    }))
    get.mockImplementation(onlyForStatus('CONFIRMED', rows, { total: 40, hasMore: true }))
    harness(StaffBody)

    expect(await screen.findByText(/40 out for delivery/)).toBeInTheDocument()
    expect(screen.getByText(/25 shown/)).toBeInTheDocument()
    expect(screen.queryByText(/^25 out for delivery/)).not.toBeInTheDocument()
  })

  it('marks the lane counts and the at-risk total as floors when the queue window is full', async () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      queueItem({ orderId: `ord-${i}`, orderNumber: `PO-${i}` }),
    )
    get.mockResolvedValue(queuePayload({ items, totalAtRisk: 12000 }))
    harness(ManagerBody)

    expect(await screen.findByText('≥$12,000')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Short/ })).toHaveTextContent('≥100')
  })

  it('does not mark a lane count as a floor when the window came back short', async () => {
    get.mockResolvedValue(queuePayload({ items: [queueItem()], totalAtRisk: 120 }))
    harness(ManagerBody)

    expect(await screen.findByText('$120')).toBeInTheDocument()
    const short = screen.getByRole('tab', { name: /Short/ })
    expect(short).toHaveTextContent('1')
    expect(short).not.toHaveTextContent('≥1')
  })

  it('marks the uncounted strip as a floor — it is built behind a 500-row window', async () => {
    get.mockResolvedValue(
      queuePayload({
        unverified: [
          { orderId: 'u1', orderNumber: 'PO-U', countedQtyBottles: 6, countedAt: '2026-08-29T00:00:00.000Z', ageHours: 30, severity: 'stale' },
        ],
      }),
    )
    harness(ManagerBody)
    expect(await screen.findByText('≥1')).toBeInTheDocument()
  })

  it('marks every owner figure as a floor — stats read at most 5000 unordered rows', async () => {
    get.mockImplementation(async (url: string) =>
      url.endsWith('/stats')
        ? {
            data: {
              recovered: 900, outstanding: 400, promised: 100, rejected: 250,
              openClaims: 3, oldestOpenDays: 12, settlementRate: 0.5, selfEvidencedOpen: 0,
            },
          }
        : { data: { items: [] } },
    )
    harness(OwnerBody)

    expect(await screen.findByText('≥$900')).toBeInTheDocument()
    expect(screen.getByText('≥$400.00')).toBeInTheDocument()
    expect(screen.getByText('≥$250.00')).toBeInTheDocument()
    expect(screen.getByText(/≥3 open claims/)).toBeInTheDocument()
  })
})

/* ═════════════════════════════ F6 — a measured zero is not an unknown ══ */

describe('F6 — $0 measured and $— unknown are different facts', () => {
  it('renders a measured zero as $0, not as an em dash', async () => {
    get.mockResolvedValue(
      queuePayload({ items: [queueItem({ dollarsAtRisk: 0, openClaims: 0 })], totalAtRisk: 0 }),
    )
    harness(ManagerBody)

    // Pre-fix: `dollarsAtRisk > 0 ? money : EM` printed "$—" beside a literal
    // "0 open claims" — one row reading "$— · 0 open claims".
    expect(await screen.findByText('$0')).toBeInTheDocument()
  })

  it('renders an absent figure as an em dash', async () => {
    get.mockResolvedValue(
      queuePayload({ items: [queueItem({ dollarsAtRisk: null })], totalAtRisk: 0 }),
    )
    harness(ManagerBody)
    await screen.findByRole('tab', { name: /Short/ })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('marks the open-claim count as a floor — the link query is capped and unordered', async () => {
    get.mockResolvedValue(queuePayload({ items: [queueItem({ openClaims: 2 })], totalAtRisk: 120 }))
    harness(ManagerBody)

    await screen.findByText('$120')
    expect(screen.getByText(/≥2 open claims/)).toBeInTheDocument()
  })
})

/* ═══════════════════════════════ F7 — the safety net says "unknown" ══ */

describe('F7 — an uncounted list that did not load is not "nothing uncounted"', () => {
  it('renders the unknown state in words when the queue fails', async () => {
    get.mockRejectedValue(httpError(500, 'boom'))
    harness(ManagerBody)

    expect(await screen.findByText(/the uncounted list did not load/i)).toBeInTheDocument()
    expect(screen.getByText(/This is not a report of zero/)).toBeInTheDocument()
  })

  it('stays silent for a measured zero', async () => {
    get.mockResolvedValue(queuePayload({ unverified: [] }))
    harness(ManagerBody)

    await screen.findByRole('tab', { name: /Short/ })
    expect(screen.queryByText(/the uncounted list did not load/i)).not.toBeInTheDocument()
  })
})

/* ═════════════════════════════════ F8 — "not permitted" is a state ══ */

describe('F8 — a refusal is not an outage, on all three renderings', () => {
  it('staff: names the permission, drops the retry, prints the status', async () => {
    get.mockRejectedValue(httpError(403, 'Forbidden resource'))
    harness(StaffBody)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not permitted/i)
    expect(alert).toHaveTextContent('HTTP 403')
    expect(alert).toHaveTextContent('Forbidden resource')
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
    // The prose that must survive: a 500 still sends them to the paper record.
    expect(alert).toHaveTextContent(/write the delivery down on paper/i)
  })

  it('staff: a 500 keeps the original sentence and the retry', async () => {
    get.mockRejectedValue(httpError(500, 'Internal error'))
    harness(StaffBody)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Could not load today's deliveries.")
    expect(alert).toHaveTextContent('there may well be a truck outside')
    expect(alert).toHaveTextContent('HTTP 500')
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('manager: distinguishes 403 from 500 and surfaces the message', async () => {
    get.mockRejectedValue(httpError(403, 'Forbidden resource'))
    harness(ManagerBody)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not permitted/i)
    expect(alert).toHaveTextContent('HTTP 403')
  })

  it('owner: distinguishes 403 from 500 and surfaces the message', async () => {
    get.mockRejectedValue(httpError(403, 'Forbidden resource'))
    harness(OwnerBody)

    const alerts = await screen.findAllByRole('alert')
    const text = alerts.map((a) => a.textContent ?? '').join(' ')
    expect(text).toMatch(/not permitted/i)
    expect(text).toContain('HTTP 403')
  })

  it('owner: a 500 prints the message it used to swallow', async () => {
    get.mockRejectedValue(httpError(500, 'Internal error'))
    harness(OwnerBody)

    const alerts = await screen.findAllByRole('alert')
    const text = alerts.map((a) => a.textContent ?? '').join(' ')
    expect(text).toContain('unknown, not zero')
    expect(text).toContain('HTTP 500')
    expect(text).toContain('Internal error')
  })
})

/* ═════════════════════ F9 — the credited-list failure is deliberate ══ */

describe('F9 — the trend says when it broke, instead of being honest by accident', () => {
  it('states the settled-claims failure while the headline figure stands', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith('/stats'))
        return {
          data: {
            recovered: 900, outstanding: 0, promised: 0, rejected: 0,
            openClaims: 0, oldestOpenDays: null, settlementRate: null, selfEvidencedOpen: 0,
          },
        }
      throw httpError(500, 'credits list down')
    })
    harness(OwnerBody)

    expect(await screen.findByText(/settled-claims list did not load/i)).toBeInTheDocument()
    expect(screen.getByText(/not zero, and not "nothing settled"/)).toBeInTheDocument()
    // The recovered figure comes from a different query and keeps its answer.
    expect(screen.getByText('≥$900')).toBeInTheDocument()
  })

  it('says nothing when the list simply came back empty', async () => {
    get.mockImplementation(async (url: string) =>
      url.endsWith('/stats')
        ? {
            data: {
              recovered: 0, outstanding: 0, promised: 0, rejected: 0,
              openClaims: 0, oldestOpenDays: null, settlementRate: null, selfEvidencedOpen: 0,
            },
          }
        : { data: { items: [] } },
    )
    harness(OwnerBody)

    await screen.findByText(/No discrepancies found yet/)
    expect(screen.queryByText(/settled-claims list did not load/i)).not.toBeInTheDocument()
  })
})

/* ════════════════════════════════ F10 — the hand-off and the population ══ */

describe('F10 — the hand-off carries the order, and the rate names its population', () => {
  it('passes the order id to /receipts, as its sibling does to /orders', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    get.mockResolvedValue(queuePayload({ items: [queueItem({ orderId: 'ord-42' })], totalAtRisk: 120 }))
    harness(ManagerBody)

    await userEvent.click(await screen.findByRole('button', { name: /PO-1/ }))
    await userEvent.click(screen.getByRole('button', { name: /Edit line items at the desk/ }))
    expect(navigate).toHaveBeenCalledWith('/receipts?order=ord-42')
  })

  it('does not put the settlement rate under "They refused"', async () => {
    get.mockImplementation(async (url: string) =>
      url.endsWith('/stats')
        ? {
            data: {
              recovered: 900, outstanding: 0, promised: 0, rejected: 250,
              openClaims: 0, oldestOpenDays: null, settlementRate: 0.5, selfEvidencedOpen: 0,
            },
          }
        : { data: { items: [] } },
    )
    harness(OwnerBody)

    // settlementRate is settled ÷ all RESOLVED claims. Correct number, wrong
    // population implied when it hangs off the refusals.
    const refused = (await screen.findByText('They refused')).closest('div')!
    expect(refused).not.toHaveTextContent('50%')
    expect(refused).toHaveTextContent('Asked for and turned down')
    expect(screen.getByText(/50% of resolved claims settled/)).toBeInTheDocument()
    expect(screen.getByText(/not a property of the refusals above/)).toBeInTheDocument()
  })
})
