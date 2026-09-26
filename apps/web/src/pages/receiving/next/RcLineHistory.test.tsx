import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RcManagerQueue } from './RcManagerQueue'
import { entryWords } from './rc-history-words'
import { useManagerQueue } from './useReceivingNextData'
import type { LineHistoryEntry } from '../../../services/api/receiving'

/**
 * The receiving desk, Approach 1 (founder Q7, 2026-09-22; ADR 0160 §107):
 * one row per line, named by what was ordered, grouped by vendor five to a
 * box; a line's full history opened on demand, ten entries a page, built from
 * the door receipts already recorded (founder, 2026-09-25).
 *
 * The gateway is stubbed at the HTTP client, so the hook, the view model and
 * the sheet under test are the real ones.
 */

const get = vi.hoisted(() => vi.fn())
vi.mock('../../../services/api/client', () => ({ apiClient: { get } }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../../../contexts/AuthContext', async () => {
  const { createContext } = await import('react')
  return {
    AuthContext: createContext<unknown>(null),
    useAuth: () => ({
      activeRestaurantId: 'rest-A',
      user: { userId: 'u1', restaurantId: 'rest-A', role: 'manager' },
    }),
  }
})

const ORDER = '11111111-1111-4111-8111-111111111111'

const queueItem = (over: Record<string, unknown> = {}) => ({
  orderId: ORDER,
  orderNumber: 'PO-7',
  verdict: 'partial',
  summary: '58 of 60 accepted',
  backorderBottles: 2,
  backorderWhy: null,
  verifiedAt: '2026-09-25T11:00:00.000Z',
  dollarsAtRisk: 40,
  selfEvidenced: false,
  openClaims: 1,
  providerId: 'prov-1',
  providerName: 'Wine Warehouse',
  itemName: 'Chablis 2022',
  currency: 'EUR',
  ...over,
})

const queue = (items: unknown[], over: Record<string, unknown> = {}) => ({
  data: {
    items,
    unverified: [],
    totalAtRiskByCurrency: [{ currency: 'EUR', amount: 40 }],
    providerNamesUnavailable: false,
    itemNamesUnavailable: false,
    ...over,
  },
})

const entry = (n: number, over: Partial<LineHistoryEntry> = {}): LineHistoryEntry => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind: 'door_count',
  stage: 'case_count',
  occurredAt: `2026-09-25T10:${String(n).padStart(2, '0')}:00.000Z`,
  outcome: 'accepted',
  refusalReason: null,
  countedQtyInCountedUom: 2,
  countedUom: 'case',
  countedBottles: 24,
  rejectedQtyInCountedUom: 0,
  rejectedBottles: 0,
  expectedBottles: null,
  invoiceBottles: null,
  notes: null,
  driverName: null,
  signedByInitials: null,
  recordedBy: 'Selin',
  ...over,
})

const received = {
  readable: true,
  why: null,
  words: '4 cases + 10 bottles',
  quantityInStockUom: 58,
  stockUom: 'bottle',
  orderedBottles: 60,
  backorderBottles: 2,
  rejectedAtDoorBottles: 0,
  rejectedAtDeskBottles: null,
  invoicedBottles: null,
  verifiedAt: null,
}

const page = (entries: LineHistoryEntry[], over: Record<string, unknown> = {}) => ({
  data: {
    orderId: ORDER,
    orderNumber: 'PO-7',
    entries,
    total: entries.length,
    hasMore: false,
    nextBefore: null,
    recordedByUnavailable: false,
    matchVerifiedAt: null,
    received,
    ...over,
  },
})

const httpError = (status: number, message = 'request failed') =>
  Object.assign(new Error(message), { response: { status } })

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Body = () => <RcManagerQueue data={useManagerQueue()} />
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Body />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Serve the queue, and the history by page marker. */
function serve(items: unknown[], history: (params: any) => Promise<unknown>, queueOver = {}) {
  get.mockImplementation(async (url: string, config?: any) => {
    if (url === '/procurement/receiving/queue') return queue(items, queueOver)
    if (url === `/procurement/receiving/orders/${ORDER}/history`) return history(config?.params ?? {})
    throw new Error(`unexpected GET ${url}`)
  })
}

async function openHistory() {
  fireEvent.click(await screen.findByRole('button', { name: /Chablis 2022/ }))
  fireEvent.click(screen.getByRole('button', { name: /History — what the door and the desk recorded/ }))
  return screen.findByRole('dialog')
}

beforeEach(() => {
  get.mockReset()
})

