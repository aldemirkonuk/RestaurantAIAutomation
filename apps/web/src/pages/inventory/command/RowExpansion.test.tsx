import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RowExpansion } from './RowExpansion'
import type { InventoryItem } from '../useInventoryPage'

const navigate = vi.hoisted(() => vi.fn())
const getItemActivity = vi.hoisted(() => vi.fn())
const getOrders = vi.hoisted(() => vi.fn())
const transferStock = vi.hoisted(() => vi.fn())
const fetchAuctionLotRecords = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../../../services/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/inventory')>(
    '../../../services/api/inventory',
  )
  return { ...actual, getItemActivity, transferStock, fetchAuctionLotRecords }
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
// The real select renders a portal/popover this test has no reason to drive.
vi.mock('../../../components/ui/ThemedSelect', () => ({ ThemedSelect: () => null }))

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
   * Regression: this button used to navigate to `/documents`, which is not a
   * route in App.tsx, so every click hit the `*` catch-all and bounced the user
   * to the dashboard. The documents surface is `/documents-reports`.
   */
  it('navigates to the real documents route', async () => {
    renderRow()

    await userEvent.click(screen.getByRole('button', { name: /view ledger/i }))

    expect(navigate).toHaveBeenCalledWith('/documents-reports')
  })

  it('does not carry an inventory id the destination cannot use', async () => {
    renderRow()

    await userEvent.click(screen.getByRole('button', { name: /view ledger/i }))

    const target = navigate.mock.calls[0][0] as string
    expect(target).not.toContain('ledger=')
    expect(target).not.toContain('inv-1')
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

    const [from, to] = screen.getAllByRole('combobox')
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

    const [from, to] = screen.getAllByRole('combobox')
    await userEvent.selectOptions(from, 'loc-b')
    await userEvent.selectOptions(to, 'loc-a')
    await userEvent.click(screen.getByRole('button', { name: /^move$/i }))

    expect(transferStock.mock.calls[0][1].fromLocationId).toBe('loc-b')
    expect(transferStock.mock.calls[0][1].fromLocationId).not.toBeNull()
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
