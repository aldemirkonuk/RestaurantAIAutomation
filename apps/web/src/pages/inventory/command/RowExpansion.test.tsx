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
const adjustStock = vi.hoisted(() => vi.fn())
const reconcileItem = vi.hoisted(() => vi.fn())
const recordSpotCount = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../../../services/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/inventory')>(
    '../../../services/api/inventory',
  )
  return { ...actual, getItemActivity, transferStock, fetchAuctionLotRecords, adjustStock, reconcileItem, recordSpotCount }
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

    await userEvent.click(screen.getByRole('button', { name: '-' }))
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

    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole('button', { name: '-' }))
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
    expect(scope).toHaveTextContent(/every bottle of this wine in every room/i)
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
