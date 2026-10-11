import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RowExpansion } from './RowExpansion'
import type { InventoryItem } from '../useInventoryPage'
import { setHouseLocale } from '../../../lib/houseCurrency'

const navigate = vi.hoisted(() => vi.fn())
const getItemActivity = vi.hoisted(() => vi.fn())
const getOrders = vi.hoisted(() => vi.fn())
const transferStock = vi.hoisted(() => vi.fn())
const fetchAuctionLotRecords = vi.hoisted(() => vi.fn())
const adjustStock = vi.hoisted(() => vi.fn())
const reconcileItem = vi.hoisted(() => vi.fn())
const reconcileShadowItem = vi.hoisted(() => vi.fn())
const recordSpotCount = vi.hoisted(() => vi.fn())
const updateInventoryItem = vi.hoisted(() => vi.fn())
const recordPour = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../../../services/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/inventory')>(
    '../../../services/api/inventory',
  )
  return { ...actual, getItemActivity, transferStock, fetchAuctionLotRecords, adjustStock, reconcileItem, reconcileShadowItem, recordSpotCount, updateInventoryItem, recordPour }
})
vi.mock('../../../services/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/orders')>(
    '../../../services/api/orders',
  )
  return { ...actual, getOrders }
})
vi.mock('../../../stores', () => ({
  useNotificationStore: () => ({ success: vi.fn(), error: vi.fn() }),
}))
// The real select renders a portal/popover; a native one stands in so the
// reason can be picked (F-1163).
vi.mock('../../../components/ui/ThemedSelect', () => ({
  ThemedSelect: (p: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; 'aria-label'?: string }) => (
    <select aria-label={p['aria-label']} value={p.value} onChange={(e) => p.onChange(e.target.value)}>
      {p.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

const item = {
  id: 'wine-1',
  inventoryId: 'inv-1',
  name: 'Produttori Barbaresco',
  producer: 'Produttori del Barbaresco',
  vintage: 2019,
  price: 42,
  type: 'red',
  grape: 'Nebbiolo',
  country: 'Italy',
  region: 'Piedmont',
  appellation: 'Barbaresco DOCG',
  body: 'full',
  sweetness: 'dry',
  acidity: 'high',
  alcohol: 14,
  aromas: [],
  flavors: [],
  liveStock: 8,
  shadowStock: 0,
  threshold: 6,
  bottleSizeMl: 750,
  lastCounted: '2026-08-01T00:00:00.000Z',
  isActive: true,
  provider: { name: 'Vino Distributors', contact: 'Ana', phone: '555-0100' },
} as unknown as InventoryItem

function renderRow(overrides: Partial<InventoryItem> = {}, locations: any[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RowExpansion item={{ ...item, ...overrides } as InventoryItem} locations={locations} />
    </QueryClientProvider>,
  )
}

describe('RowExpansion — View ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  /**
   * F-948 (F-144): "View ledger" went to /documents-reports, which holds
   * reports and mail, not this wine's movements. No per-wine ledger view
   * exists, so the row offers no link to one.
   */
  it('offers no "View ledger" link while no per-wine ledger view exists', () => {
    renderRow()

    expect(screen.queryByRole('button', { name: /view ledger/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /view ledger/i })).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalledWith('/documents-reports')
  })
})

/**
 * Regression: the transfer control used to send `fromLocationId: null` no matter
 * what, so a wine sitting in two locations could not say which one the bottles
 * were leaving. The server read `null` as "take them from unassigned stock".
 */
describe('RowExpansion — moving bottles between locations', () => {
  const locations = [
    { id: 'loc-a', name: 'Main Cellar', capacity: 500, currentCount: 5, color: '#be123c' },
    { id: 'loc-b', name: 'Bar Stock', capacity: 100, currentCount: 3, color: '#f59e0b' },
  ]
  const split = {
    liveStock: 8,
    locations: [
      { locationId: 'loc-a', qty: 5, wac: null },
      { locationId: 'loc-b', qty: 3, wac: null },
    ],
  } as Partial<InventoryItem>

  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
    transferStock.mockResolvedValue({})
  })

  it('shows every location the wine sits in, not just the first', async () => {
    renderRow(split, locations)

    expect(screen.getByTitle('5 in Main Cellar')).toBeInTheDocument()
    expect(screen.getByTitle('3 in Bar Stock')).toBeInTheDocument()
  })

  it('sends the source location the user picked', async () => {
    renderRow(split, locations)

    await userEvent.click(screen.getByTitle('Click to move bottles between locations'))

    // The last two: the adjust bar's shelf and reason pickers come first.
    const [from, to] = screen.getAllByRole('combobox').slice(-2)
    await userEvent.selectOptions(from, 'loc-a')
    await userEvent.selectOptions(to, 'loc-b')
    await userEvent.click(screen.getByRole('button', { name: /^move$/i }))

    expect(transferStock).toHaveBeenCalledWith('inv-1', {
      fromLocationId: 'loc-a',
      toLocationId: 'loc-b',
      qty: 1,
      reason: 'manual transfer',
    })
  })

  it('never falls back to a null source once a location is chosen', async () => {
    renderRow(split, locations)

    await userEvent.click(screen.getByTitle('Click to move bottles between locations'))

    // The last two: the adjust bar's shelf and reason pickers come first.
    const [from, to] = screen.getAllByRole('combobox').slice(-2)
    await userEvent.selectOptions(from, 'loc-b')
    await userEvent.selectOptions(to, 'loc-a')
    await userEvent.click(screen.getByRole('button', { name: /^move$/i }))

    expect(transferStock.mock.calls[0][1].fromLocationId).toBe('loc-b')
    expect(transferStock.mock.calls[0][1].fromLocationId).not.toBeNull()
  })
})

describe('RowExpansion — the manual adjustment is named (F-402)', () => {
  it('says what the - and + change, and reads the value out', async () => {
    renderRow()
    const more = screen.getByRole('button', { name: 'Increase manual adjustment' })
    expect(screen.getByRole('button', { name: 'Decrease manual adjustment' })).toBeTruthy()
    fireEvent.click(more)
    const value = screen.getByLabelText('Manual adjustment +1')
    expect(value.getAttribute('aria-live')).toBe('polite')
  })
})

/**
 * F-292: "Manual adjust" used to send a new TOTAL built from the list's cached
 * stock (live + delta, clamped at zero) to the count endpoint, so two managers
 * each logging "-1 Breakage" on a page showing 10 both sent 9 and one bottle was
 * lost, and a sale since the page loaded was put back. It now sends the change.
 */
describe('RowExpansion — manual adjust sends the change, not a total', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
    adjustStock.mockResolvedValue({})
  })

  it('posts -1 as a change and never a count built from cached stock', async () => {
    renderRow({ liveStock: 10 })

    await userEvent.click(screen.getByRole('button', { name: 'Decrease manual adjustment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(reconcileItem).not.toHaveBeenCalled()
    expect(adjustStock).toHaveBeenCalledTimes(1)
    const [id, body] = adjustStock.mock.calls[0]
    expect(id).toBe('inv-1')
    expect(body).toMatchObject({ wineId: 'wine-1', quantityChange: -1, reason: 'Count correction' })
    expect(body).not.toHaveProperty('actualCount')
    expect(body.idempotencyKey).toMatch(/^adjust:inv-1:/)
  })

  it('does not clamp a take-off larger than the cached stock', async () => {
    renderRow({ liveStock: 2 })

    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole('button', { name: 'Decrease manual adjustment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    // The server holds the real stock and refuses below zero out loud; the page
    // no longer books -2 while showing -5.
    expect(adjustStock.mock.calls[0][1].quantityChange).toBe(-5)
  })
})

/**
 * F-294 + F-291: the count field opened pre-filled with the book figure, so a
 * Submit without counting recorded "the books were right"; and the panel never
 * said that the number replaces the total on every shelf.
 */
describe('RowExpansion — the count panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  it('opens with an empty field and Submit off until a number is typed', async () => {
    renderRow({ liveStock: 8 })

    await userEvent.click(screen.getByRole('button', { name: /count every shelf/i }))

    const field = screen.getByLabelText(/bottles counted/i) as HTMLInputElement
    expect(field.value).toBe('')
    expect(screen.getByRole('button', { name: /submit count/i })).toBeDisabled()
    // The book figure is still there, as a hint beside the field.
    expect(screen.getByText(/on the books, all shelves together: 8 bottles/i)).toBeInTheDocument()

    await userEvent.type(field, '7')
    expect(screen.getByRole('button', { name: /submit count/i })).toBeEnabled()
  })

  it('says the count is of every shelf, and how many places hold the wine', async () => {
    renderRow({
      liveStock: 11,
      locations: [
        { locationId: 'loc-a', qty: 8, wac: null },
        { locationId: 'loc-b', qty: 3, wac: null },
      ],
    } as Partial<InventoryItem>)

    await userEvent.click(screen.getByRole('button', { name: /count every shelf/i }))

    const scope = screen.getByTestId('spot-count-scope')
    expect(scope).toHaveTextContent(/sealed bottles of this wine in every room/i)
    expect(scope).toHaveTextContent(/in 2 places/i)
  })

  // F-291: a count of one shelf names the shelf, so only that shelf changes.
  it('asks where the count was taken when the house has places, and sends that shelf', async () => {
    recordSpotCount.mockResolvedValue({ item: null })
    renderRow(
      {
        liveStock: 11,
        locations: [
          { locationId: 'loc-cellar', qty: 8, wac: null },
          { locationId: 'loc-bar', qty: 3, wac: null },
        ],
      } as Partial<InventoryItem>,
      [
        { id: 'loc-cellar', name: 'Cellar', capacity: null, currentCount: 0, color: '' },
        { id: 'loc-bar', name: 'Bar', capacity: null, currentCount: 0, color: '' },
      ],
    )

    await userEvent.click(screen.getByRole('button', { name: /count bottles/i }))
    const field = screen.getByLabelText(/bottles counted/i)
    await userEvent.type(field, '6')
    // Not until the counter says where they counted.
    expect(screen.getByRole('button', { name: /submit count/i })).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText(/where you counted/i), 'loc-cellar')
    expect(screen.getByTestId('spot-count-scope')).toHaveTextContent(/only cellar changes/i)
    expect(screen.getByText(/on the books for cellar: 8 bottles/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /submit count/i }))
    expect(recordSpotCount).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ countedQty: 6, locationId: 'loc-cellar' }),
      undefined,
    )
  })

  // F-945: the door books bottles with no shelf. A count of "Cellar" compared
  // the number with Cellar's lots alone and booked the unplaced 6 again.
  it('offers no single shelf while bottles of the wine sit on no shelf, and sends no shelf', async () => {
    recordSpotCount.mockResolvedValue({ item: null })
    renderRow(
      {
        liveStock: 6,
        locations: [{ locationId: null, qty: 6, wac: null }],
      } as Partial<InventoryItem>,
      [
        { id: 'loc-cellar', name: 'Cellar', capacity: null, currentCount: 0, color: '' },
        { id: 'loc-bar', name: 'Bar', capacity: null, currentCount: 0, color: '' },
      ],
    )

    await userEvent.click(screen.getByRole('button', { name: /count bottles/i }))
    expect(screen.queryByLabelText(/where you counted/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('spot-count-scope')).toHaveTextContent(/6 bottles are not on any one shelf yet/i)

    await userEvent.type(screen.getByLabelText(/bottles counted/i), '6')
    await userEvent.click(screen.getByRole('button', { name: /submit count/i }))
    expect(recordSpotCount).toHaveBeenCalledTimes(1)
    expect(recordSpotCount.mock.calls[0][1]).not.toHaveProperty('locationId')
  })

  // F-945: a zone that holds racks is counted with its racks' bottles in hand,
  // while its books hold only its own lots, so only the racks are offered.
  it('offers only the places that hold no other place', async () => {
    renderRow(
      {
        liveStock: 5,
        locations: [{ locationId: 'loc-rack', qty: 5, wac: null }],
      } as Partial<InventoryItem>,
      [
        { id: 'loc-cellar', name: 'Cellar', capacity: null, currentCount: 0, color: '' },
        { id: 'loc-rack', name: 'Rack A', capacity: null, currentCount: 0, color: '', parentId: 'loc-cellar' },
      ],
    )

    await userEvent.click(screen.getByRole('button', { name: /count bottles/i }))
    const picker = screen.getByLabelText(/where you counted/i)
    const options = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toContain('Rack A')
    expect(options).not.toContain('Cellar')
  })

  it('sends no shelf when the counter picks every shelf together', async () => {
    recordSpotCount.mockResolvedValue({ item: null })
    renderRow({ liveStock: 11 }, [
      { id: 'loc-cellar', name: 'Cellar', capacity: null, currentCount: 0, color: '' },
    ])

    await userEvent.click(screen.getByRole('button', { name: /count bottles/i }))
    await userEvent.selectOptions(screen.getByLabelText(/where you counted/i), 'Every shelf together')
    await userEvent.type(screen.getByLabelText(/bottles counted/i), '11')
    await userEvent.click(screen.getByRole('button', { name: /submit count/i }))

    expect(recordSpotCount).toHaveBeenCalledTimes(1)
    expect(recordSpotCount.mock.calls[0][1]).not.toHaveProperty('locationId')
  })
})

