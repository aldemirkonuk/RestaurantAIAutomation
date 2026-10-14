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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { visibleGroups } from '../../../lib/mudavym/rooms';
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

/** The role at the house; the auction-lot cases below set it per case. */
const who = vi.hoisted(() => ({ role: 'owner' }));

vi.mock('@/contexts/AuthContext', async () => ({
  // An opened row mounts components that read the context directly.
  AuthContext: (await import('react')).createContext(undefined),
  useAuth: () => ({
    user: { userId: 'user-1', restaurantId: 'rest-A', name: 'Ada Konuk', email: 'ada@sim.test', role: who.role },
    loading: false,
    error: null,
    clearError: vi.fn(),
    activeRestaurantId: 'rest-A',
    activeRole: who.role,
    availableRestaurants: [{ id: 'rest-A', name: 'Test House', city: null, chain_id: null, chain_name: null }],
    setActiveRestaurantId: vi.fn().mockResolvedValue(undefined),
    login: vi.fn(),
    register: vi.fn(),
    registerAccount: vi.fn(),
    registerAccountWithGoogle: vi.fn(),
    createFirstHouse: vi.fn(),
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

/** What an export was handed; the file itself is not written in a test. */
const exported = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/tableExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tableExport')>()),
  exportTable: (...args: unknown[]) => {
    exported(...args);
    return Promise.resolve();
  },
}));

import { InventoryCommandPage, asOfSaid, valuationAbout } from './InventoryCommandPage';

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
type Route = 'inventory-list' | 'inventory-summary' | 'inventory-low-stock' | 'inventory-research' | 'items-to-name' | 'orders' | 'pos-unresolved' | 'storage-locations' | 'pricing-advice' | 'other';

function classify(url: string): Route {
  // The research list the "name this wine" flag reads (founder, 2026-09-21);
  // its own route so it is not counted as an inventory-list GET.
  if (url.endsWith('/inventory/research')) return 'inventory-research';
  // Deliveries waiting for their item (founder, 2026-09-22).
  if (url.endsWith('/procurement/items-to-name')) return 'items-to-name';
  if (url.includes('/inventory/')) {
    if (url.endsWith('/low-stock')) return 'inventory-low-stock';
    if (url.endsWith('/summary')) return 'inventory-summary';
    return 'inventory-list';
  }
  if (url.includes('/orders')) return 'orders';
  if (url.includes('/pos-hub/unresolved/')) return 'pos-unresolved';
  if (url.includes('/storage-locations/')) return 'storage-locations';
  // ADR 0193 (the cellar lane): the page reads per-wine price advice too.
  if (url.includes('/pricing/advice')) return 'pricing-advice';
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
      case 'items-to-name':
        return Promise.resolve({ data: { viewer: { mayName: true, mayNameReason: null }, deliveries: [] } });
      case 'orders':
        return Promise.resolve({ data: { orders: [], total: 0 } });
      case 'pos-unresolved':
        return Promise.resolve({ data: unresolvedLinesBody });
      case 'storage-locations':
        return Promise.resolve({ data: [] });
      case 'pricing-advice':
        return Promise.resolve({
          data: {
            restaurantId: 'rest-A',
            generatedAt: '2026-09-21T00:00:00Z',
            target: { bottlePct: null, glassPct: null, bandPct: null, set: false, pourConfirmed: false, pourMl: null },
            wines: [],
            counts: {},
          },
        });
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
  who.role = 'owner';
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

    // "On hand" and the page header both show `liveTotal` (6), so this
    // scopes to the KPI card the way the em-dash assertions below do.
    const onHandLabel = await screen.findByText('On hand');
    const onHandCard = onHandLabel.closest('div')?.parentElement as HTMLElement;
    await waitFor(() => expect(within(onHandCard).getByText('6')).toBeInTheDocument());
    expect(within(onHandCard).getByText('1 items')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('[REVERT-FAILS] bottles on order are not on hand: the header, the gauge and the chip say them apart (F-143 orphan shadow)', async () => {
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
          shadowStock: 3,
          thresholdMin: 2,
        },
      ],
    });

    mount();

    const onHandLabel = await screen.findByText('On hand');
    const onHandCard = onHandLabel.closest('div')?.parentElement as HTMLElement;
    await waitFor(() => expect(within(onHandCard).getByText('6')).toBeInTheDocument());
    expect(within(onHandCard).queryByText('9')).not.toBeInTheDocument();
    expect(screen.getByText(/1 items, 6 bottles on hand/)).toBeInTheDocument();
    const notShelvedLabel = screen.getByText('Not on the shelf yet');
    const notShelvedCard = notShelvedLabel.closest('div')?.parentElement as HTMLElement;
    expect(within(notShelvedCard).getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('Not shelved: 3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Reconcile 3/)).not.toBeInTheDocument();
  });

  it('an unread sales rate prints a dash and an unset par says so, never 0.0 or a par of 10 (F-689, F-391)', async () => {
    routeGets({
      'inventory-list': [
        {
          id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0,
          thresholdMin: 0, velocityPerDay: 0, analyticsReadable: false,
        },
      ],
    });
    mount();
    expect(await screen.findByText('no par set')).toBeInTheDocument();
    expect(screen.getByTitle('Sales could not be read')).toHaveTextContent('—');
    expect(screen.queryByText('/ 10 par')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0\.0$/)).not.toBeInTheDocument();
  });

  it('a price-advice answer without its shape is said on the row, and the page still renders (ADR 0193)', async () => {
    routeGets({
      'inventory-list': [
        { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0, thresholdMin: 2 },
      ],
      // Not the advice's shape: before the guard, `data.wines.map` threw and
      // took the whole page down with it.
      'pricing-advice': [],
    });
    mount();
    expect(await screen.findByText('advice unavailable')).toBeInTheDocument();
    expect(await screen.findByText('On hand')).toBeInTheDocument();
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
    expect(within(onHandCard).queryByText(/items/)).not.toBeInTheDocument();

    // The page-header subtitle ("N wines, N bottles on hand") and the table
    // footer ("Showing N of N wines") both read straight off `stats`/`rows`
    // too, and rendered a literal "0 wines, 0 bottles on hand" / "Showing 0
    // of 0 wines" before this fix (found by the wave-5 isolated-mount sweep,
    // wave5/live-fix.md) — the same false "this house owns none of this
    // wine" claim as the KPI strip, just two lines the earlier pass missed.
    expect(screen.queryByText(/0 items, 0 bottles on hand/)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing 0 of 0 items/i)).not.toBeInTheDocument();
    // "items", not "wines": a bar's beer and spirits rows are counted here
    // too (F-722).
    expect(screen.getByText(/bottles on hand/)).toHaveTextContent('— items, — bottles on hand');
    expect(screen.getByText(/^Showing/)).toHaveTextContent('Showing — of — items');
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
      expect(within(onHandCard).getByText('1 items')).toBeInTheDocument();
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

/**
 * An auction lot's hammer price is written as the wine's cost, and the
 * gateway refuses a cost from staff (F-312, roles sweep 2026-10-08), so the
 * page offers the auction start to owners and managers only.
 */
describe('InventoryCommandPage — the auction-lot start is an owner\'s or a manager\'s', () => {
  it.each(['owner', 'manager'])('offers it to a %s', async (role) => {
    who.role = role;
    routeGets();
    mount();
    (await screen.findByRole('button', { name: /Add stock/ })).click();
    expect(await screen.findByText('An auction lot')).toBeInTheDocument();
  });

  it('does not offer it to staff', async () => {
    who.role = 'staff';
    routeGets();
    mount();
    (await screen.findByRole('button', { name: /Add stock/ })).click();
    // The sheet opened (its other starts are there), without the auction one.
    expect(await screen.findByText('Add to inventory')).toBeInTheDocument();
    expect(screen.queryByText('An auction lot')).not.toBeInTheDocument();
  });
});

/*
 * F-320 — the page's arrow-key row navigation listens on the window. Once a row
 * had the keyboard, Enter on ANY button folded that row away (taking the
 * button's own panel with it) and Space ticked the row instead of pressing the
 * button. The window keys now leave buttons and dialogs alone.
 */
describe('InventoryCommandPage — row keys leave buttons alone', () => {
  // jsdom has no layout; the focused row scrolls itself into view.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  const oneRow = () =>
    routeGets({
      'inventory-list': [
        { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0, thresholdMin: 2 },
      ],
    });

  async function openRowByKeyboard(user: ReturnType<typeof userEvent.setup>) {
    mount();
    await screen.findByRole('checkbox', { name: 'Select Produttori Barbaresco' });
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{ArrowDown}{Enter}');
    return screen.findByRole('button', { name: 'Count every shelf' });
  }

  it('Enter on "Spot count" opens the count and keeps the row open', async () => {
    oneRow();
    const user = userEvent.setup();
    const spot = await openRowByKeyboard(user);

    spot.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Count every shelf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease manual adjustment' })).toBeInTheDocument();
  });

  it('Space on a row button presses the button, not the row checkbox', async () => {
    oneRow();
    const user = userEvent.setup();
    await openRowByKeyboard(user);

    screen.getByRole('button', { name: 'Decrease manual adjustment' }).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Select Produttori Barbaresco' })).not.toBeChecked();
  });
});

describe('InventoryCommandPage — an empty house is not a filtered one (F-354)', () => {
  it('a house with nothing in it says so and offers the first bottle, not "no match"', async () => {
    routeGets({ 'inventory-list': [] });
    mount();
    const empty = await screen.findByTestId('inventory-nothing-yet');
    expect(empty).toHaveTextContent('Nothing is in your inventory yet.');
    expect(within(empty).getByRole('button', { name: /Add the first bottle/ })).toBeInTheDocument();
    expect(screen.queryByText(/match/i)).not.toBeInTheDocument();
  });

  it('a search that hides every row says the search hides them, with the count', async () => {
    routeGets({
      'inventory-list': [
        { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0, thresholdMin: 2 },
      ],
    });
    mount();
    await screen.findByText('Produttori Barbaresco');
    fireEvent.change(screen.getByPlaceholderText(/Search drinks, producers/), { target: { value: 'zzzz' } });
    expect(await screen.findByText(/Nothing matches your search or filters\. 1 item is hidden by them\./)).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-nothing-yet')).not.toBeInTheDocument();
  });

  it('a list that could not be read is neither empty nor filtered', async () => {
    routeGets({ 'inventory-list': 'reject' });
    mount();
    await screen.findByRole('alert');
    expect(screen.queryByTestId('inventory-nothing-yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing matches your search/)).not.toBeInTheDocument();
  });
});

describe('InventoryCommandPage — the way into the stock count (ADR 0343, S227 owed)', () => {
  let path = '';
  function Where() {
    path = useLocation().pathname;
    return null;
  }
  it.each(['owner', 'manager', 'staff'])('offers a %s the stock count and goes to /count', async (role) => {
    who.role = role;
    routeGets({ 'inventory-low-stock': [], 'inventory-summary': { totalWines: 0, totalValue: 0 }, 'inventory-list': [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/inventory']}>
          <InventoryCommandPage />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Stock count' }));
    await waitFor(() => expect(path).toBe('/count'));
  });

  // The shell's rooms table (rail and phone Rooms sheet) offers it to every
  // role too: staff count shelves, so it carries no minRole.
  it.each(['owner', 'manager', 'staff'] as const)('the shell offers a %s the stock count', (role) => {
    const cellar = visibleGroups(role, { connections: true }).find((g) => g.name === 'The cellar')!;
    expect(cellar.rooms.find((r) => r.name === 'Stock count')?.path).toBe('/count');
  });
});

describe('InventoryCommandPage — the filters survive a reload and Back (F-370)', () => {
  const list = {
    'inventory-low-stock': [],
    'inventory-summary': { totalWines: 0, totalValue: 0 },
    'inventory-list': [],
  };
  let seen = '';
  function Where() {
    seen = useLocation().search;
    return null;
  }
  const mountAt = (url: string) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <InventoryCommandPage />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };
  const search = () =>
    screen.getByPlaceholderText(/Search drinks, producers/) as HTMLInputElement;

  it('[REVERT-FAILS] starts from the search in the URL', async () => {
    routeGets(list);
    mountAt('/inventory?q=Barolo');
    await waitFor(() => expect(search().value).toBe('Barolo'));
  });

  it('[REVERT-FAILS] writes the search into the URL, keeping params it does not own', async () => {
    routeGets(list);
    mountAt('/inventory?verify=o-9');
    fireEvent.change(search(), { target: { value: 'Etna' } });
    await waitFor(() => expect(new URLSearchParams(seen).get('q')).toBe('Etna'));
    expect(new URLSearchParams(seen).get('verify')).toBe('o-9');
  });
});

describe('InventoryCommandPage — an open row fits the screen it is on (F-226)', () => {
  it('[REVERT-FAILS] pins the open row to the visible width, not the 1330px grid', async () => {
    routeGets({
      'inventory-low-stock': [],
      'inventory-summary': { totalWines: 0, totalValue: 0 },
      'inventory-list': [
        { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', wineProducer: 'P', stockLive: 6, shadowStock: 0, thresholdMin: 2 },
      ],
    });
    mount();
    const name = await screen.findAllByText('Produttori Barbaresco');
    fireEvent.click(name[0]);
    const frame = await screen.findByTestId('row-expansion-frame');
    expect(frame.className).toContain('sticky');
    expect(frame.style.width).toBe('100cqw');
  });
});

describe('InventoryCommandPage — Match invoice lists the deliveries waiting (F-177)', () => {
  it('[REVERT-FAILS] lists every delivery instead of opening the first one', async () => {
    const waiting = [
      { id: 'o-1', status: 'DELIVERED', orderNumber: 'PO-1', providerName: 'Kegmoor', wineName: 'Pliny the Elder' },
      { id: 'o-2', status: 'DELIVERED', orderNumber: 'PO-2', providerName: 'Vino', wineName: 'Barbaresco' },
    ];
    routeGets({ orders: { orders: waiting, total: 2 } });
    mount();
    const chip = await screen.findByRole('button', { name: /Match invoice/ });
    fireEvent.click(chip);
    const list = await screen.findByTestId('match-invoice-list');
    // The mock answers both status reads with the same pair, so each shows twice.
    expect(within(list).getAllByText('Pliny the Elder').length).toBeGreaterThan(0);
    expect(within(list).getAllByText('Barbaresco').length).toBeGreaterThan(0);
  });
});

describe('InventoryCommandPage — marking a wine inactive (F-429)', () => {
  const ROW = { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0, thresholdMin: 2, isActive: true };
  const ASLEEP = { id: 'row-9', wineId: 'wine-9', wineName: 'Sancerre Les Monts', stockLive: 3, shadowStock: 0, thresholdMin: 2, isActive: false };

  /** The list route answers the inactive wines when asked with `active=false`. */
  function routeWithInactive() {
    routeGets({ 'inventory-list': [ROW] });
    const active = api.get.getMockImplementation()!;
    api.get.mockImplementation((url: string, config?: { params?: { active?: string } }) =>
      config?.params?.active === 'false' ? Promise.resolve({ data: [ASLEEP] }) : active(url, config),
    );
    api.patch.mockResolvedValue({ data: {} });
  }

  it('asks first, says the bottles stay in the stock value on Reports, and changes nothing until confirmed', async () => {
    routeWithInactive();
    mount();

    const name = await screen.findByText('Produttori Barbaresco');
    fireEvent.contextMenu(name.closest('[data-inv-row]')!.firstElementChild!);
    fireEvent.click(await screen.findByText('Mark inactive'));

    const dialog = await screen.findByRole('dialog', { name: /Mark Produttori Barbaresco inactive\?/ });
    expect(dialog).toHaveTextContent('6 bottles still on hand');
    // F-442: bottles still in the cellar are still stock; Reports keeps them.
    expect(dialog).toHaveTextContent('Reports still counts them in what your stock is worth');
    expect(dialog).not.toHaveTextContent('out of the stock value here and on Reports');
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep active' }));
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByText('Produttori Barbaresco').closest('[data-inv-row]')!.firstElementChild!);
    fireEvent.click(await screen.findByText('Mark inactive'));
    const again = await screen.findByRole('dialog');
    fireEvent.click(within(again).getByRole('button', { name: 'Mark inactive' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/inventory/rest-A/item/row-1', { isActive: false }),
    );
  });

  it('lists the inactive wines and makes one active again', async () => {
    routeWithInactive();
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /Inactive wines/ }));
    const panel = await screen.findByRole('dialog', { name: 'Inactive wines' });
    expect(await within(panel).findByText('Sancerre Les Monts')).toBeInTheDocument();
    expect(within(panel).getByText('3 bottles on hand')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: /Make active/ }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/inventory/rest-A/item/row-9', { isActive: true }),
    );
  });
});

describe('InventoryCommandPage — staff are shown stock, not what the house paid (F-562)', () => {
  // The gateway sends staff no `wac`; before this, the page priced the
  // missing cost at $0 and printed "$0" as the value on hand and per row.
  const staffRow = {
    id: 'row-1',
    wineId: 'wine-1',
    wineName: 'Produttori Barbaresco',
    stockLive: 6,
    shadowStock: 0,
    thresholdMin: 2,
  };

  it('draws no value card, value column or "You paid" line for staff', async () => {
    who.role = 'staff';
    routeGets({ 'inventory-list': [staffRow] });
    mount();
    const wine = await screen.findByText('Produttori Barbaresco');
    expect(await screen.findByText('On hand')).toBeInTheDocument();
    expect(screen.queryByText('Value on hand')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Value' })).not.toBeInTheDocument();
    wine.click();
    expect(await screen.findByText('Market price')).toBeInTheDocument();
    expect(screen.queryByText('You paid (WAC)')).not.toBeInTheDocument();
  });

  it('keeps them for an owner', async () => {
    routeGets({ 'inventory-list': [{ ...staffRow, wac: 40 }] });
    mount();
    const wine = await screen.findByText('Produttori Barbaresco');
    expect(screen.getByText('Value on hand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Value' })).toBeInTheDocument();
    wine.click();
    expect(await screen.findByText('You paid (WAC)')).toBeInTheDocument();
  });

  it('values live bottles only, not shadow ones still on order (F-1167)', async () => {
    routeGets({ 'inventory-list': [{ ...staffRow, stockLive: 6, shadowStock: 4, wac: 40 }] });
    mount();
    await screen.findByText('Produttori Barbaresco');
    const tile = screen.getByText('Value on hand').parentElement!;
    // 6 x $40, not 10 x $40.
    expect(tile.textContent).toMatch(/\$240(?![\d,.])/);
    expect(tile.textContent).not.toMatch(/\$400(?![\d,.])/);
  });

  it('prices each row and sorts by value on live bottles only (F-1167)', async () => {
    routeGets({
      'inventory-list': [
        { ...staffRow, stockLive: 6, shadowStock: 4, wac: 40 },
        { ...staffRow, id: 'row-2', wineId: 'wine-2', wineName: 'Sancerre Les Monts', stockLive: 7, wac: 40 },
      ],
    });
    mount();
    const row = (await screen.findByText('Produttori Barbaresco')).closest('[data-inv-row]')!;
    // The row's own Value cell agrees with the tile: 6 x $40, not 10 x $40.
    expect(row.textContent).toMatch(/\$240(?![\d,.])/);
    expect(row.textContent).not.toMatch(/\$400(?![\d,.])/);

    // Highest value first: Sancerre's $280 outranks Barbaresco's $240.
    fireEvent.click(screen.getByRole('button', { name: 'Value' }));
    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('[data-inv-row]')).map((r) =>
        r.textContent?.includes('Sancerre') ? 'Sancerre' : 'Barbaresco',
      );
      expect(names).toEqual(['Sancerre', 'Barbaresco']);
    });
  });
});

describe('InventoryCommandPage — the price advice is asked for only by an owner or a manager (F-1175)', () => {
  // GET /pricing/advice carries every wine's cost and margin; the gateway
  // answers staff 403. Asked anyway, every staff row read "advice unavailable".
  const row = { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0, thresholdMin: 2 };
  const adviceGets = () => api.get.mock.calls.filter((call) => classify(String(call[0])) === 'pricing-advice');

  it('staff never ask for it, and their rows say nothing of advice', async () => {
    who.role = 'staff';
    routeGets({ 'inventory-list': [row], 'pricing-advice': 'reject' });
    mount();
    await screen.findByText('Produttori Barbaresco');
    expect(adviceGets()).toHaveLength(0);
    expect(screen.queryByText('advice unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('advice…')).not.toBeInTheDocument();
  });

  it.each(['owner', 'manager'])('a %s does', async (role) => {
    who.role = role;
    routeGets({ 'inventory-list': [row] });
    mount();
    await screen.findByText('Produttori Barbaresco');
    await waitFor(() => expect(adviceGets().length).toBeGreaterThan(0));
  });
});

describe('InventoryCommandPage — value comes from what the house paid, and a chip values its zone (F-1281, F-1282)', () => {
  const costed = { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0, thresholdMin: 2, wac: 40 };
  const uncosted = { id: 'row-2', wineId: 'wine-2', wineName: 'Sancerre Les Monts', stockLive: 3, shadowStock: 0, thresholdMin: 2 };

  /** The rows and title the last export was handed, each row read through its columns. */
  function lastExport() {
    const opts = exported.mock.calls.at(-1)![0] as {
      rows: unknown[];
      title: string;
      columns: { header: string; value: (r: unknown) => unknown }[];
    };
    const cells = opts.rows.map((r) =>
      Object.fromEntries(opts.columns.map((c) => [c.header.replace(/ \(.*\)$/, ''), c.value(r)])),
    );
    return { title: opts.title, cells };
  }

  async function exportValuation() {
    fireEvent.click(screen.getByRole('button', { name: /Export valuation/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(exported).toHaveBeenCalled());
  }

  it('[REVERT-FAILS] the tile says how many wines it left out for having no cost', async () => {
    routeGets({ 'inventory-list': [costed, uncosted] });
    mount();
    await screen.findByText('Sancerre Les Monts');
    const label = screen.getByText('Value on hand');
    // 6 x $40; the uncosted wine is not priced at 0 or at the library's price.
    expect(label.nextElementSibling!.textContent).toBe('$240');
    expect(label.parentElement!.textContent).toContain('1 wine left out: no cost recorded');
  });

  it('[REVERT-FAILS] the valuation export leaves WAC blank and writes withheld, never a price', async () => {
    routeGets({ 'inventory-list': [costed, uncosted] });
    mount();
    await screen.findByText('Sancerre Les Monts');
    await exportValuation();
    const { cells } = lastExport();
    const sancerre = cells.find((c) => c.Wine === 'Sancerre Les Monts')!;
    expect(sancerre.WAC).toBe('');
    expect(sancerre.Value).toBe('withheld');
    const barbaresco = cells.find((c) => c.Wine === 'Produttori Barbaresco')!;
    expect(barbaresco.Value).toBe(240);
  });

  it('[REVERT-FAILS] the valuation file names its house, and the inactive wines it leaves out (F-1607)', async () => {
    routeGets({ 'inventory-list': [costed, uncosted] });
    const base = api.get.getMockImplementation()!;
    // The inactive read is the list with active=false: one wine, 3 bottles.
    api.get.mockImplementation((url: string, config?: { params?: { active?: string } }) =>
      config?.params?.active === 'false'
        ? Promise.resolve({ data: [{ ...costed, id: 'gone', stockLive: 3, shadowStock: 0 }] })
        : base(url),
    );
    mount();
    await screen.findByText('Sancerre Les Monts');
    await exportValuation();
    const about = Object.fromEntries(
      (exported.mock.calls.at(-1)![0] as { about?: Array<[string, string]> }).about ?? [],
    );
    expect(about.House).toBe('Test House');
    expect(about['As of']).toBeTruthy();
    expect(about['Left out']).toMatch(/^1 inactive wine still holding 3 bottles\./);
  });

  it('[REVERT-FAILS] with a chip on, the tile and the export count that zone and name it', async () => {
    routeGets({
      'inventory-list': [
        {
          ...costed,
          stockLive: 11,
          wac: 10,
          locations: [
            { locationId: 'cellar', qty: 5, wac: null },
            { locationId: 'rack-1', qty: 2, wac: null },
            { locationId: 'bar', qty: 4, wac: null },
          ],
        },
      ],
    });
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation((url: string) =>
      url === '/storage-locations/rest-A'
        ? Promise.resolve({
            data: [
              { id: 'cellar', name: 'Cellar' },
              { id: 'rack-1', name: 'Rack 1', parent_id: 'cellar' },
              { id: 'bar', name: 'Bar' },
            ],
          })
        : base(url),
    );
    mount();
    await screen.findByText('Produttori Barbaresco');
    fireEvent.click(await screen.findByRole('button', { name: 'Cellar' }));

    const tile = (await screen.findByText('Value on hand in Cellar')).parentElement!;
    // 7 bottles in the cellar and its rack at $10, not the house's 11.
    expect(tile.textContent).toMatch(/\$70(?![\d,.])/);

    await exportValuation();
    const { title, cells } = lastExport();
    expect(title).toBe('Inventory valuation — Cellar');
    expect(cells[0].Live).toBe(7);
    expect(cells[0].Value).toBe(70);
  });
  // F-1360: the tile counted the zone but each row's Value, the value sort, the
  // stock gauge and the export's Shadow still counted the whole house, so the
  // rows under "Value on hand in Cellar" added up to more than the tile.
  it('[REVERT-FAILS] with a chip on, each row, the value sort and the gauge count that zone', async () => {
    routeGets({
      'inventory-list': [
        {
          ...costed,
          stockLive: 11,
          shadowStock: 3,
          wac: 10,
          locations: [
            { locationId: 'cellar', qty: 2, wac: null },
            { locationId: 'bar', qty: 9, wac: null },
          ],
        },
        {
          ...uncosted,
          stockLive: 3,
          wac: 10,
          locations: [{ locationId: 'cellar', qty: 3, wac: null }],
        },
      ],
    });
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation((url: string) =>
      url === '/storage-locations/rest-A'
        ? Promise.resolve({
            data: [
              { id: 'cellar', name: 'Cellar' },
              { id: 'bar', name: 'Bar' },
            ],
          })
        : base(url),
    );
    mount();
    await screen.findByText('Produttori Barbaresco');
    // The location chip comes first; Sancerre's own row names its shelf too.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Cellar' }))[0]);
    await screen.findByText('Value on hand in Cellar');

    const row = screen.getByText('Produttori Barbaresco').closest('[data-inv-row]')!;
    // 2 bottles in the cellar at $10, not the house's 11.
    expect(row.textContent).toMatch(/\$20(?![\d,.])/);
    expect(row.textContent).not.toMatch(/\$110(?![\d,.])/);
    expect(row.textContent).toContain('2 live');
    expect(row.textContent).toContain('in Cellar');
    expect(row.textContent).not.toContain('3 shadow');

    // Highest value first: Sancerre's $30 in the cellar outranks Barbaresco's $20.
    fireEvent.click(screen.getByRole('button', { name: 'Value' }));
    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('[data-inv-row]')).map((r) =>
        r.textContent?.includes('Sancerre') ? 'Sancerre' : 'Barbaresco',
      );
      expect(names).toEqual(['Sancerre', 'Barbaresco']);
    });

    await exportValuation();
    const { cells } = lastExport();
    const barbaresco = cells.find((c) => c.Wine === 'Produttori Barbaresco')!;
    expect(barbaresco.Live).toBe(2);
    // Shadow is kept for the whole house, so the zone's sheet leaves it blank.
    expect(barbaresco.Shadow).toBe('');
  });
});

/*
 * F-1607: the valuation file says its house, when it was read, its filters,
 * and what it leaves out and why.
 */

const aboutNow = new Date('2026-12-31T21:30:00Z');
const aboutBase = { house: 'Tuzlu Rüzgar', zone: 'Europe/Istanbul', now: aboutNow, shown: [], leftByFilters: 0 };
const saidOf = (about: Array<[string, string]>) => Object.fromEntries(about);

describe('the lines about a valuation file (F-1607)', () => {
  it('names the house and the as-of time on the house clock', () => {
    const about = saidOf(valuationAbout({ ...aboutBase, inactive: { wines: 0, bottles: 0 } }));
    expect(about.House).toBe('Tuzlu Rüzgar');
    // 21:30 UTC on 31 Dec is already 1 Jan in Istanbul.
    expect(about['As of']).toMatch(/2027/);
    expect(about['As of']).toContain('house time (Europe/Istanbul)');
    expect(about.Shows).toBe('Every active wine on the list.');
    expect(about['Left out']).toBe('Nothing.');
  });

  it('says the filters, and how many wines they leave out', () => {
    const about = saidOf(
      valuationAbout({
        ...aboutBase,
        shown: ['Search: barolo', 'Only wines marked Below par'],
        leftByFilters: 41,
        inactive: { wines: 0, bottles: 0 },
      }),
    );
    expect(about.Shows).toBe('Search: barolo; Only wines marked Below par');
    expect(about['Left out']).toBe('41 wines on the list that the filters above leave out.');
  });

  it('lists inactive wines still holding bottles, and why they are not in it', () => {
    const about = saidOf(valuationAbout({ ...aboutBase, inactive: { wines: 2, bottles: 14 } }));
    expect(about['Left out']).toMatch(/^2 inactive wines still holding 14 bottles\. Reports and the month close still count them/);
    expect(about['Left out']).toContain('make them active again from Inactive wines');
  });

  it('says inactive wines could not be read, never that there are none', () => {
    const about = saidOf(valuationAbout({ ...aboutBase, inactive: null }));
    expect(about['Left out']).toBe('Inactive wines could not be read, so this file cannot say whether any still hold bottles.');
  });

  it('falls back to the device clock, and says so, with no zone', () => {
    expect(asOfSaid(aboutNow, null)).toMatch(/this device's time$/);
    expect(saidOf(valuationAbout({ ...aboutBase, house: null, inactive: null })).House).toBe('name not recorded');
  });
});

// F-1685 (wave-55 sim): a new house with no till and no sales read "0 —
// stockout inside 5 days", which says nothing runs out when no runway is known.
describe('InventoryCommandPage — runway alerts before any sale (F-1685)', () => {
  const unsold = { id: 'row-1', wineId: 'wine-1', wineName: 'Produttori Barbaresco', stockLive: 6, shadowStock: 0, thresholdMin: 2 };

  const tile = () => screen.getByText('Runway alerts').parentElement!;

  it('[REVERT-FAILS] with no wine selling yet, the tile shows a dash and says no sales yet', async () => {
    routeGets({ 'inventory-list': [unsold, { ...unsold, id: 'row-2', wineId: 'wine-2', wineName: 'Sancerre Les Monts' }] });
    mount();
    await screen.findByText('Sancerre Les Monts');
    expect(screen.getByText('Runway alerts').nextElementSibling!.textContent).toBe('—');
    expect(tile().textContent).toContain('no sales yet');
    expect(tile().textContent).not.toContain('stockout inside 5 days');
  });

  it('a wine selling 2 a day with 6 on the shelf still counts (control)', async () => {
    routeGets({ 'inventory-list': [{ ...unsold, velocityPerDay: 2 }] });
    mount();
    await screen.findByText('Produttori Barbaresco');
    expect(screen.getByText('Runway alerts').nextElementSibling!.textContent).toBe('1');
    expect(tile().textContent).toContain('stockout inside 5 days');
  });
});
