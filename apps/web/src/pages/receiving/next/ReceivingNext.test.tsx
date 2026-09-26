import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
// `AuthContext` (the object, not just `useAuth`) is exported too — DayLine.tsx
// and useMudavymDesign.ts both read it with `useContext(AuthContext)` directly
// (see ReceivingHome.test.tsx's identical comment for the full reasoning).
vi.mock('../../../contexts/AuthContext', async () => {
  const { createContext } = await import('react')
  return {
    AuthContext: createContext<unknown>(null),
    useAuth: () => ({
      activeRestaurantId: activeRestaurantId.current,
      user: { userId: 'u1', restaurantId: activeRestaurantId.current, role: 'manager' },
    }),
  }
})

const pendingByType = vi.hoisted(() => vi.fn())
const flushDoorOutbox = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/offline-storage', () => ({
  offlineStorage: {
    getPendingMutationsByType: pendingByType,
    removePendingMutation: vi.fn(),
    updatePendingMutation: vi.fn(),
  },
}))
/**
 * Only the flush is stubbed. The drop store is the REAL one — it moved into
 * `lib/doorOutbox.ts` so a drop has exactly one home instead of three, and
 * these tests are about the keys the rail actually reads and writes.
 */
vi.mock('../../../lib/doorOutbox', async () => {
  const actual =
    await vi.importActual<typeof import('../../../lib/doorOutbox')>('../../../lib/doorOutbox')
  return { ...actual, flushDoorOutbox }
})

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

/** Mirrors the gateway's own per-currency grouping (receiving.service.ts
 * managerQueue) so a test only states `items` and gets an honest total for
 * free — never a single number invented across currencies. */
const totalAtRiskByCurrencyOf = (items: Array<Record<string, unknown>>) => {
  const byCcy = new Map<string, number>()
  for (const i of items) {
    if (i.dollarsAtRisk == null) continue
    const ccy = (i.currency as string | null | undefined) ?? ''
    byCcy.set(ccy, (byCcy.get(ccy) ?? 0) + (i.dollarsAtRisk as number))
  }
  return Array.from(byCcy, ([currency, amount]) => ({ currency: currency || null, amount }))
}

const queuePayload = (over: Record<string, unknown> = {}) => {
  const items = (over.items as Array<Record<string, unknown>> | undefined) ?? []
  return {
    data: {
      items,
      unverified: [],
      totalAtRiskByCurrency: totalAtRiskByCurrencyOf(items),
      ...over,
    },
  }
}

const queueItem = (over: Record<string, unknown> = {}) => ({
  orderId: 'ord-1',
  orderNumber: 'PO-1',
  verdict: 'qty_short',
  summary: 'Two bottles short',
  backorderBottles: 0,
  backorderWhy: null,
  verifiedAt: '2026-08-30T09:00:00.000Z',
  dollarsAtRisk: 120,
  selfEvidenced: false,
  openClaims: 1,
  ...over,
})

/**
 * Scopes a query to the page header's own "At risk" figure(s) — since a row
 * with the same dollar amount as the header total (the common case in a
 * single-item fixture) renders the identical text elsewhere on the page, a
 * bare `screen.getByText`/`findByText` is ambiguous once both have loaded.
 */
const atRiskHeader = () => within(screen.getByText('At risk').parentElement as HTMLElement)

