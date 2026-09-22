/**
 * InventoryCommandPage — failed-read render contract.
 *
 * `/inventory` had ZERO render coverage anywhere in the suite before this
 * file: `find apps/web/src/pages/inventory/command -name 'InventoryCommandPage.test.*'`
 * returned nothing (wave4/live-confirm.md §2). That review's own mount of
 * the page (with every read failing) found two live defects, both fixed on
 * this branch (wave5/live-fix.md):
 *
 *  1. The failed-read banner keyed on the inventory-list query alone, so a
 *     summary- or low-stock-only failure raised no banner while the figures
 *     those two feed still rendered zero.
 *  2. Even with the banner up, 12 KPI/flag figures on the page rendered as
 *     a literal `0` — indistinguishable from "this house owns none of this
 *     wine" (CLAUDE.md §9: a failed read is an error, not an empty success).
 *
 * Real hooks throughout (`useInventoryPage` → `useInventoryData` →
 * `useInventory`/`useInventorySummary`/`useLowStockItems`), with HTTP mocked
 * at `apiClient` — the layer every service module this tree touches
 * (inventory, orders, pos-hub, storage-locations, analytics) is built on —
 * so one mock exercises the real failure path end to end rather than hiding
 * the hooks under test behind a mocked hook (house convention, see
 * dashboard/next/DashboardNext.test.tsx).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    post: (...args: unknown[]) => api.post(...args),
    patch: (...args: unknown[]) => api.patch(...args),
    delete: (...args: unknown[]) => api.delete(...args),
  },
  getActiveRestaurantId: () => 'rest-A',
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', restaurantId: 'rest-A', name: 'Ada Konuk', email: 'ada@sim.test', role: 'owner' },
    loading: false,
    error: null,
    clearError: vi.fn(),
    activeRestaurantId: 'rest-A',
    activeRole: 'owner',
    availableRestaurants: [{ id: 'rest-A', name: 'Test House', city: null, chain_id: null, chain_name: null }],
    setActiveRestaurantId: vi.fn().mockResolvedValue(undefined),
    login: vi.fn(),
    register: vi.fn(),
    registerRestaurant: vi.fn(),
    joinViaInvite: vi.fn(),
    loginWithGoogle: vi.fn(),
    loginWithMicrosoft: vi.fn(),
    resolveSignInMethods: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    refreshBranches: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));

import { InventoryCommandPage } from './InventoryCommandPage';

const unresolvedLinesBody = {
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
};

/**
 * The three inventory endpoints nest as prefixes of one another
 * (`/inventory/rest-A` is itself a substring of both `.../summary` and
 * `.../low-stock`), so routing by a raw URL substring cannot tell "reject
 * the list" from "reject everything" apart. Classify first, then route by
 * the classification — every other endpoint below is unambiguous.
 */
type Route = 'inventory-list' | 'inventory-summary' | 'inventory-low-stock' | 'inventory-research' | 'orders' | 'pos-unresolved' | 'storage-locations' | 'other';

function classify(url: string): Route {
  // The research list the "name this wine" flag reads (founder, 2026-09-21);
  // its own route so it is not counted as an inventory-list GET.
  if (url.endsWith('/inventory/research')) return 'inventory-research';
  if (url.includes('/inventory/')) {
    if (url.endsWith('/low-stock')) return 'inventory-low-stock';
    if (url.endsWith('/summary')) return 'inventory-summary';
    return 'inventory-list';
  }
  if (url.includes('/orders')) return 'orders';
  if (url.includes('/pos-hub/unresolved/')) return 'pos-unresolved';
  if (url.includes('/storage-locations/')) return 'storage-locations';
  return 'other';
}