describe('entryWords — every entry says one true sentence', () => {
  it('a door count, in the unit counted and the bottles it came to', () => {
    expect(entryWords(entry(1))).toBe('The door counted 2 cases (24 bottles).')
    expect(entryWords(entry(1, { rejectedQtyInCountedUom: 1, rejectedBottles: 12 }))).toBe(
      'The door counted 2 cases (24 bottles) and refused 1 case (12 bottles).',
    )
    expect(entryWords(entry(1, { countedQtyInCountedUom: 6, countedUom: 'bottle', countedBottles: 6 }))).toBe(
      'The door counted 6 bottles.',
    )
  })

  it('a refusal at the door names its reason', () => {
    expect(
      entryWords(
        entry(1, {
          kind: 'door_refused',
          outcome: 'refused',
          refusalReason: 'broken_case',
          rejectedQtyInCountedUom: 2,
          rejectedBottles: 24,
        }),
      ),
    ).toBe('The door turned the delivery away (broken case), refusing 2 cases (24 bottles).')
  })

  it("a desk verification states the invoice, or that none was verified", () => {
    const desk = entry(1, {
      kind: 'desk_verified',
      stage: 'reconciled',
      countedQtyInCountedUom: 58,
      countedUom: 'bottle',
      countedBottles: 58,
      rejectedBottles: 2,
    })
    expect(entryWords({ ...desk, invoiceBottles: 60 })).toBe(
      'The desk verified the line: 58 bottles accepted, 2 bottles refused. The invoice billed 60 bottles.',
    )
    expect(entryWords(desk)).toMatch(/No invoice was verified\.$/)
  })

  it("a one-tap 'Counts match' says it confirmed, with no invoice or refusal stated (ADR 0192, fifth amendment)", () => {
    const tap = entry(1, {
      kind: 'desk_confirmed',
      stage: 'reconciled',
      outcome: 'accepted',
      countedQtyInCountedUom: 58,
      countedUom: 'bottle',
      countedBottles: 58,
      rejectedBottles: 0,
      invoiceBottles: null,
    })
    expect(entryWords(tap)).toBe(
      'The desk confirmed the counts match: 58 bottles on the shelf. No invoice or refusal was stated.',
    )
    expect(entryWords({ ...tap, countedQtyInCountedUom: null, countedBottles: null })).toBe(
      'The desk confirmed the counts match: no count recorded. No invoice or refusal was stated.',
    )
  })

  it('an unworded stage is named by its own stage, never hidden', () => {
    expect(entryWords(entry(1, { kind: 'other', stage: 'bottle_count' }))).toBe(
      'Recorded as "bottle_count": 2 cases (24 bottles).',
    )
  })
})