beforeEach(() => {
  get.mockReset()
  navigate.mockReset()
  pendingByType.mockReset().mockResolvedValue([])
  flushDoorOutbox
    .mockReset()
    .mockResolvedValue({ sent: 0, failed: 0, dropped: 0, stranded: 0, unreachable: false })
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
    orderLabel: 'PO-SECRET · Restaurant A',
    droppedAt: '2026-08-30T14:00:00.000Z',
    reason: 'refused',
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

  it('writes back to the scoped key when a pin is dismissed, never the global one', async () => {
    // The flush is now the only thing that CREATES a pin (doorOutbox.test.ts
    // pins that it lands under the receiving house's key). What this side
    // still writes is the dismissal, and it must write to the same key.
    window.localStorage.setItem(pinFor('rest-A'), JSON.stringify([drop]))
    harness(OutboxBody)

    fireEvent.click(await screen.findByRole('button', { name: /Dismiss the dropped receipt/ }))

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(pinFor('rest-A')) ?? '[]')).toEqual([]),
    )
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
    flushDoorOutbox.mockResolvedValue({
      sent: 0,
      failed: 0,
      dropped: 0,
      stranded: 0,
      unreachable: false,
    })
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
    flushDoorOutbox.mockResolvedValue({
      sent: 0,
      failed: 0,
      dropped: 0,
      stranded: 0,
      unreachable: false,
    })
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

    // A full window is 100 rows, and the day line now mounts above them, so the
    // first paint of this case is the heaviest in the file. On a loaded CI runner
    // it crossed the 1000 ms default and the assertion read the pre-load em dash.
    expect(await screen.findByText('≥$12,000', undefined, { timeout: 15000 })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Short/ })).toHaveTextContent('≥100')
  })

  it('does not mark a lane count as a floor when the window came back short', async () => {
    get.mockResolvedValue(queuePayload({ items: [queueItem()], totalAtRisk: 120 }))
    harness(ManagerBody)

    // The header total and this fixture's one row carry the same $120 —
    // scoped to the header, since a bare query would also match the row.
    // RcTally sets its display via a post-commit effect, so the header can
    // lag the row's own render by a tick; waitFor settles once it catches up.
    await screen.findByText('PO-1')
    await waitFor(() => expect(atRiskHeader().getByText('$120')).toBeInTheDocument())
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
    // "0 open claims" — one row reading "$— · 0 open claims". Scoped to the
    // row itself: the header's own total is also a measured $0 here, so a
    // bare query would match both.
    await screen.findByText('PO-1')
    const row = screen.getByText('PO-1').closest('button') as HTMLElement
    expect(within(row).getByText('$0')).toBeInTheDocument()
  })

  it('renders an absent figure as an em dash', async () => {
    get.mockResolvedValue(
      queuePayload({ items: [queueItem({ dollarsAtRisk: null })], totalAtRisk: 0 }),
    )
    harness(ManagerBody)
    await screen.findByRole('tab', { name: /Short/ })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('states what is still owed in bottles, from the ledger (ADR 0192 amendment)', async () => {
    get.mockResolvedValue(queuePayload({ items: [queueItem({ backorderBottles: 2 })], totalAtRisk: 120 }))
    harness(ManagerBody)
    expect(await screen.findByText(/2 bottles still on backorder/)).toBeInTheDocument()
  })

  it('an unreadable backorder says it is not known, never that nothing is owed', async () => {
    get.mockResolvedValue(
      queuePayload({
        items: [queueItem({ backorderBottles: null, backorderWhy: 'The stock ledger could not be read (offline).' })],
        totalAtRisk: 120,
      }),
    )
    harness(ManagerBody)
    expect(await screen.findByText(/What is still owed is not known: The stock ledger could not be read/)).toBeInTheDocument()
  })

  it('marks the open-claim count as a floor — the link query is capped and unordered', async () => {
    get.mockResolvedValue(queuePayload({ items: [queueItem({ openClaims: 2 })], totalAtRisk: 120 }))
    harness(ManagerBody)

    await screen.findByText('PO-1')
    expect(screen.getByText(/≥2 open claims/)).toBeInTheDocument()
  })
})

/* ═══════════ sketch 107 — vendor boxes, grouped by A's graft onto B+ ══ */

