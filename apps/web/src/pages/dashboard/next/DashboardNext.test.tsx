/**
 * DashboardNext — render contract.
 *
 * `/` is the page every house lands on, and it had ZERO render coverage
 * anywhere in the suite: `grep -rln DashboardNext --include='*.test.tsx'
 * --include='*.test.ts' apps/web/src` returned nothing (live-review.md,
 * 2026-09-17, defect 1). That review's own throwaway mount reproduced an
 * unhandled rejection on the page's first-ever render (defect 6): a 200 with
 * a null `calendar-revenue` body reached `res.daily` with no null guard and
 * no `.catch`, so the month ledger stuck in "loading" forever instead of the
 * honest `unknown` state the code exists to show.
 *
 * This file closes both gaps: real hooks (`useDashboardSpine`,
 * `useMonthLedger`, `useDayOrders`, `useCalendarEvents`), with HTTP mocked
 * at `apiClient` — the one layer every service module this tree calls
 * (`services/api/{dashboard,orders,inventory,calendar}.ts`) is built on, so
 * one mock covers the whole page rather than
 * hiding the hook under test behind a mocked hook.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
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

// DASH-W22: the role the page is signed in as; tests flip it to staff.
const auth = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'manager' | 'staff' | null }));

vi.mock('@/contexts/AuthContext', async () => {
  const React = await import('react');
  return {
    // The day line (sketch 119 E, a page element on this page) reads the
    // context itself; with none, its shell gate resolves off — the default.
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada Konuk', email: 'ada@sim.test', role: 'owner' },
      activeRestaurantId: 'rest-A',
      activeRole: auth.role,
      isAuthenticated: true,
    }),
  };
});

import DashboardNext from './DashboardNext';

/** A real month's worth of days — the shape `getCalendarRevenue` promises on success. */
function monthLedger() {
  return {
    year: 2026,
    month: 9,
    restaurant_id: 'rest-A',
    daily: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      procurement_spend: 0,
      bottles_sold: 0,
      events: [],
      order_count: 0,
    })),
    monthly_procurement_spend: 0,
    monthly_bottles: 0,
  };
}

/**
 * Route every GET by URL substring so one mock covers every service module
 * DashboardNext's tree touches. `overrides` replaces the default body for a
 * pattern; a value of `null` resolves `{ data: null }` (the defect 6 repro —
 * a 200 whose body is null, not a thrown error).
 */
function routeGets(overrides: Record<string, unknown> = {}) {
  api.get.mockImplementation((url: string) => {
    for (const [pattern, value] of Object.entries(overrides)) {
      if (url.includes(pattern)) return Promise.resolve({ data: value });
    }
    if (url.includes('/dashboard/stats/')) {
      return Promise.resolve({
        data: { totalWines: 0, totalBottles: 0, lowStockItems: 0, pendingOrders: 0, totalVolumeMl: 0, totalVolumeOz: 0 },
      });
    }
    if (url.includes('/dashboard/activity/')) return Promise.resolve({ data: [] });
    if (url.includes('/dashboard/alerts/')) return Promise.resolve({ data: [] });
    if (url.includes('/dashboard/calendar-revenue/')) return Promise.resolve({ data: monthLedger() });
    if (url.includes('/orders/pending')) return Promise.resolve({ data: [] });
    if (url.includes('/low-stock')) return Promise.resolve({ data: [] });
    if (url.includes('/one-tap-actions')) return Promise.resolve({ data: { actions: [], total: 0 } });
    if (url.includes('/ux/experiments/')) return Promise.resolve({ data: {} });
    if (url.includes('/calendar/events')) return Promise.resolve({ data: { events: [], total: 0 } });
    return Promise.resolve({ data: {} });
  });
}

/** DASH-W29: prints the address the page is on, so a test can read what it wrote. */
function Address() {
  const { search } = useLocation();
  return (
    <output data-testid="address" data-nav={useNavigationType()}>
      {search}
    </output>
  );
}

