/**
 * ADR 0134 §8, locked by the founder 2026-09-21 ("Lock all four (Recommended)"): /inventory
 * gets its reduced-motion guard, inside the component (App.tsx mounts this same
 * page on both arms of the gate), as a pure removal.
 *
 * Both halves are pinned: a reader who asks for less gets the attribute the
 * guard stylesheet keys on (`components/mudavym/reduced-motion.css`, pinned by
 * `components/mudavym/motionRules0134.test.ts`), and every other reader gets
 * markup with no trace of it — flag on or off, since the page is the same.
 *
 * The page's data hooks are mocked exactly as `InventoryCommandPage.wine-param
 * .test.tsx` mocks them; the page itself is real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
}));

// The response's own shape (posHub.ts, UnresolvedLinesResponse): the page reads
// `summary.open_lines` once the query settles, which the frame-waiting cases
// below give it time to do.
vi.mock('../../../services/api/posHub', () => ({
  getUnresolvedLines: vi.fn().mockResolvedValue({
    restaurant_id: 'rest-A',
    summary: {
      open_lines: 0,
      distinct_items: 0,
      unmapped: 0,
      no_sale_volume: 0,
      qty_total: 0,
      revenue_total: 0,
      truncated: false,
    },
    items: [],
  }),
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

function setReducedMotion(reduce: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

afterEach(() => {
  setReducedMotion(false);
  page.searchQuery = '';
});

describe('/inventory — the reduced-motion guard (ADR 0134 §8)', () => {
  it('leaves the page root untouched when motion is allowed', () => {
    setReducedMotion(false);
    const { container } = harness('/inventory');
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('p-6', 'max-w-[1500px]', 'mx-auto');
    expect(root).not.toHaveAttribute('data-reduced-motion');
  });

  it('marks the page root when the reader asks for less, so the guard stylesheet reaches every row', () => {
    setReducedMotion(true);
    const { container } = harness('/inventory');
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-reduced-motion', 'true');
    // The guard is a removal over what is already there: the same class strings
    // render inside it, and the stylesheet is what stops them.
    expect(root).toHaveClass('p-6', 'max-w-[1500px]', 'mx-auto');
  });
});

/** Let framer-motion's frame loop run `n` animation frames. */
async function frames(n: number) {
  for (let i = 0; i < n; i += 1) {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
}

/** Open "Add wine" and return the modal's panel — the framer element that rises. */
function openAddWine(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: /Add wine/ }));
  const panel = screen.getByText('Add Wine to Inventory').closest('.rounded-3xl') as HTMLElement | null;
  if (!panel) throw new Error('the Add wine modal did not open');
  return panel;
}

/* The legacy modals /inventory opens animate through framer-motion, some of
   them portalled out of the page root where the CSS half cannot reach. Each
   case has its full-motion control, so a guard that stopped every animation,
   or none, fails one of the pair. */
describe('/inventory — the guard reaches the framer-motion modals it opens (ADR 0134 §8)', () => {
  it('at full motion the modal still rises and fades in over its frames', async () => {
    setReducedMotion(false);
    harness('/inventory');
    const panel = openAddWine();
    await frames(2);
    expect(Number(panel.style.opacity)).toBeLessThan(1);
    await waitFor(() => expect(panel.style.opacity).toBe('1'));
  });

  it('under reduced motion the modal is simply there: no fade, no scale, no rise', async () => {
    setReducedMotion(true);
    harness('/inventory');
    const panel = openAddWine();
    await frames(2);
    expect(panel.style.opacity).toBe('1');
    expect(panel.style.transform).toBe('none');
  });
});