describe('RowExpansion — the menu price is the house price (F-390)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  it('[REVERT-FAILS] shows the bottle price the house set, not "not set"', () => {
    renderRow({ menuPriceBottle: 126, wac: 42 } as Partial<InventoryItem>)
    const row = screen.getByText('Menu price').parentElement as HTMLElement
    expect(row.textContent).not.toContain('not set')
    expect(row.textContent).toContain('3.0x')
  })

  it('says "not set" when the house has no bottle price', () => {
    renderRow({ menuPriceBottle: undefined } as Partial<InventoryItem>)
    const row = screen.getByText('Menu price').parentElement as HTMLElement
    expect(row.textContent).toContain('not set')
  })
})

describe('RowExpansion — the adjust steppers are thumb-sized (F-226)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  it('[REVERT-FAILS] gives each stepper a 44px target', () => {
    renderRow()
    // Integration: HEAD's F-402 names for the steppers.
    for (const name of ['Decrease manual adjustment', 'Increase manual adjustment']) {
      const b = screen.getByRole('button', { name })
      expect(b.className).toContain('w-11')
      expect(b.className).toContain('h-11')
    }
  })
})

/** The value printed beside a label in the Par and reorder card. */
const kv = (label: string) => screen.getByText(label).nextElementSibling?.textContent

