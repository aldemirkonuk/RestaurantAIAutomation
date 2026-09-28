/**
 * `/inventory?wine=<name>` — the deep link `low-stock-alert.template.ts`'s
 * email CTA and `sw.js`'s push action both send (InventoryCommandPage.tsx
 * `appliedWineParam`).
 *
 * R1/F5: this reader existed before the lane's
 * F1-F6 pass, but no test ever pinned it — reverting it to a no-op (or
 * applying the param on every render instead of once) kept every existing
 * suite green. This file is that missing pin.
 *
 * The page's own data hooks are mocked wholesale (its own correctness is not
 * this file's job); this is only about whether `?wine=` reaches
 * `setSearchQuery`, once, and is reflected in the visible search box.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const setSearchQuery = vi.fn();
const page = vi.hoisted(() => ({ searchQuery: '' as string }));

vi.mock('../index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>();
  return {
    ...actual,
    useInventoryPage: () => ({
      searchQuery: page.searchQuery,
      setSearchQuery,
      filterType: 'all',
      setFilterType: vi.fn(),
      selectedLocationFilter: null,
      setSelectedLocationFilter: vi.fn(),
      inventory: [],
      filteredInventory: [],
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
    }),
  };
});

vi.mock('../../../hooks/useStorageLocations', () => ({
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
    refreshBranches: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../contexts/RealtimeContext', () => ({
  useTypedInventorySubscription: () => {},
}));

vi.mock('../../../lib/spotCountOutbox', () => ({
  watchSpotCountOutbox: () => () => {},
}));

vi.mock('../../../services/api/orders', () => ({
  getOrders: vi.fn().mockResolvedValue([]),
  // The deliveries-to-name card (ADR 0192, components/mudavym) reads this on
  // the same page; nothing waits to be named in this harness.
  fetchDeliveriesToName: vi.fn().mockResolvedValue({
    viewer: { mayName: false, mayNameReason: null },
    deliveries: [],
  }),
}));

vi.mock('../../../services/api/posHub', () => ({
  getUnresolvedLines: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/api/client')>();
  return { ...actual, getActiveRestaurantId: () => 'rest-A' };
});

vi.mock('../../../components/insights/ContextualInsights', () => ({
  ContextualInsights: () => null,
}));

import { InventoryCommandPage } from './InventoryCommandPage';

function harness(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <InventoryCommandPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  page.searchQuery = '';
});

describe('?wine= deep link', () => {
  it('applies the named wine to the search box once, on mount', () => {
    harness('/inventory?wine=Barolo');

    expect(setSearchQuery).toHaveBeenCalledTimes(1);
    expect(setSearchQuery).toHaveBeenCalledWith('Barolo');
  });

  it('does not touch the search box when no wine is named', () => {
    harness('/inventory');

    expect(setSearchQuery).not.toHaveBeenCalled();
  });

  it('reflects the applied name in the visible search input', () => {
    // The effect calls setSearchQuery, which in the real hook would update
    // searchQuery and re-render; the mock does not wire that loop back
    // automatically, so this simulates the post-effect render directly.
    page.searchQuery = 'Barolo';
    harness('/inventory?wine=Barolo');

    const input = screen.getByPlaceholderText(/Search wines, producers, grapes/i) as HTMLInputElement;
    expect(input.value).toBe('Barolo');
  });
});