function mount(at = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <DashboardNext />
        <Address />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let unhandled: unknown[] = [];
function onUnhandled(reason: unknown) {
  unhandled.push(reason);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'owner';
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

describe('DashboardNext', () => {
  it('renders the opening line and settles with real data, no console error, no unhandled rejection', async () => {
    routeGets();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mount();

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        /^(Good (morning|afternoon|evening)|Still up)\b/,
      ),
    );
    // DASH-W25: the opening no longer guesses where the house is in its
    // service from the hour; the day line states the real hours.
    expect(
      screen.queryByText(/before service|between services|before the doors open|after service/),
    ).not.toBeInTheDocument();
    // The standing line starts as the loading sentence and must move off it
    // once the spine and the month ledger both answer.
    await waitFor(() => expect(screen.queryByText('Taking the room’s temperature…')).not.toBeInTheDocument());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    errorSpy.mockRestore();
  });

  // DASH-W5 (founder, 2026-10-01): the note-control count left the footer for
  // /logs. Nothing on this page may print it or ask the gateway for it.
  it('keeps the note-control count off the dashboard footer', async () => {
    routeGets();

    mount();

    await waitFor(() => expect(screen.queryByText('Taking the room’s temperature…')).not.toBeInTheDocument());
    expect(document.querySelector('[data-note-report]')).toBeNull();
    expect(screen.queryByText(/Note control/)).not.toBeInTheDocument();
    expect(
      api.get.mock.calls.some((call) => typeof call[0] === 'string' && /\/ux\/experiments\/.*\/report/.test(call[0])),
    ).toBe(false);
  });

  // DASH-W7 (founder, 2026-10-01): one bottle and one wine read in the
  // singular — the live page said "1 bottles in" and "across 1 wines".
  it('says one bottle and one wine in the singular', async () => {
    routeGets({
      '/dashboard/stats/': {
        totalWines: 1,
        totalBottles: 1,
        lowStockItems: 0,
        pendingOrders: 0,
        totalVolumeMl: 750,
        totalVolumeOz: 25.36,
      },
      '/dashboard/calendar-revenue/': { ...monthLedger(), monthly_procurement_spend: 50, monthly_bottles: 1 },
    });

    mount();

    await waitFor(() => expect(screen.getByText('across 1 item')).toBeInTheDocument());
    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.tagName === 'P' && /·\s*1\s+bottle in$/.test(el.textContent ?? '')),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/across 1 items/)).not.toBeInTheDocument();
    // DASH-W37: with nothing running low, the tile still counts items.
    expect(screen.getByText('items below minimum')).toBeInTheDocument();
  });

  // DASH-W37 (founder, 2026-10-01, '"items" (Recommended)'): the house holds
  // every drink, so the page counts items, never wines.
  it('counts items, never wines', async () => {
    routeGets({
      '/low-stock': [
        { id: 'inv-1', wine_name: 'Barolo Cannubi', vintage: 2019, stock_live: 1, threshold_min: 6 },
        { id: 'inv-2', wine_name: 'Peroni', vintage: null, stock_live: 2, threshold_min: 24 },
      ],
      '/orders/pending': [
        { id: 'o-1', orderNumber: 'ORD-2026-00042', quantity: 1, unitType: 'case', totalCost: 90, status: 'APPROVAL_NEEDED', requestedAt: '2026-09-01T10:00:00Z' },
      ],
    });

    mount();

    expect(await screen.findByText('1 approval and 2 low-stock items are waiting on you.')).toBeInTheDocument();
    expect(await screen.findByText('Unnamed item')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bwines?\b/i);
  });

  // DASH-W13 (founder, 2026-10-01): a future day with something on the
  // calendar opens and shows only that; an empty future day stays closed.
  it('opens a future day only when it has an event, and shows only the calendar', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
    try {
      const ledger = monthLedger();
      ledger.daily[19] = {
        ...ledger.daily[19],
        events: [{ id: 'ev1', title: 'Burgundy tasting', event_type: 'tasting', event_time: '18:00' }],
      } as (typeof ledger.daily)[number];
      routeGets({ '/dashboard/calendar-revenue/': ledger });

      mount();

      const withEvent = await screen.findByRole('button', { name: /^Sunday, September 20(, today)?:/ });
      const empty = screen.getByRole('button', { name: /^Monday, September 21(, today)?:/ });
      expect(withEvent).not.toBeDisabled();
      expect(empty).toBeDisabled();

      withEvent.click();
      expect(await screen.findByText('Burgundy tasting')).toBeInTheDocument();
      expect(screen.queryByText('Paid to vendors')).not.toBeInTheDocument();
      expect(screen.queryByText('Alerts raised')).not.toBeInTheDocument();
      expect(
        api.get.mock.calls.some((call) => typeof call[0] === 'string' && call[0].includes('2026-09-20')),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // DASH-W17 (founder, 2026-10-01): "past days must be lowered in color" —
  // the cell carries data-past, which dashboard-next.css fades (variant A).
  it('marks only the days before today as past', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
    try {
      routeGets();

      mount();

      const past = await screen.findByRole('button', { name: /^Wednesday, September 9(, today)?:/ });
      expect(past.getAttribute('data-past')).toBe('true');
      expect(screen.getByRole('button', { name: /^Thursday, September 10(, today)?:/ }).getAttribute('data-past')).toBe('false');
      expect(screen.getByRole('button', { name: /^Friday, September 11(, today)?:/ }).getAttribute('data-past')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  // DASH-W14 (founder, 2026-10-01): a Lately order line opens that order and a
  // Running low line opens the wine on /inventory; a line naming nothing that
  // can be opened stays plain text.
  it('links Lately order lines to the order and Running low lines to the wine', async () => {
    routeGets({
      '/low-stock': [{ id: 'inv-1', wine_name: 'Barolo Cannubi', vintage: 2019, stock_live: 1, threshold_min: 6 }],
      '/dashboard/activity/': [
        {
          id: 'order-o1',
          type: 'order',
          title: 'Order PO-7 delivered',
          description: 'Barolo Cannubi 2019, 1 bottle from Cantina',
          timestamp: '2026-10-01T12:00:00Z',
          entityId: 'o1',
          entityType: 'procurement_order',
        },
        {
          id: 'event-e1',
          type: 'provider_change',
          title: 'Vendor added',
          description: 'Cantina',
          timestamp: '2026-09-01T12:00:00Z',
          entityId: 'e1',
          entityType: 'event',
        },
      ],
    });

    mount();

    const order = await screen.findByText('Order PO-7 delivered');
    expect(order.closest('a')?.getAttribute('href')).toBe('/orders?order=o1');
    const wine = await screen.findByText('Barolo Cannubi');
    expect(wine.closest('a')?.getAttribute('href')).toBe('/inventory?wine=Barolo%20Cannubi');
    expect(screen.getByText('Vendor added').closest('a')).toBeNull();
  });

  // DASH-W20: the greeting, today's cell and the day panel read the house's
  // clock (stats.timezone), not the device's. 20:00Z on 10 Sep is 05:00 on
  // 11 Sep in Tokyo and still 10 Sep on a UTC or Chicago runner.
  it('reads today, the greeting and a day’s deliveries on the house’s clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-10T20:00:00Z') });
    try {
      const device = new Date();
      // Guard: on a runner already in the house's day the test proves nothing.
      expect(`${device.getFullYear()}-${device.getMonth() + 1}-${device.getDate()}`).not.toBe('2026-9-11');
      routeGets({
        '/dashboard/stats/': {
          totalWines: 0, totalBottles: 0, lowStockItems: 0, pendingOrders: 0,
          totalVolumeMl: 0, totalVolumeOz: 0, timezone: 'Asia/Tokyo',
        },
        '/orders/history': {
          orders: [
            // 01:00 on 11 Sep in Tokyo — the house's day, though its UTC date is the 10th.
            { id: 'o-in', wineName: 'Chablis Les Clos', deliveredAt: '2026-09-10T16:00:00Z', quantity: 6 },
            // 01:00 on 12 Sep in Tokyo — its UTC date is the 11th, so `startsWith` took it.
            { id: 'o-out', wineName: 'Sancerre Monts Damnés', deliveredAt: '2026-09-11T16:00:00Z', quantity: 6 },
          ],
          total: 2,
        },
      });

      mount();

      expect(await screen.findByText(/Good morning/)).toBeInTheDocument();
      const today = await screen.findByRole('button', { name: /^Friday, September 11(, today)?:/ });
      await waitFor(() => expect(today.getAttribute('data-today')).toBe('true'));
      expect(screen.getByRole('button', { name: /^Thursday, September 10(, today)?:/ }).getAttribute('data-today')).toBe('false');

      today.click();
      expect(await screen.findByText('Chablis Les Clos')).toBeInTheDocument();
      expect(screen.queryByText('Sancerre Monts Damnés')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // DASH-W19: a failed read says so in the house's words and offers to read
  // again; "Nothing is waiting on you" is never said over a half it could not read.
  it('names what it could not read and reads it again on Try again', async () => {
    let fail = true;
    routeGets();
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation((url: string, ...rest: unknown[]) => {
      if (fail && (url.includes('/orders/pending') || url.includes('/dashboard/stats/'))) {
        return Promise.reject(Object.assign(new Error('Network Error'), { response: undefined }));
      }
      return base(url, ...rest);
    });

    mount();

    expect(
      await screen.findByText(/No item is running low\. The approvals and the totals couldn’t be reached just now\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is waiting on you\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/gateway/i)).not.toBeInTheDocument();

    const retries = screen.getAllByRole('button', { name: 'Try again' });
    expect(retries.length).toBeGreaterThanOrEqual(2); // the opening line and the approvals panel
    fail = false;
    retries[0].click();
    await waitFor(() => expect(screen.getByText('Nothing is waiting on you.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers Try again on a month whose figures could not be read', async () => {
    let fail = true;
    routeGets();
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation((url: string, ...rest: unknown[]) =>
      fail && url.includes('/dashboard/calendar-revenue/')
        ? Promise.reject(new Error('Network Error'))
        : base(url, ...rest),
    );

    mount();

    const line = await screen.findByText(/This month’s ledger couldn’t be reached\./);
    fail = false;
    within(line).getByRole('button', { name: 'Try again' }).click();
    await waitFor(() => expect(screen.queryByText(/This month’s ledger couldn’t be reached/)).not.toBeInTheDocument());
  });

  // DASH-W22 (founder, 2026-10-01, "A: hide amounts for staff"): staff see
  // counts, not money — tiles, calendar, day panel and approvals queue alike.
  describe('a staff member', () => {
    /** What the gateway sends a staff caller: spend withheld, counts beside it. */
    function staffHouse(overStats: Record<string, unknown> = {}) {
      const ledger = monthLedger();
      ledger.daily[0] = { ...ledger.daily[0], order_count: 2, bottles_sold: 24 };
      routeGets({
        '/dashboard/stats/': {
          totalWines: 4,
          totalBottles: 40,
          lowStockItems: 0,
          pendingOrders: 1,
          totalVolumeMl: 0,
          totalVolumeOz: 0,
          todayProcurementSpend: null,
          weekProcurementSpend: null,
          monthProcurementSpend: null,
          todayDeliveries: 3,
          monthBottlesIn: 48,
          amounts: 'withheld',
          timezone: 'UTC',
          ...overStats,
        },
        '/dashboard/calendar-revenue/': {
          ...ledger,
          daily: ledger.daily.map((d) => ({ ...d, procurement_spend: null })),
          monthly_procurement_spend: null,
          monthly_bottles: 24,
          amounts: 'withheld',
        },
        '/orders/pending': [
          {
            id: 'o-1',
            orderNumber: 'ORD-2026-00042',
            restaurantId: 'rest-A',
            quantity: 5,
            unitType: 'case',
            finalPrice: 400,
            totalCost: 2000,
            status: 'APPROVAL_NEEDED',
            requestedAt: '2026-09-01T10:00:00Z',
            wineName: 'Barolo Riserva',
          },
        ],
        '/orders/history': {
          orders: [
            { id: 'o-d', wineName: 'Chablis Les Clos', deliveredAt: '2026-09-01T16:00:00Z', quantity: 6, unitType: 'bottle', finalPrice: 30, totalCost: 180 },
          ],
          total: 1,
        },
      });
    }

    it('sees deliveries and bottles in where the owner sees money, and no dollar anywhere', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
      try {
        auth.role = 'staff';
        staffHouse();

        const { container } = mount();

        const tile = (await screen.findByText('Deliveries · today')).closest('div')!;
        await waitFor(() => expect(within(tile).getByText('3')).toBeInTheDocument());
        const bottles = screen.getByText('Bottles in · month').closest('div')!;
        await waitFor(() => expect(within(bottles).getByText('48')).toBeInTheDocument());
        await screen.findByRole('button', { name: /Barolo Riserva/ });
        const day = await screen.findByRole('button', { name: 'Tuesday, September 1: 2 deliveries, nothing on the calendar' });
        day.click();
        expect(await screen.findByText('Chablis Les Clos')).toBeInTheDocument();

        expect(screen.queryByText(/Paid to vendors/i)).not.toBeInTheDocument();
        expect(container.textContent).not.toMatch(/\$/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the counts when the gateway withholds the money from a role the page took for an owner', async () => {
      staffHouse();

      mount();

      expect(await screen.findByText('Deliveries · today')).toBeInTheDocument();
      expect(screen.queryByText(/Paid to vendors/i)).not.toBeInTheDocument();
    });

    it('reads a month the gateway sent without its money as counts', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
      try {
        staffHouse({ todayProcurementSpend: 120, weekProcurementSpend: 120, monthProcurementSpend: 900, amounts: 'shown' });

        mount();

        expect(await screen.findByText('Paid to vendors · today')).toBeInTheDocument();
        await screen.findByRole('button', { name: /^Tuesday, September 1: 2 deliveries/ });
        // The month header carries only the bottles, never a "$0" for money withheld.
        expect(
          screen.getByText((_, el) => el?.tagName === 'P' && /^24\s+bottles in$/.test((el.textContent ?? '').trim())),
        ).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows an owner the money', async () => {
      staffHouse({ todayProcurementSpend: 120, weekProcurementSpend: 120, monthProcurementSpend: 900, amounts: 'shown' });

      mount();

      expect(await screen.findByText('Paid to vendors · today')).toBeInTheDocument();
      expect(screen.queryByText('Deliveries · today')).not.toBeInTheDocument();
    });
  });

  // DASH-W29 (P7; ADR 0160, "the URL holds it").
  describe('the calendar keeps its place in the address', () => {
    it('opens the month and the day the address names', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 10, 12, 0, 0) });
      try {
        routeGets();
        mount('/?day=2026-09-01');
        expect(await screen.findByText('Tuesday, September 1')).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: /September\s+2026/ })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('writes the month and the day as they change, and clears them', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 10, 12, 0, 0) });
      try {
        routeGets();
        mount();
        const address = screen.getByTestId('address');
        fireEvent.click(await screen.findByRole('button', { name: 'Previous month' }));
        await waitFor(() => expect(address).toHaveTextContent('?month=2026-09'));
        // Replaced, not pushed: paging and opening days stack no history.
        expect(address).toHaveAttribute('data-nav', 'REPLACE');
        fireEvent.click(await screen.findByRole('button', { name: /^Tuesday, September 1\b/ }));
        await waitFor(() => expect(address).toHaveTextContent(/^\?day=2026-09-01$/));
        fireEvent.click(await screen.findByRole('button', { name: /^Tuesday, September 1\b/ }));
        await waitFor(() => expect(address).toHaveTextContent(/^\?month=2026-09$/));
        fireEvent.click(screen.getByRole('button', { name: 'Today' }));
        await waitFor(() => expect(address).toHaveTextContent(/^$/));
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores an address it cannot read and opens on the house’s month', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
      try {
        routeGets();
        mount('/?month=2026-13&day=yesterday');
        expect(await screen.findByRole('heading', { level: 2, name: /September\s+2026/ })).toBeInTheDocument();
        // No day panel opened: no day heading under the grid.
        expect(
          screen.queryByText((_, el) => el?.tagName === 'H3' && /day, September \d+$/.test(el.textContent ?? '')),
        ).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // DASH-W34/W35 (P8): the squares say which day they are in words, which is
  // today and which is open; closing the panel hands focus back to the square.
  it('names each square in words, marks today and the open day, and returns focus on close', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
    try {
      const ledger = monthLedger();
      ledger.daily[0] = { ...ledger.daily[0], procurement_spend: 400, order_count: 1, bottles_sold: 6 };
      routeGets({ '/dashboard/calendar-revenue/': ledger });
      mount();
      const today = await screen.findByRole('button', { name: /^Thursday, September 10, today:/ });
      expect(today).toHaveAttribute('aria-current', 'date');
      const first = screen.getByRole('button', {
        name: 'Tuesday, September 1: $400 paid to vendors, nothing on the calendar',
      });
      expect(first).not.toHaveAttribute('aria-current');
      expect(first).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('button', { name: /^\d{4}-\d{2}-\d{2}/ })).not.toBeInTheDocument();

      fireEvent.click(first);
      await waitFor(() => expect(first).toHaveAttribute('aria-pressed', 'true'));
      fireEvent.click(await screen.findByRole('button', { name: /^close$/i }));
      await waitFor(() => expect(first).toHaveAttribute('aria-pressed', 'false'));
      expect(first).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  // DASH-W33 (P8): ADR 0042 / OD-112 — ink-3 is decorative only, never a
  // caption. The shared guard reads `color` keys, not Tailwind classes, so
  // this page holds the rule for its own files.
  it('paints no caption in ink-3', () => {
    const sources = import.meta.glob(['./*.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const offenders = Object.entries(sources).filter(([, src]) => /\binkm-3\b|--ink-3\b/.test(src)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  // DASH-W32 (P5, found in P7): a calendar event's kind in words, never a code.
  it('names an event’s kind in words in the day panel, and a custom one not at all', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
    try {
      const ledger = monthLedger();
      ledger.daily[0].events = [
        { id: 'e1', title: 'Rioja truck', event_type: 'delivery_eta' },
        { id: 'e2', title: 'Staff tasting', event_type: 'custom' },
      ] as never;
      routeGets({ '/dashboard/calendar-revenue/': ledger });
      mount('/?day=2026-09-01');
      expect(
        await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.trim() === 'Rioja truck · delivery expected'),
      ).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.trim() === 'Staff tasting'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/delivery_eta|custom/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('names an event’s kind in words on the week rail too', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 10, 12, 0, 0) });
    try {
      routeGets({
        '/calendar/events': {
          events: [{ id: 'c1', title: 'Rioja closed', eventType: 'provider_unavailable', eventDate: '2026-09-11', allDay: true }],
          total: 1,
        },
      });
      mount();
      expect(
        await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.trim() === 'Rioja closed · vendor away'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/provider_unavailable/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not crash or hang when calendar-revenue resolves a null body (defect 6, live-review.md 2026-09-17)', async () => {
    routeGets({ '/dashboard/calendar-revenue/': null });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mount();

    await waitFor(() =>
      expect(
        api.get.mock.calls.some(
          (call) => typeof call[0] === 'string' && call[0].includes('/dashboard/calendar-revenue/'),
        ),
      ).toBe(true),
    );
    // Give the rejected/settled promise chain every turn of the loop it needs
    // to surface an unhandled rejection, if there is one.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
    errorSpy.mockRestore();
  });
});