describe('the desk row is a line', () => {
  it('names the line by what was ordered, with its order number beside it', async () => {
    serve([queueItem()], async () => page([]))
    harness()
    const row = await screen.findByRole('button', { name: /Chablis 2022/ })
    expect(row).toHaveTextContent('PO-7')
  })

  it('a failed name lookup keeps the order number and says why', async () => {
    serve([queueItem({ itemName: null })], async () => page([]), { itemNamesUnavailable: true })
    harness()
    expect(await screen.findByTestId('receiving-item-names-unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PO-7/ })).toBeInTheDocument()
  })

  it('reads no history until a line asks for it', async () => {
    serve([queueItem()], async () => page([entry(1)]))
    harness()
    await screen.findByRole('button', { name: /Chablis 2022/ })
    expect(get.mock.calls.map((c) => c[0])).toEqual(['/procurement/receiving/queue'])
  })
})

describe("a line's history, ten at a time", () => {
  it('shows the newest ten, the exact total, and fetches the older page by marker', async () => {
    const newest = Array.from({ length: 10 }, (_, i) => entry(13 - i))
    const older = [entry(3), entry(2), entry(1)]
    serve([queueItem()], async (params) =>
      params.before === 'M1'
        ? page(older, { total: 13, received: null })
        : page(newest, { total: 13, hasMore: true, nextBefore: 'M1' }),
    )
    harness()
    const sheet = await openHistory()
    await within(sheet).findByTestId(`line-history-entry-${entry(13).id}`)
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(10)
    expect(within(sheet).getByTestId('line-history-count')).toHaveTextContent('10 of 13 shown')
    // The ledger's received block (ADR 0192), never a typed-in figure.
    expect(within(sheet).getByTestId('line-history-received')).toHaveTextContent('4 cases + 10 bottles')

    fireEvent.click(within(sheet).getByRole('button', { name: 'Show 3 older' }))
    await within(sheet).findByTestId(`line-history-entry-${entry(1).id}`)
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(13)
    expect(within(sheet).getByTestId('line-history-count')).toHaveTextContent('13 of 13 shown')
    expect(within(sheet).queryByRole('button', { name: /older/ })).toBeNull()
    expect(get).toHaveBeenCalledWith(`/procurement/receiving/orders/${ORDER}/history`, {
      params: { before: 'M1' },
    })
  })

  it('an empty history is said as empty only when the read answered', async () => {
    serve([queueItem()], async () => page([]))
    harness()
    const sheet = await openHistory()
    expect(await within(sheet).findByTestId('line-history-empty')).toBeInTheDocument()
  })

  it('a refused read says who may read the desk, and offers no retry', async () => {
    serve([queueItem()], async () => {
      throw httpError(403)
    })
    harness()
    const sheet = await openHistory()
    const alert = await within(sheet).findByRole('alert')
    expect(alert).toHaveTextContent(/Only an owner or a manager can/)
    expect(within(sheet).queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(within(sheet).queryByTestId('line-history-empty')).toBeNull()
  })

  it('a broken read says so, never "nothing recorded", and can be retried', async () => {
    let calls = 0
    serve([queueItem()], async () => {
      calls += 1
      if (calls === 1) throw httpError(500, 'connection reset')
      return page([entry(1)])
    })
    harness()
    const sheet = await openHistory()
    const alert = await within(sheet).findByRole('alert')
    expect(alert).toHaveTextContent(/could not be read \(connection reset\)/)
    expect(within(sheet).queryByTestId('line-history-empty')).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await within(sheet).findByTestId(`line-history-entry-${entry(1).id}`)
  })

  it('a failed older page keeps the entries shown and says so', async () => {
    serve([queueItem()], async (params) => {
      if (params.before === 'M1') throw httpError(500, 'timeout')
      return page([entry(12), entry(11)], { total: 12, hasMore: true, nextBefore: 'M1' })
    })
    harness()
    const sheet = await openHistory()
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Show 10 older' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/Older entries could not be read \(timeout\)/)
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(2)
  })

  it('an unknown total is said, never guessed', async () => {
    serve([queueItem()], async () => page([entry(1)], { total: null }))
    harness()
    const sheet = await openHistory()
    expect(await within(sheet).findByTestId('line-history-count')).toHaveTextContent(
      '1 shown · the total could not be read',
    )
  })

  it("names a desk check that left no entry, once every page is read", async () => {
    serve([queueItem()], async () =>
      page([entry(1)], { matchVerifiedAt: '2026-09-20T09:00:00.000Z' }),
    )
    harness()
    const sheet = await openHistory()
    expect(await within(sheet).findByTestId('line-history-unrecorded-check')).toHaveTextContent(
      /before a check was kept as an entry/,
    )
  })

  it('a one-tap confirmation does not stand in for an older full check that left no entry', async () => {
    serve([queueItem()], async () =>
      page([entry(2, { kind: 'desk_confirmed', stage: 'reconciled', outcome: 'accepted' }), entry(1)], {
        matchVerifiedAt: '2026-09-20T09:00:00.000Z',
      }),
    )
    harness()
    const sheet = await openHistory()
    expect(await within(sheet).findByTestId('line-history-unrecorded-check')).toHaveTextContent(
      /before a check was kept as an entry/,
    )
  })

  it('does not claim a missing desk check when the desk entry is there', async () => {
    serve([queueItem()], async () =>
      page([entry(2, { kind: 'desk_verified', stage: 'reconciled' }), entry(1)], {
        matchVerifiedAt: '2026-09-25T11:00:00.000Z',
      }),
    )
    harness()
    const sheet = await openHistory()
    await within(sheet).findAllByRole('listitem')
    expect(within(sheet).queryByTestId('line-history-unrecorded-check')).toBeNull()
  })
})

describe('five rows a vendor box', () => {
  const many = Array.from({ length: 7 }, (_, i) =>
    queueItem({
      orderId: `0000000${i}-1111-4111-8111-111111111111`,
      orderNumber: `PO-${i}`,
      itemName: `Wine ${i}`,
      dollarsAtRisk: 100 - i,
    }),
  )
  const other = queueItem({
    orderId: '99999999-1111-4111-8111-111111111111',
    orderNumber: 'PO-99',
    itemName: 'Other wine',
    providerId: 'prov-2',
    providerName: 'Southern Glazer',
    dollarsAtRisk: 1,
  })

  it('shows five, and the rest behind "Show 2 more"', async () => {
    serve([...many, other], async () => page([]))
    harness()
    await screen.findByRole('button', { name: /Wine 0/ })
    expect(screen.queryByRole('button', { name: /Wine 5/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more from Wine Warehouse' }))
    expect(screen.getByRole('button', { name: /Wine 6/ })).toBeInTheDocument()
  })

  it("a highlighted line past the fifth opens its box so it can be seen", async () => {
    serve([...many, other], async () => page([]))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Body = () => <RcManagerQueue data={useManagerQueue()} highlightOrderId={many[6].orderId} />
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Body />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Wine 6/ })).toHaveAttribute('aria-expanded', 'true'),
    )
  })
})