describe('RowExpansion — one reorder answer (F-081, F-391, F-630, F-689)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  it('the draft button asks for the suggested order, not par, and says so', async () => {
    // Par 6, 8 on the shelf, selling 1 a day: 20 days of need less 8 = 12.
    renderRow({ velocityPerDay: 1, velocityDays: 30 })
    const btn = await screen.findByRole('button', { name: 'Draft order, 12 btl' })
    expect(kv('Suggested order')).toBe('12 btl')
    await userEvent.click(btn)
    expect(navigate).toHaveBeenCalledWith('/orders?draft=new&inventoryId=inv-1&qty=12')
    // The wait is stated where it is used, with no "+ safety" that is never computed.
    expect(kv('Reorder point')).toBe('6 btl (6-day delivery wait)')
    expect(screen.queryByText(/\+ safety/)).toBeNull()
  })

  it('with nothing to order, the button drafts an order without inventing par', async () => {
    renderRow({ velocityPerDay: 0, liveStock: 8, threshold: 6 })
    const btn = await screen.findByRole('button', { name: 'Draft an order' })
    await userEvent.click(btn)
    expect(navigate).toHaveBeenCalledWith('/orders?draft=new&inventoryId=inv-1')
  })

  it('subtracts bottles already ordered and not here yet', async () => {
    getOrders.mockResolvedValue([
      { id: 'o1', inventoryId: 'inv-1', status: 'CONFIRMED', quantity: 1, bottlesTotal: 6 },
      { id: 'o2', inventoryId: 'inv-1', status: 'DELIVERED', quantity: 1, bottlesTotal: 12 },
      { id: 'o3', inventoryId: 'other', status: 'IN_TRANSIT', quantity: 1, bottlesTotal: 24 },
    ])
    renderRow({ velocityPerDay: 1, velocityDays: 30 })
    // 20 needed, 8 on the shelf, 6 on the way: 6, not 12.
    expect(await screen.findByRole('button', { name: 'Draft order, 6 btl' })).toBeTruthy()
    expect(kv('On order, not here yet')).toBe('6 btl')
    expect(kv('Suggested order')).toBe('6 btl')
  })

  it('an unset par is shown as not set and drafts nothing on its own', async () => {
    renderRow({ threshold: null, velocityPerDay: undefined, liveStock: 0 })
    await screen.findByRole('button', { name: 'Draft an order' })
    expect(kv('Par')).toBe('not set')
    expect(kv('Suggested order')).toBe('set a par to get one')
    expect(screen.getByRole('button', { name: 'Draft an order' })).toBeTruthy()
  })

  it('a sales rate that could not be read is said, never 0.0', async () => {
    renderRow({ velocityPerDay: undefined, analyticsReadable: false })
    await screen.findByRole('button', { name: 'Draft an order' })
    expect(kv('Selling')).toBe('could not be read')
    expect(screen.queryByText(/0\.0 btl\/day/)).toBeNull()
    // Par 6, 8 on the shelf: nothing to order on par alone.
    expect(screen.getByRole('button', { name: 'Draft an order' })).toBeTruthy()
  })

  it('a new wine says it is new and how many days its rate covers', async () => {
    renderRow({ velocityPerDay: 2, velocityDays: 3, velocityIsNew: true })
    await screen.findByText('Selling')
    expect(kv('Selling')).toBe('new, 2.0 btl/day over 3 days')
  })
})

