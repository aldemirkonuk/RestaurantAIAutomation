/**
 * `/inventory?wine=<name>` — the deep link `low-stock-alert.template.ts`'s
 * email CTA and `sw.js`'s push action both send (InventoryCommandPage.tsx
 * `?wine=` effect).
 *
 * R1/F5: this reader existed before the lane's
 * F1-F6 pass, but no test ever pinned it — reverting it to a no-op (or
 * applying the param on every render instead of once) kept every existing
 * suite green. This file is that missing pin.
 *
 * The page's own data hooks are mocked wholesale (its own correctness is not
 * this file's job); this is only about whether `?wine=` reaches
 * `setSearchQuery`, once, and is reflected in the visible search box.
 *
 * F-831: also `/inventory?count=<inventoryId>` — "Count again" on the
 * app-wide not-sent strip opens that item's row with its spot count up.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
      filteredInventoryAnyPlace: page.items,
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

vi.mock('../../../lib/spotCountOutbox', async (importOriginal) => ({
  // The app-wide sync manager reads the rest of this module.
  ...(await importOriginal<typeof import('../../../lib/spotCountOutbox')>()),
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

// The expanded row is its own component with its own suite; here only which
// row opens, and whether it opens with the count up.
vi.mock('./RowExpansion', () => ({
  RowExpansion: ({ item, startCounting }: { item: { name: string }; startCounting?: boolean }) => (
    <div data-testid="row-open">
      {item.name}
      {startCounting ? ' counting' : ''}
    </div>
  ),
}));

import { InventoryCommandPage } from './InventoryCommandPage';

function Where() {
  return <div data-testid="where">{useLocation().search}</div>;
}

/** The palette's "Search the cellar for x", sent while this page is open. */
function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid={`go ${to}`} onClick={() => navigate(to)}>
      go
    </button>
  );
}

function harness(path: string, goes: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <InventoryCommandPage />
        <Where />
        {goes.map((to) => (
          <Go key={to} to={to} />
        ))}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  page.searchQuery = '';
  page.items = [];
});

describe('?wine= deep link', () => {
  it('applies the named wine to the search box once, on mount', () => {
    harness('/inventory?wine=Barolo');

    expect(setSearchQuery).toHaveBeenCalledTimes(1);
    expect(setSearchQuery).toHaveBeenCalledWith('Barolo');
  });

  // F-1354: the page stays mounted when the palette searches from it; a
  // read-once guard left the second search a new address and the same list.
  it('applies a second palette search made from this page, even the same name again', () => {
    harness('/inventory?wine=Barolo', ['/inventory?wine=Chablis', '/inventory?wine=Barolo']);
    expect(setSearchQuery).toHaveBeenLastCalledWith('Barolo');

    fireEvent.click(screen.getByTestId('go /inventory?wine=Chablis'));
    expect(setSearchQuery).toHaveBeenLastCalledWith('Chablis');

    fireEvent.click(screen.getByTestId('go /inventory?wine=Barolo'));
    expect(setSearchQuery).toHaveBeenLastCalledWith('Barolo');
    expect(setSearchQuery).toHaveBeenCalledTimes(3);
  });

  it('keeps the name as the search box\'s own ?q= and drops ?wine=', () => {
    // The real hook's searchQuery after setSearchQuery('Barolo') (see below).
    page.searchQuery = 'Barolo';
    harness('/inventory?wine=Barolo');
    expect(screen.getByTestId('where').textContent).toBe('?q=Barolo');
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

    const input = screen.getByPlaceholderText(/Search drinks, producers, grapes/i) as HTMLInputElement;
    expect(input.value).toBe('Barolo');
  });
});

/**
 * F-550: the command palette's "Add wine" sends `/inventory?add=1`. Before,
 * it sent `/wines?add=1` and no page read `add`, so the person landed on a
 * list with nothing opened.
 */
describe('?add=1 deep link', () => {
  it('opens the add-wine chooser and drops the param', async () => {
    harness('/inventory?add=1');

    expect(await screen.findByText('Single Wine')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('');
  });

  it('keeps the chooser shut without the param', () => {
    harness('/inventory');

    expect(screen.queryByText('Single Wine')).not.toBeInTheDocument();
  });
});

/**
 * F-1712: /count, on a house with no shelves, links `/inventory?shelves=1`;
 * the shelf manager opens on it.
 */
describe('?shelves=1 deep link', () => {
  it('opens the shelf manager and drops the param', async () => {
    harness('/inventory?shelves=1');

    expect(await screen.findByText('Storage Locations')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('');
  });

  it('keeps the shelf manager shut without the param', () => {
    harness('/inventory');

    expect(screen.queryByText('Storage Locations')).not.toBeInTheDocument();
  });
});

describe('?filter=low-stock deep link (F-217)', () => {
  // The low-stock notifications, the digest email and its push all link
  // /inventory?filter=low-stock; the page opens on "Below par" for it.
  const pressedBelowPar = () =>
    screen
      .queryAllByRole('button', { pressed: true })
      .filter((b) => /Below par/.test(b.textContent ?? ''));

  it('opens on Below par', () => {
    harness('/inventory?filter=low-stock');
    expect(pressedBelowPar()).toHaveLength(1);
  });

  it('opens on the whole cellar without it', () => {
    harness('/inventory');
    expect(pressedBelowPar()).toHaveLength(0);
  });
});

describe('?count= deep link (F-831)', () => {
  const barolo = {
    inventoryId: 'inv-1',
    name: 'Barolo 2019',
    liveStock: 3,
    shadowStock: 0,
    threshold: 2,
  };

  it("opens that item's row with its spot count up", () => {
    page.items = [barolo];
    harness('/inventory?count=inv-1');

    expect(screen.getByTestId('row-open').textContent).toBe('Barolo 2019 counting');
  });

  it('opens no row, and no count, without the link', () => {
    page.items = [barolo];
    harness('/inventory');

    expect(screen.queryByTestId('row-open')).toBeNull();
  });
});