/** Route every GET by its classification; `overrides` replaces one route's default. */
function routeGets(overrides: Partial<Record<Route, 'reject' | unknown>> = {}) {
  api.get.mockImplementation((url: string) => {
    const route = classify(url);
    if (route in overrides) {
      const value = overrides[route];
      return value === 'reject'
        ? Promise.reject(new Error(`${route} (${url}) unreachable`))
        : Promise.resolve({ data: value });
    }
    switch (route) {
      case 'inventory-low-stock':
        return Promise.resolve({ data: [] });
      case 'inventory-summary':
        return Promise.resolve({ data: { totalWines: 0, totalValue: 0 } });
      case 'inventory-list':
        return Promise.resolve({ data: [] });
      case 'inventory-research':
        return Promise.resolve({ data: { items: [] } });
      case 'orders':
        return Promise.resolve({ data: { orders: [], total: 0 } });
      case 'pos-unresolved':
        return Promise.resolve({ data: unresolvedLinesBody });
      case 'storage-locations':
        return Promise.resolve({ data: [] });
      default:
        // The page always mounts several modal/panel components with
        // `isOpen` props rather than gating their presence in the tree
        // (ManualReceipt, AddWineSelection, MenuScanner, PosMapping,
        // StorageLocationManager), and each fetches its own list
        // (providers, wines, POS providers …) on mount regardless of
        // `isOpen`. An empty list is the one shape that is both a true
        // default for every one of them and a value none of their
        // `.map()` calls chokes on — unlike `{}`, which is not an array.
        return Promise.resolve({ data: [] });
    }
  });
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InventoryCommandPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InventoryCommandPage — a failed read is an error, not an empty success', () => {
  it('renders real figures and no banner when every read succeeds', async () => {
    routeGets({
      'inventory-low-stock': [],
      'inventory-summary': { totalWines: 0, totalValue: 0 },
      'inventory-list': [
        {
          id: 'row-1',
          wineId: 'wine-1',
          wineName: 'Produttori Barbaresco',
          wineProducer: 'Produttori del Barbaresco',
          stockLive: 6,
          shadowStock: 0,
          thresholdMin: 2,
        },
      ],
    });

    mount();

    // "On hand" and the page header both show `liveTotal + shadowTotal` (6),
    // so this scopes to the KPI card the way the em-dash assertions below do.
    const onHandLabel = await screen.findByText('On hand');
    const onHandCard = onHandLabel.closest('div')?.parentElement as HTMLElement;
    await waitFor(() => expect(within(onHandCard).getByText('6')).toBeInTheDocument());
    expect(within(onHandCard).getByText('1 wines')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('raises the banner and shows an em dash, never a zero, when only the inventory list fails', async () => {
    routeGets({ 'inventory-list': 'reject' });

    mount();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/the inventory list/i);
    expect(alert).toHaveTextContent('unknown, not zero');
    expect(alert).not.toHaveTextContent(/the summary/i);
    expect(alert).not.toHaveTextContent(/the low-stock list/i);

    // "On hand" KPI value and sub-line must both be the em dash, not "0" /
    // "0 wines" — a zero here claims the house owns none of this wine, which
    // a failed read has not earned. `.closest('div')` matches the label
    // element itself (it already is a `<div>`), so `.parentElement` is the
    // one white KPI card that also holds the value and sub-line.
    const onHandLabel = screen.getByText('On hand');
    const onHandCard = onHandLabel.closest('div')?.parentElement as HTMLElement;
    expect(within(onHandCard).getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(within(onHandCard).queryByText('0')).not.toBeInTheDocument();
    expect(within(onHandCard).queryByText(/wines/)).not.toBeInTheDocument();

    // The page-header subtitle ("N wines, N bottles on hand") and the table
    // footer ("Showing N of N wines") both read straight off `stats`/`rows`
    // too, and rendered a literal "0 wines, 0 bottles on hand" / "Showing 0
    // of 0 wines" before this fix (found by the wave-5 isolated-mount sweep,
    // wave5/live-fix.md) — the same false "this house owns none of this
    // wine" claim as the KPI strip, just two lines the earlier pass missed.
    expect(screen.queryByText(/0 wines, 0 bottles on hand/)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing 0 of 0 wines/i)).not.toBeInTheDocument();
    expect(screen.getByText(/bottles on hand/)).toHaveTextContent('— wines, — bottles on hand');
    expect(screen.getByText(/^Showing/)).toHaveTextContent('Showing — of — wines');
  });

  it('raises the banner when only the summary read fails (the wave-4 gap)', async () => {
    routeGets({ 'inventory-summary': 'reject' });

    mount();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/the summary/i);
    expect(alert).not.toHaveTextContent(/the inventory list/i);
    expect(alert).not.toHaveTextContent(/the low-stock list/i);
  });

  it('raises the banner when only the low-stock read fails', async () => {
    routeGets({ 'inventory-low-stock': 'reject' });
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/the low-stock list/i);
    expect(alert).not.toHaveTextContent(/the inventory list/i);
    expect(alert).not.toHaveTextContent(/the summary/i);
  });

  it('names all three failed reads together when all three fail', async () => {
    routeGets({
      'inventory-low-stock': 'reject',
      'inventory-summary': 'reject',
      'inventory-list': 'reject',
    });
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/the inventory list/i);
    expect(alert).toHaveTextContent(/the summary/i);
    expect(alert).toHaveTextContent(/the low-stock list/i);
  });

  it('renders the em dash on the attention-rail flag counts, not a zero', async () => {
    routeGets({ 'inventory-list': 'reject' });
    mount();

    await screen.findByRole('alert');
    // "Below par" names both the KPI card (also a button, via its `onClick`)
    // and the attention-rail flag chip — scope to the rail so this asserts
    // the flag chip's own count, not the KPI's.
    const rail = screen.getByText('Needs attention').closest('div') as HTMLElement;
    const belowParChip = within(rail).getByRole('button', { name: /Below par/ });
    expect(within(belowParChip).getByText('—')).toBeInTheDocument();
    expect(within(belowParChip).queryByText('0')).not.toBeInTheDocument();
  });

  /**
   * wave5/live-confirm.md B2 ("The fix is code, not a founder decision"): a
   * refetch loop pre-existing on main, independent of the failed-read work
   * above. `useInventoryData`'s `refetch` was a fresh function every render;
   * the spot-count-outbox watcher effect depended on it, so it re-ran (and
   * its immediate `run()` re-fired) on every render, and the old
   * `watchSpotCountOutbox` called `onChange` after every flush attempt even
   * with nothing queued to send — refetching in a loop. Measured on a real
   * mount under the app's own QueryClient defaults: "0 wines, 0 bottles"
   * with no banner in 28 of 39 half-second samples (72%).
   *
   * `mount()` above uses `retry: false`, which is not what ships. These two
   * tests use App.tsx's actual `defaultOptions` (module-private there, so
   * copied here — `staleTime`/`refetchOnMount: 'always'`/`retry: 1`/…) so a
   * regression reproduces the way the loop actually did.
   */
  describe('under the app real QueryClient defaults (not this file’s lenient retry:false)', () => {
    function mountWithAppDefaults() {
      const qc = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            refetchOnMount: 'always',
            retry: 1,
            throwOnError: false,
          },
          mutations: { throwOnError: false },
        },
      });
      return render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <InventoryCommandPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }

    function listGetCount() {
      return api.get.mock.calls.filter(([url]) => classify(url as string) === 'inventory-list').length;
    }

    it('fetches the inventory list once on the happy path, not in a loop', async () => {
      routeGets({
        'inventory-low-stock': [],
        'inventory-summary': { totalWines: 0, totalValue: 0 },
        'inventory-list': [
          {
            id: 'row-1',
            wineId: 'wine-1',
            wineName: 'Produttori Barbaresco',
            wineProducer: 'Produttori del Barbaresco',
            stockLive: 6,
            shadowStock: 0,
            thresholdMin: 2,
          },
        ],
      });

      mountWithAppDefaults();

      const onHandLabel = await screen.findByText('On hand');
      const onHandCard = onHandLabel.closest('div')?.parentElement as HTMLElement;
      await waitFor(() => expect(within(onHandCard).getByText('6')).toBeInTheDocument());

      // Give a looping implementation ample room to spin: the measured
      // defect ran dozens of GETs per real-browser second even over
      // network-shaped async gaps, so 500ms of settling time in jsdom (no
      // network latency at all) is far more than enough to tell "fixed"
      // from "looping" apart.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(listGetCount()).toBe(1);
      // The figures stay the real, settled values throughout — never flash
      // back to zero/em-dash from a loop resetting the query to `pending`.
      expect(within(onHandCard).getByText('6')).toBeInTheDocument();
      expect(within(onHandCard).getByText('1 wines')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('bounds inventory-list GETs and keeps the banner up when the read fails', async () => {
      routeGets({ 'inventory-list': 'reject' });

      mountWithAppDefaults();

      // `retry: 1`'s default backoff waits ~1000ms before the single retry,
      // so the query does not reach `error` (and the banner does not render)
      // within testing-library's default 1000ms `findBy` timeout.
      await screen.findByRole('alert', {}, { timeout: 3_000 });

      // Two checkpoints, not one absolute count: `retry: 1` legitimately
      // adds one attempt on top of the first, so the exact number depends on
      // retry-delay timing this test should not have to pin down. What the
      // pre-fix loop could never do is stop climbing — it measured 27-29
      // list GETs in 20s on a real mount, 12,469 in 10s with retry off.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const first = listGetCount();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const second = listGetCount();

      expect(second).toBe(first);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