/**
 * F-705: a failed or still-loading orders/activity read used to fall through
 * `data = []` and print "No orders for this wine yet." and "No depletion
 * recorded yet." — an empty history the house never had.
 */
describe('RowExpansion — a read that did not answer is not an empty history (F-705)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  it('says the orders and sales could not be read, and claims no empty history', async () => {
    getOrders.mockRejectedValue(new Error('502'))
    getItemActivity.mockRejectedValue(new Error('502'))
    renderRow()
    expect(await screen.findByText(/The orders for this wine could not be read just now/)).toBeInTheDocument()
    expect((await screen.findAllByText(/The sales for this wine could not be read just now/)).length).toBe(2)
    expect(screen.queryByText('No orders for this wine yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No depletion recorded yet.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Heatmap builds as POS sales come in/)).not.toBeInTheDocument()
  })

  it('says it is still reading while the reads are open', () => {
    getOrders.mockReturnValue(new Promise(() => {}))
    getItemActivity.mockReturnValue(new Promise(() => {}))
    renderRow()
    expect(screen.getByText('Reading orders…')).toBeInTheDocument()
    expect(screen.getAllByText('Reading sales…').length).toBe(2)
    expect(screen.queryByText('No orders for this wine yet.')).not.toBeInTheDocument()
  })

  it('still says there are no orders when the read answered with none', async () => {
    getOrders.mockResolvedValue([])
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    renderRow()
    expect(await screen.findByText('No orders for this wine yet.')).toBeInTheDocument()
    expect(await screen.findByText('No depletion recorded yet.')).toBeInTheDocument()
  })
})

