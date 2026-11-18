/**
 * The bottle card on a phone (N-11): two lines per bottle in place of the
 * 1,330 px table, the same expansion in a bottom sheet, and the desktop table
 * untouched. The page's data hooks are mocked wholesale, as in
 * `InventoryCommandPage.wine-param.test.tsx`; this file is about which
 * layout a window width gets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const setSearchQuery = vi.fn();
const page = vi.hoisted(() => ({ searchQuery: '' as string, items: [] as unknown[] }));

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
      inventory: page.items,
      filteredInventory: page.items,
      stats: {
        total: page.items.length,
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

vi.mock('./RowExpansion', () => ({
  RowExpansion: ({ item }: { item: { name: string } }) => <div data-testid="expansion">expanded {item.name}</div>,
}));

import { InventoryCommandPage } from './InventoryCommandPage';

const bottle = (id: string, name: string, live: number | null, par: number, price?: number) => ({
  id,
  inventoryId: id,
  name,
  type: 'red',
  liveStock: live,
  shadowStock: 0,
  threshold: par,
  menuPriceBottle: price,
});

function viewport(phone: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: phone && q.includes('max-width: 767px'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

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
  page.items = [bottle('a', 'Barolo Cannubi', 12, 4, 120), bottle('b', 'Etna Rosso', 0, 3), bottle('c', 'Unknown Count', null, 2)];
});
afterEach(() => {
  vi.clearAllMocks();
  page.items = [];
});

describe('InventoryCommandPage on a phone', () => {
  it('shows one two-line card per bottle, with live, par and price', () => {
    viewport(true);
    harness();
    const cards = screen.getAllByTestId('bottle-card');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText('Barolo Cannubi')).toBeTruthy();
    expect(within(cards[0]).getByText('12 live · par 4')).toBeTruthy();
    expect(within(cards[0]).getByText('$120.00')).toBeTruthy();
    // Said in a word as well as a colour; an unknown count is a dash, not zero.
    expect(within(cards[1]).getByText('Critical')).toBeTruthy();
    expect(within(cards[1]).getByText('no price set')).toBeTruthy();
    expect(within(cards[2]).getByText('– live · par 2')).toBeTruthy();
  });

  it('opens the same expansion in a bottom sheet and closes it', () => {
    viewport(true);
    harness();
    expect(screen.queryByTestId('expansion')).toBeNull();
    fireEvent.click(screen.getAllByTestId('bottle-card')[0]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('expansion').textContent).toBe('expanded Barolo Cannubi');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('expansion')).toBeNull();
  });

  it('drops the column header a phone cannot hold', () => {
    viewport(true);
    harness();
    const header = screen.getByText('Runway').closest('div[style]');
    expect(header?.className).toMatch(/max-md:hidden/);
  });
});

describe('InventoryCommandPage on a desktop', () => {
  it('keeps the table, and no card or sheet', () => {
    viewport(false);
    harness();
    expect(screen.queryByTestId('bottle-card')).toBeNull();
    expect(screen.getByText('Barolo Cannubi')).toBeTruthy();
    fireEvent.click(screen.getByText('Barolo Cannubi'));
    // The expansion opens inline, in the row, never as a dialog.
    expect(screen.getByTestId('expansion')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('inventory-touch.css', () => {
  const css = readFileSync(resolve(__dirname, 'inventory-touch.css'), 'utf8');
  it('is scoped to coarse pointers and the page root, with 44 px targets and 16 px fields', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)/);
    expect(css).toMatch(/\.inv-touch button[\s\S]*?min-height: 44px/);
    expect(css).toMatch(/font-size: 16px/);
    expect(css).not.toMatch(/transition|animation|#[0-9a-fA-F]{3,8}\b/);
  });
  it('the page root carries the scope class', () => {
    viewport(false);
    const { container } = harness();
    expect(container.querySelector('.inv-touch')).toBeTruthy();
  });
});