describe('Sketch 107 — vendor boxes group the queue, worst money first', () => {
  it('renders one box per vendor when more than one vendor is present, each with its own subtotal', async () => {
    get.mockResolvedValue(
      queuePayload({
        items: [
          queueItem({ orderId: 'a', providerId: 'p-1', providerName: 'Skurnik', dollarsAtRisk: 100 }),
          queueItem({ orderId: 'b', providerId: 'p-2', providerName: 'SGWS', dollarsAtRisk: 20 }),
        ],
        totalAtRisk: 120,
      }),
    )
    harness(ManagerBody)

    expect(await screen.findByText('Skurnik')).toBeInTheDocument()
    expect(screen.getByText('SGWS')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ux-key="receiving-next:vendor-box"]')).toHaveLength(2)
  })

  it('does not wrap a single vendor in a box — its subtotal would just repeat the page total', async () => {
    get.mockResolvedValue(
      queuePayload({ items: [queueItem({ providerId: 'p-1', providerName: 'Skurnik' })], totalAtRisk: 120 }),
    )
    harness(ManagerBody)

    await screen.findByText('PO-1')
    expect(document.querySelectorAll('[data-ux-key="receiving-next:vendor-box"]')).toHaveLength(0)
  })

  it('names a failed vendor-name lookup as one honest box, never as a silent "unknown vendor" per row', async () => {
    get.mockResolvedValue(
      queuePayload({
        items: [
          queueItem({ orderId: 'a', providerId: 'p-1' }),
          queueItem({ orderId: 'b', providerId: 'p-2' }),
        ],
        totalAtRisk: 120,
        providerNamesUnavailable: true,
      }),
    )
    harness(ManagerBody)

    expect(await screen.findByText('Vendor names could not be loaded')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ux-key="receiving-next:vendor-box"]')).toHaveLength(1)
  })

  it('collapses a vendor box beyond the cap and expands it on request — page, never grow without end', async () => {
    const items = Array.from({ length: 7 }, (_, i) =>
      queueItem({ orderId: `o${i}`, orderNumber: `PO-${i}`, providerId: 'p-1', providerName: 'Skurnik', openClaims: i }),
    )
    get.mockResolvedValue(
      queuePayload({
        items: [
          ...items,
          queueItem({ orderId: 'other', orderNumber: 'PO-OTHER', providerId: 'p-2', providerName: 'SGWS' }),
        ],
        totalAtRisk: 120,
      }),
    )
    harness(ManagerBody)

    const more = await screen.findByRole('button', { name: /Show 2 more from Skurnik/ })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByText(/^PO-\d$/)).toHaveLength(5)
    fireEvent.click(more)
    const fewer = screen.getByRole('button', { name: /Show fewer from Skurnik/ })
    expect(fewer).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText(/^PO-\d$/)).toHaveLength(7)
  })

  it('never sums a vendor box across currencies, and never folds an unpriced row into the total (fixer review, 2026-09-18)', async () => {
    get.mockResolvedValue(
      queuePayload({
        items: [
          queueItem({ orderId: 'a', providerId: 'p-1', providerName: 'Skurnik', dollarsAtRisk: 100, currency: 'GBP' }),
          queueItem({ orderId: 'b', providerId: 'p-1', providerName: 'Skurnik', dollarsAtRisk: 40, currency: 'EUR' }),
          queueItem({ orderId: 'c', providerId: 'p-1', providerName: 'Skurnik', dollarsAtRisk: null }),
          queueItem({ orderId: 'd', providerId: 'p-2', providerName: 'SGWS', dollarsAtRisk: 20, currency: 'GBP' }),
        ],
        totalAtRisk: 120,
      }),
    )
    harness(ManagerBody)

    await screen.findByText('Skurnik')
    // Two currencies in one box print as two figures, added — never a single
    // invented "£140" that pretends 100 GBP and 40 EUR are the same money.
    // (Stated as GBP, not USD: check_money_states_its_currency.py counts a
    // pinned USD literal as a page assuming dollars.)
    expect(screen.getByText(/£100 \+ €40/)).toBeInTheDocument()
    // The unpriced row is named, not silently treated as $0.
    expect(screen.getByText(/1 unpriced/)).toBeInTheDocument()
  })

  // Confirmer walk 2026-09-18 (OD-112 caption contrast): the vendor box's two
  // secondary captions sat on paper in --ink-3, under the house's caption
  // floor. --ink-4 is the token that clears it.
  it('prints the vendor-box captions in --ink-4, the caption-contrast token', async () => {
    get.mockResolvedValue(
      queuePayload({
        items: [
          queueItem({ orderId: 'a', providerId: 'p-1', providerName: 'Skurnik', dollarsAtRisk: 100 }),
          queueItem({ orderId: 'b', providerId: 'p-1', providerName: 'Skurnik', dollarsAtRisk: null }),
          queueItem({ orderId: 'd', providerId: 'p-2', providerName: 'SGWS', dollarsAtRisk: 20 }),
        ],
        totalAtRisk: 120,
      }),
    )
    harness(ManagerBody)

    await screen.findByText('Skurnik')
    const count = screen.getAllByText(/deliver(y|ies)$/)[0]
    const unpriced = screen.getByText(/1 unpriced/)
    for (const el of [count, unpriced]) {
      expect(el.getAttribute('style')).toMatch(/var\(--ink-4/)
      expect(el.getAttribute('style')).not.toMatch(/--ink-3/)
    }
  })

  // Confirmer walk 2026-09-18: at 390 the page scrolled 12px sideways. The
  // ellipsised summary line reported its full nowrap width upward and grew the
  // vendor box, the section and <main>. jsdom has no layout, so this pins the
  // style that stops the contribution (measured in Chrome: scrollWidth 402 →
  // 390); the real-browser measurement is in the session's report.
  it("keeps a row's ellipsised summary from widening its parents (width 0, min-width 100%)", async () => {
    const summary = 'Musar 2016 not on the truck; billed on SG-88213 — a long line that must ellipsise, not widen'
    get.mockResolvedValue(
      queuePayload({ items: [queueItem({ providerId: 'p-1', providerName: 'Skurnik', summary })] }),
    )
    harness(ManagerBody)

    const line = (await screen.findAllByText(summary))[0]
    expect(line.style.width).toBe('0px')
    expect(line.style.minWidth).toBe('100%')
    expect(line.style.whiteSpace).toBe('nowrap')
  })

  // Regression (confirmer review, 2026-09-18): the page header's own "At
  // risk" total, and each row's own at-risk figure, used to format through a
  // formatter hardcoded to USD regardless of the order's own currency — a €40
  // order's row printed "$40", and a EUR-only queue's header printed a "$"
  // total for money that was never dollars.
  it('formats the page header and a row\'s own figure in the order\'s own currency, never a hardcoded $', async () => {
    get.mockResolvedValue(
      queuePayload({
        items: [queueItem({ dollarsAtRisk: 40, currency: 'EUR' })],
      }),
    )
    harness(ManagerBody)

    // Both the page header's total and the row's own figure read this one
    // EUR order — neither may fall back to the hardcoded "$" formatter.
    // RcTally sets its display via a post-commit effect, so the header can
    // lag the row by a render; waitFor settles once both have caught up.
    await screen.findByText('PO-1')
    await waitFor(() => expect(screen.getAllByText('€40')).toHaveLength(2))
    expect(screen.queryByText('$40')).not.toBeInTheDocument()
  })

  it('sums the page header\'s own total per currency, never into one invented figure', async () => {
    get.mockResolvedValue(
      queuePayload({
        items: [
          queueItem({ orderId: 'a', orderNumber: 'PO-A', providerId: 'p-1', dollarsAtRisk: 100, currency: 'GBP' }),
          queueItem({ orderId: 'b', orderNumber: 'PO-B', providerId: 'p-2', dollarsAtRisk: 40, currency: 'EUR' }),
        ],
      }),
    )
    harness(ManagerBody)

    await screen.findByText('PO-A')
    // "£100" and "€40" render as two separate figures joined by " + " — never
    // one invented cross-currency sum. Checked against the header's own
    // container's full text (the two amounts are sibling <RcTally> spans,
    // not one text node), waiting since RcTally's display lags by an effect.
    const header = screen.getByText('At risk').parentElement as HTMLElement
    await waitFor(() => expect(header).toHaveTextContent('£100 + €40'))
  })

  // The verdict-ledger feature was stripped (founder's condition was "if
  // it's bulletproof"; a 16-agent research pass found its own invariant
  // unenforced and its detector clamped to zero). This row no longer opens
  // a ledger, and the row's other two hand-offs are untouched by the strip.
  it('has no verdict-ledger entry point, and the row\'s existing hand-offs are unmoved', async () => {
    get.mockResolvedValue(queuePayload({ items: [queueItem()], totalAtRisk: 120 }))
    harness(ManagerBody)

    await screen.findByText('PO-1')
    expect(screen.queryByRole('button', { name: /Open the verdict ledger/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open the order/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit line items at the desk/ })).toBeInTheDocument()
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

/**
 * F11 — `/deliveries/:id` (DeliveryRedirect.tsx) resolves to an order and
 * hands off here as `?order=…`; this queue is where the founder's "worst
 * money first" decision on it lives (ReceivingNext.tsx `highlightOrderId`).
 * Before this pass the queue had no way to open one row from outside it at
 * all — the hand-off was a bare `/receiving`, indistinguishable from any
 * other visit.
 */
describe('F11 — a delivery hand-off opens its row in the decision queue', () => {
  const ManagerBodyHighlighted = () => (
    <RcManagerQueue data={useManagerQueue()} highlightOrderId="ord-1" />
  )

  it('expands the matching row and does not print a "not in the queue" line', async () => {
    get.mockResolvedValue(
      queuePayload({ items: [queueItem({ orderId: 'ord-1' }), queueItem({ orderId: 'ord-2', orderNumber: 'PO-2' })] }),
    )
    harness(ManagerBodyHighlighted)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /PO-1/ })).toHaveAttribute('aria-expanded', 'true'),
    )
    expect(screen.getByRole('button', { name: /PO-2/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('highlight-order-missing')).not.toBeInTheDocument()
  })

  it('says so, in one honest sentence, when the read came back and the order is not in the queue', async () => {
    get.mockResolvedValue(queuePayload({ items: [queueItem({ orderId: 'ord-2', orderNumber: 'PO-2' })] }))
    harness(ManagerBodyHighlighted)

    expect(await screen.findByTestId('highlight-order-missing')).toHaveTextContent('ord-1')
  })

  it('says nothing while the queue is still loading', () => {
    get.mockReturnValue(new Promise(() => {})) // never resolves
    harness(ManagerBodyHighlighted)

    expect(screen.queryByTestId('highlight-order-missing')).not.toBeInTheDocument()
  })
})
