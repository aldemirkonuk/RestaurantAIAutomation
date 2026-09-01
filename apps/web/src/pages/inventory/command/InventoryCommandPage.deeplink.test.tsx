/**
 * `/inventory?filter=` and `/inventory?highlight=` receiving side.
 *
 * `?verify=` already worked (InventoryCommandPage.tsx:199) — it was the only
 * parameter this page read. `?filter=low` (Dashboard.tsx:320) and
 * `?highlight=<id>` (Dashboard.tsx:978, OneTapActionCenter.tsx:184, and the
 * gateway's own low-stock alerts at dashboard.service.ts:723) all arrived at
 * an unfiltered table with nothing selected.
 *
 * The interesting cases are the two honest ones: an id the dashboard emitted
 * as a MASTER WINE id rather than an inventory row id must still land, and an
 * id that resolves to nothing must be said in words while the table stays
 * whole underneath.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { InventoryItem } from '../index'

const state = vi.hoisted(() => ({
  inventory: [] as InventoryItem[],
  isLoading: false,
  searchQuery: '',
}))

vi.mock('../index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../index')>()
  return {
    ...mod,
    useInventoryPage: () => ({
      searchQuery: state.searchQuery,
      setSearchQuery: (v: string) => {
        state.searchQuery = v
      },
      filterType: 'all',
      setFilterType: vi.fn(),
      selectedLocationFilter: 'all',
      setSelectedLocationFilter: vi.fn(),
      inventory: state.inventory,
      filteredInventory: state.inventory,
      isLoading: state.isLoading,
      stats: { total: state.inventory.length, liveTotal: 0, shadowTotal: 0, low: 0, critical: 0 },
      refetchInventory: vi.fn(() => Promise.resolve()),
      updateInventoryItem: vi.fn(),
    }),
  }
})

vi.mock('../../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({
    locations: [],
    setLocations: vi.fn(),
    mappings: {},
    assignWineToLocation: vi.fn(),
  }),
}))
vi.mock('../../../hooks/queries', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../hooks/queries')>()
  return {
    ...mod,
    useCreateInventoryItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useWines: () => ({ data: [], isFetching: false, isLoading: false, error: null }),
    useWinesByIds: () => ({ data: [], isPending: false }),
  }
})
vi.mock('../../../services/api/orders', () => ({ getOrders: () => Promise.resolve([]) }))
vi.mock('../../../services/api/inventory', () => ({ getInventory: () => Promise.resolve([]) }))
vi.mock('../../../contexts/RealtimeContext', () => ({
  useTypedInventorySubscription: () => undefined,
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ availableRestaurants: [], refreshBranches: vi.fn(() => Promise.resolve()) }),
}))
vi.mock('../../../lib/spotCountOutbox', () => ({ watchSpotCountOutbox: () => () => undefined }))
vi.mock('../../../components/insights/ContextualInsights', () => ({
  ContextualInsights: () => null,
}))
vi.mock('../../../components/layout/RestaurantBranchSwitcher', () => ({
  RestaurantBranchSwitcher: () => null,
}))
vi.mock('./RowExpansion', () => ({
  RowExpansion: () => <div data-testid="row-expansion" />,
}))
vi.mock('./ReceivingWorkspace', () => ({ ReceivingWorkspace: () => null }))
vi.mock('./CellarMapView', () => ({ CellarMapView: () => null }))
// Modals that mount unconditionally and pull in their own data layers. None of
// them participate in URL handling.
vi.mock('../../../components/inventory/StorageLocationManager', () => ({
  StorageLocationManager: () => null,
}))
vi.mock('../../../components/inventory/AddWineToInventoryModal', () => ({
  AddWineToInventoryModal: () => null,
}))
vi.mock('../../../components/inventory/AutoLocatePreviewModal', () => ({
  AutoLocatePreviewModal: () => null,
}))
vi.mock('../../../components/inventory/RemoveFromInventoryModal', () => ({
  RemoveFromInventoryModal: () => null,
}))
vi.mock('../../../components/inventory/ManualReceiptWorkspace', () => ({
  ManualReceiptWorkspace: () => null,
}))
vi.mock('../../../components/wines/AddWineSelectionModal', () => ({
  AddWineSelectionModal: () => null,
}))
vi.mock('../../../components/scanner/MenuScannerFlow', () => ({ MenuScannerFlow: () => null }))

import { InventoryCommandPage } from './InventoryCommandPage'

function item(over: Partial<InventoryItem> & { inventoryId: string; id: string }): InventoryItem {
  return {
    name: 'A Wine',
    displayName: undefined,
    producer: 'A Producer',
    vintage: 2021,
    price: 40,
    type: 'red',
    grape: 'Chardonnay',
    country: 'France',
    region: 'Burgundy',
    appellation: 'Chablis',
    body: 'medium',
    sweetness: 'dry',
    acidity: 'medium',
    alcohol: 13,
    aromas: [],
    flavors: [],
    liveStock: 20,
    shadowStock: 0,
    threshold: 6,
    lastCounted: new Date().toISOString(),
    isActive: true,
    bottleSizeMl: 750,
    provider: { name: '', contact: '', phone: '', email: undefined, address: undefined },
    ...over,
  } as unknown as InventoryItem
}

/** Below par: liveStock at or under half the threshold trips the `low` flag. */
const LOW = item({ inventoryId: 'inv-low', id: 'wine-low', name: 'Chablis', liveStock: 1, threshold: 12 })
const HEALTHY = item({ inventoryId: 'inv-ok', id: 'wine-ok', name: 'Barolo', liveStock: 40, threshold: 6 })