/**
 * F-1064 (re-hit of F-075): a wine's par can be changed where it is read, by
 * an owner or a manager, through the item PATCH's thresholdMin.
 */
describe('RowExpansion — par editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
    updateInventoryItem.mockResolvedValue({})
  })

  function renderWith(canSetPar: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RowExpansion item={item} locations={[]} canSetPar={canSetPar} />
      </QueryClientProvider>,
    )
  }

  it('lets an owner or a manager change the par, and sends only thresholdMin', async () => {
    renderWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    const input = screen.getByLabelText('Par for this wine')
    expect(input).toHaveValue(6)
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(updateInventoryItem).toHaveBeenCalledWith('inv-1', { thresholdMin: 9 }))
  })

  it('refuses a par that is not a whole number before sending anything', () => {
    renderWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.change(screen.getByLabelText('Par for this wine'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(updateInventoryItem).not.toHaveBeenCalled()
  })

  it('draws no par control for anyone else', () => {
    renderWith(false)
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
    expect(screen.getByText('6 btl')).toBeInTheDocument()
  })
})

// F-1165: a count of one shelf no longer marks the whole wine counted, so the
// row says which shelf was counted when.
describe('RowExpansion — which shelf was counted', () => {
  const day = 86_400_000
  const shelves = [
    { id: 'loc-bar', name: 'Bar', capacity: null },
    { id: 'loc-cellar', name: 'Cellar', capacity: null },
  ]
  const onShelves = {
    lastCounted: new Date(Date.now() - 12 * day).toISOString(),
    locations: [
      { locationId: 'loc-bar', qty: 2, wac: null },
      { locationId: 'loc-cellar', qty: 6, wac: null },
    ],
  } as Partial<InventoryItem>

  beforeEach(() => {
    vi.clearAllMocks()
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  it('names the Bar counted today and the Cellar at the last count of every shelf', async () => {
    getItemActivity.mockResolvedValue({
      daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' },
      shelfCounts: [{ locationId: 'loc-bar', countedAt: new Date().toISOString() }],
    })
    renderRow(onShelves, shelves)
    expect(await screen.findByText('Bar counted today; Cellar counted 12 days ago')).toBeInTheDocument()
  })

  it('says a shelf was never counted when no count covers it', async () => {
    getItemActivity.mockResolvedValue({
      daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' },
      shelfCounts: [{ locationId: 'loc-bar', countedAt: new Date(Date.now() - day).toISOString() }],
    })
    renderRow({ ...onShelves, lastCounted: null }, shelves)
    expect(await screen.findByText('Bar counted yesterday; Cellar not counted yet')).toBeInTheDocument()
  })

  it('adds nothing when no shelf was counted on its own, or that is not known', async () => {
    getItemActivity.mockResolvedValue({
      daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' },
      shelfCounts: null,
    })
    renderRow(onShelves, shelves)
    expect(await screen.findByText('12 days ago')).toBeInTheDocument()
    expect(screen.queryByText(/Bar counted/)).not.toBeInTheDocument()
  })
})

/**
 * F-1163: the manual adjust and Record pour named no shelf, so a bottle broken
 * at the bar came off the oldest lot anywhere; and "+1 Breakage" put a bottle
 * on the books.
 */
describe('RowExpansion — adjust and pour name their shelf', () => {
  const shelves = [
    { id: 'loc-cellar', name: 'Cellar', capacity: null, currentCount: 0, color: '' },
    { id: 'loc-bar', name: 'Bar', capacity: null, currentCount: 0, color: '' },
  ]
  const split = {
    liveStock: 11,
    saleType: 'glass',
    locations: [
      { locationId: 'loc-cellar', qty: 8, wac: null },
      { locationId: 'loc-bar', qty: 3, wac: null },
    ],
  } as Partial<InventoryItem>

  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
    adjustStock.mockResolvedValue({})
    recordPour.mockResolvedValue({ pour: {}, item: null })
  })

  it('[REVERT-FAILS] a take-off waits for the shelf, then leaves from it', async () => {
    renderRow(split, shelves)
    await userEvent.click(screen.getByRole('button', { name: 'Decrease manual adjustment' }))
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('Which shelf'), 'loc-bar')
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Breakage')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(adjustStock.mock.calls[0][1]).toMatchObject({ quantityChange: -1, reason: 'Breakage', fromLocationId: 'loc-bar' })
  })

  it('[REVERT-FAILS] a pour comes off the picked shelf', async () => {
    renderRow(split, shelves)
    expect(screen.getByRole('button', { name: 'Record pour' })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Which shelf'), 'loc-bar')
    await userEvent.click(screen.getByRole('button', { name: 'Record pour' }))
    expect(recordPour).toHaveBeenCalledWith('inv-1', expect.objectContaining({ locationId: 'loc-bar' }))
  })

  it('[REVERT-FAILS] refuses +1 for breakage, a comp or a staff pour, in words', async () => {
    renderRow({ liveStock: 4 })
    await userEvent.click(screen.getByRole('button', { name: 'Increase manual adjustment' }))
    for (const why of ['Breakage', 'Comp / gift', 'Staff pour']) {
      await userEvent.selectOptions(screen.getByLabelText('Reason'), why)
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
      expect(screen.getByRole('alert')).toHaveTextContent(/only takes bottles off/i)
    }
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'Count correction')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // F-1271: every shelf in the house was offered, and a take-off past what the
  // picked shelf held came off other shelves without a word.
  it('[REVERT-FAILS] a take-off offers only the shelves holding the wine, with their counts', async () => {
    const withRack = [...shelves, { id: 'loc-rack', name: 'Rack 3', capacity: null, currentCount: 0, color: '' }]
    renderRow(split, withRack)
    await userEvent.click(screen.getByRole('button', { name: 'Decrease manual adjustment' }))
    const offered = Array.from(screen.getByLabelText('Which shelf').querySelectorAll('option'))
      .filter((o) => o.value !== '')
      .map((o) => o.textContent)
    expect(offered).toEqual(['Cellar (8)', 'Bar (3)'])
    // Bottles found may still go onto the empty rack.
    await userEvent.click(screen.getByRole('button', { name: 'Increase manual adjustment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Increase manual adjustment' }))
    expect(screen.getByRole('option', { name: 'Rack 3 (0)' })).toBeInTheDocument()
  })

  it('[REVERT-FAILS] refuses, in words, more off a shelf than it holds', async () => {
    renderRow(split, shelves)
    await userEvent.selectOptions(screen.getByLabelText('Which shelf'), 'loc-bar')
    for (let i = 0; i < 4; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Decrease manual adjustment' }))
    }
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Bar holds 3 of this wine. Take off 3 or fewer here, or pick another shelf.')
    await userEvent.click(screen.getByRole('button', { name: 'Increase manual adjustment' }))
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('with no shelves to pick, nothing is asked and no shelf is sent', async () => {
    renderRow({ liveStock: 4 })
    expect(screen.queryByLabelText('Which shelf')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Decrease manual adjustment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(adjustStock.mock.calls[0][1]).not.toHaveProperty('fromLocationId')
  })
})

/** F-1169 (re-hit of F-866): a lira house read "1.5 btl/day" and "2.5x". */
describe('RowExpansion — figures in the house locale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([{ id: 'o-1', inventoryId: 'inv-1', orderNumber: 'PO-1', createdAt: '2026-03-05T12:00:00Z', quantity: 6, status: 'DELIVERED' }])
    fetchAuctionLotRecords.mockResolvedValue([])
  })

  it('[REVERT-FAILS] velocity, markup and order dates use the house marks', async () => {
    setHouseLocale('tr-TR')
    try {
      renderRow({ velocityPerDay: 1.5, wac: 40, menuPriceBottle: 100 } as Partial<InventoryItem>)
      expect(screen.getAllByText('1,5 btl/day').length).toBeGreaterThan(0)
      expect(screen.getByText(/\(2,5x\)/)).toBeInTheDocument()
      expect(await screen.findByText('5 Mar')).toBeInTheDocument()
    } finally {
      setHouseLocale(null)
    }
  })
})

describe('RowExpansion — Reconcile N into live (F-1166)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getItemActivity.mockResolvedValue({ daily: [], heat: [], totalOut28d: 0, totalIn28d: 0, includes: { out: '', in: '', window: '' } })
    getOrders.mockResolvedValue([])
    fetchAuctionLotRecords.mockResolvedValue([])
    reconcileShadowItem.mockResolvedValue({ moved: 10 })
  })

  it('asks the server to move the shadow, never sends a count of live + shadow', async () => {
    renderRow({ liveStock: 3, shadowStock: 10 })

    await userEvent.click(screen.getByRole('button', { name: 'Reconcile 10 bottles into live' }))

    // A count of 13 set live to 13 and left shadow at 10: on hand grew by 10.
    expect(reconcileItem).not.toHaveBeenCalled()
    expect(reconcileShadowItem).toHaveBeenCalledTimes(1)
    expect(reconcileShadowItem).toHaveBeenCalledWith('inv-1')
  })
})
