/**
 * F-1457 (sim 48, integ19-w95-97-regress.md): "Load opening stock" sorts the
 * file against the wines already carried. While the wine list is still being
 * read, or its read failed, that set is the empty array the hook hands back,
 * not "this house carries nothing" — and every wine in the file was received
 * again on top of the cellar. The import now waits for a read that answered.
 *
 * Harness copied from InventoryCommandPage.verify-param.test.tsx: the page's
 * own data hooks are mocked wholesale; this file is only about the import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const page = vi.hoisted(() => ({
  listKnown: false as boolean | undefined,
  hasFailedRead: false,
  inventory: [] as Array<Record<string, unknown>>,
}));

vi.mock('../index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>();
  return {
    ...actual,
    useInventoryPage: () => ({
      searchQuery: '',
      setSearchQuery: vi.fn(),
      filterType: 'all',
      setFilterType: vi.fn(),
      selectedLocationFilter: null,
      setSelectedLocationFilter: vi.fn(),
      inventory: page.inventory,
      filteredInventory: [],
      filteredInventoryAnyPlace: [],
      stats: {
        total: 0,
        liveTotal: 0,
        shadowTotal: 0,
        critical: 0,
        low: 0,
        atPar: 0,
        healthy: 0,
        unknown: 0,
        needsReconciliation: 0,
      },
      refetchInventory: vi.fn(),
      updateInventoryItem: vi.fn(),
      error: page.hasFailedRead ? 'the gateway did not answer' : null,
      hasFailedRead: page.hasFailedRead,
      figuresUnknown: page.hasFailedRead || !page.listKnown,
      inventoryListKnown: page.listKnown,
    }),
  };
});

vi.mock('../../../hooks/useStorageLocations', () => ({
  // ADR 0238: the manager asks who may set up zones (it is closed here).
  useZoneSetupAccess: () => ({ maySetUp: false, unknown: true, loading: true, assigned: null }),
  useStorageLocations: () => ({
    locations: [],
    setLocations: vi.fn(),
    mappings: [],
    assignWineToLocation: vi.fn(),
    locationsLoading: false,
    locationsUnavailable: false,
    mappingsUnavailable: false,
    // `StorageLocationManager` always mounts (its `isOpen` prop only hides
    // the rendered output), so it always calls the rest of this hook's
    // surface too.
    getLocationsWithActualCounts: () => [],
    removeWineFromLocation: vi.fn(),
    addLocation: vi.fn(),
    updateLocation: vi.fn(),
    deleteLocation: vi.fn(),
    updateWineQuantityAtLocation: vi.fn(),
    getLocationStats: () => ({
      totalLocations: 0,
      totalCapacity: null,
      capacityUnknownCount: 0,
      totalUsed: 0,
      usedInMeasured: 0,
      utilizationRate: null,
    }),
    recalculateLocationCounts: vi.fn(),
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    availableRestaurants: [{ id: 'rest-A', name: 'Rest A' }],
    activeRole: 'owner',
    refreshBranches: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../contexts/RealtimeContext', () => ({
  useTypedInventorySubscription: () => {},
}));

vi.mock('../../../lib/spotCountOutbox', () => ({
  watchSpotCountOutbox: () => () => {},
}));

const getOrder = vi.hoisted(() => vi.fn());
const getOrders = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api/orders', () => ({
  getOrders,
  getOrder,
  // The deliveries-to-name card (ADR 0192, components/mudavym) reads this on
  // the same page; nothing waits to be named in this harness.
  fetchDeliveriesToName: vi.fn().mockResolvedValue({
    viewer: { mayName: false, mayNameReason: null },
    deliveries: [],
  }),
}));

vi.mock('../../../services/api/posHub', () => ({
  // Shaped like the real answer: these tests wait for a read, so the chip
  // that reads `summary.open_lines` does render.
  getUnresolvedLines: vi.fn().mockResolvedValue({ summary: { open_lines: 0 }, lines: [] }),
}));

vi.mock('../../../services/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/api/client')>();
  return { ...actual, getActiveRestaurantId: () => 'rest-A' };
});

vi.mock('../../../components/insights/ContextualInsights', () => ({
  ContextualInsights: () => null,
}));

import { fireEvent } from '@testing-library/react';
import { InventoryCommandPage } from './InventoryCommandPage';

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inventory']}>
        <InventoryCommandPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getOrders.mockResolvedValue([]);
  getOrder.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  page.listKnown = false;
  page.hasFailedRead = false;
  page.inventory = [];
});

const loadButton = () => screen.getByRole('button', { name: /Load opening stock/ });

describe('opening stock waits for the wine list (F-1457)', () => {
  it('[REVERT-FAILS] is not offered while the wine list is still being read', () => {
    page.listKnown = false;
    harness();
    expect(loadButton()).toBeDisabled();
    fireEvent.click(loadButton());
    expect(screen.queryByTestId('opening-stock-import')).toBeNull();
  });

  it('[REVERT-FAILS] is not offered when the wine list could not be read', () => {
    page.listKnown = false;
    page.hasFailedRead = true;
    harness();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be reached');
    expect(loadButton()).toBeDisabled();
    fireEvent.click(loadButton());
    expect(screen.queryByTestId('opening-stock-import')).toBeNull();
  });

  it('control: once the list has answered, the import opens', () => {
    page.listKnown = true;
    harness();
    expect(loadButton()).not.toBeDisabled();
    fireEvent.click(loadButton());
    expect(screen.getByTestId('opening-stock-import')).toBeTruthy();
  });
});