function at(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(<InventoryCommandPage />, { wrapper })
}

beforeEach(() => {
  state.inventory = [LOW, HEALTHY]
  state.isLoading = false
  state.searchQuery = ''
  Element.prototype.scrollIntoView = vi.fn()
})

describe('?filter=', () => {
  it('shows every wine with no parameter', () => {
    at('/inventory')
    expect(screen.getByText('Chablis')).toBeInTheDocument()
    expect(screen.getByText('Barolo')).toBeInTheDocument()
  })

  it('narrows the table to below-par wines for ?filter=low', () => {
    at('/inventory?filter=low')
    expect(screen.getByText('Chablis')).toBeInTheDocument()
    expect(screen.queryByText('Barolo')).toBeNull()
  })

  it('accepts the ?filter=low-stock spelling Notifications.tsx emits', () => {
    at('/inventory?filter=low-stock')
    expect(screen.queryByText('Barolo')).toBeNull()
  })

  it('says so for a view this page does not have, and filters nothing', () => {
    at('/inventory?filter=wormhole')
    expect(screen.getByTestId('deep-link-notice')).toHaveTextContent('wormhole')
    expect(screen.getByText('Chablis')).toBeInTheDocument()
    expect(screen.getByText('Barolo')).toBeInTheDocument()
  })
})

describe('?highlight=', () => {
  it('expands the named inventory row', () => {
    at('/inventory?highlight=inv-ok')
    expect(screen.getByTestId('row-expansion')).toBeInTheDocument()
  })

  it('also accepts the master wine id the dashboard emits', () => {
    // Dashboard.tsx:973 sends `wine.id || wine.wineId`, and those are two
    // different keys — the row id and the master wine id.
    at('/inventory?highlight=wine-ok')
    expect(screen.getByTestId('row-expansion')).toBeInTheDocument()
  })

  it('says so when the row is gone, and leaves the table whole', () => {
    at('/inventory?highlight=inv-deleted')
    const notice = screen.getByTestId('deep-link-notice')
    expect(notice).toHaveTextContent('inv-deleted')
    expect(notice).toHaveTextContent('Nothing below has been filtered or hidden')
    expect(screen.getByText('Chablis')).toBeInTheDocument()
    expect(screen.getByText('Barolo')).toBeInTheDocument()
    expect(screen.queryByTestId('row-expansion')).toBeNull()
  })

  it('does NOT claim the row is gone while the inventory query is loading', () => {
    state.inventory = []
    state.isLoading = true
    at('/inventory?highlight=inv-ok')
    expect(screen.queryByTestId('deep-link-notice')).toBeNull()
  })
})
