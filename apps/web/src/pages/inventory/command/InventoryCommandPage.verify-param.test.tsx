/**
 * `/inventory?verify=<orderId>` for an order that is NOT waiting in the
 * to-verify queue (F-710). The "Delivery discrepancy — Review match" bell
 * links here for a delivery the match already closed (COMPLETED), and a
 * "Verify receipt" link can be stale or older than the newest 50. The page
 * used to open nothing and say nothing. It now reads the order and says where
 * it stands.
 *
 * Harness copied from InventoryCommandPage.wine-param.test.tsx: the page's
 * own data hooks are mocked wholesale; this file is only about `?verify=`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { InventoryCommandPage, verifyLinkNotice } from './InventoryCommandPage';

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

const order = (over: Record<string, unknown> = {}) => ({
  id: 'ord-9',
  orderNumber: 'ORD-2026-00042',
  restaurantId: 'rest-A',
  inventoryId: 'inv-1',
  providerId: 'prov-1',
  quantity: 6,
  status: 'COMPLETED',
  ...over,
});

beforeEach(() => {
  getOrders.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  page.searchQuery = '';
});

describe('?verify= for an order that is not in the queue', () => {
  it('[REVERT-FAILS] says a closed delivery was already checked, with the date, and points at Credits', async () => {
    getOrder.mockResolvedValue(order({ matchVerifiedAt: '2026-10-08T10:00:00.000Z' }));
    harness('/inventory?verify=ord-9');

    const notice = await screen.findByTestId('verify-link-notice');
    expect(getOrder).toHaveBeenCalledWith('ord-9');
    expect(notice).toHaveTextContent('Order ORD-2026-00042 was already checked on');
    expect(notice).toHaveTextContent(new Date('2026-10-08T10:00:00.000Z').toLocaleDateString());
    expect(notice).toHaveTextContent('Receipts › Credits');
    expect(screen.getByRole('button', { name: 'Open Credits' })).toBeTruthy();
  });

  it('[REVERT-FAILS] says when the order is not in this house', async () => {
    getOrder.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404 } }));
    harness('/inventory?verify=ord-x');

    expect(await screen.findByTestId('verify-link-notice')).toHaveTextContent(
      'is not in this house',
    );
  });

  it('does not read the order when it is waiting in the queue', async () => {
    getOrders.mockImplementation(async (p: { status?: string }) =>
      p?.status === 'delivered' ? [order({ status: 'DELIVERED' })] : [],
    );
    harness('/inventory?verify=ord-9');

    await new Promise((r) => setTimeout(r, 20));
    expect(getOrder).not.toHaveBeenCalled();
    expect(screen.queryByTestId('verify-link-notice')).toBeNull();
  });
});

describe('verifyLinkNotice, on its own', () => {
  it('names every state in words', () => {
    expect(verifyLinkNotice(order({ status: 'COMPLETED' }) as any, null, false)?.text).toBe(
      'Order ORD-2026-00042 was already checked and is closed. Any money the vendor owes back is on Receipts › Credits.',
    );
    expect(verifyLinkNotice(order({ status: 'CANCELLED' }) as any, null, false)?.text).toMatch(/was cancelled/);
    expect(verifyLinkNotice(order({ status: 'IN_TRANSIT' }) as any, null, false)?.text).toMatch(/not been delivered yet/);
    const older = verifyLinkNotice(order({ status: 'DELIVERED' }) as any, null, false);
    expect(older?.text).toMatch(/still waiting to be checked/);
    expect(older?.to).toBe('/receiving?order=ord-9');
    expect(verifyLinkNotice(undefined, new Error('Network Error'), false)?.text).toMatch(/could not be looked up/);
  });
});
