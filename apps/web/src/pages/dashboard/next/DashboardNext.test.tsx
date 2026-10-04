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
 * `useMonthLedger`, `useDayOrders`, `useNoteCloseReport`,
 * `useCalendarEvents`), with HTTP mocked at `apiClient` — the one layer every
 * service module this tree calls (`services/api/{dashboard,orders,inventory,
 * calendar}.ts`) is built on, so one mock covers the whole page rather than
 * hiding the hook under test behind a mocked hook.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('@/contexts/AuthContext', async () => {
  const React = await import('react');
  return {
    // The day line (sketch 119 E, a page element on this page) reads the
    // context itself; with none, its shell gate resolves off — the default.
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'user-1', name: 'Ada Konuk', email: 'ada@sim.test', role: 'owner' },
      activeRestaurantId: 'rest-A',
      activeRole: 'owner',
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

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardNext />
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
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.useRealTimers();
});

describe('DashboardNext', () => {
  it('renders the opening line and settles with real data, no console error, no unhandled rejection', async () => {
    routeGets();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mount();

    await waitFor(() =>
      expect(
        screen.queryByText(/before service|between services|before the doors open|after service/),
      ).toBeInTheDocument(),
    );
    // The standing line starts as the loading sentence and must move off it
    // once the spine and the month ledger both answer.
    await waitFor(() => expect(screen.queryByText('Taking the room’s temperature…')).not.toBeInTheDocument());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    errorSpy.mockRestore();
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

/* ── The month tells the house's day true (ADR 0290) ───────────────────── */

type Day = {
  date: string;
  procurement_spend: number | null;
  bottles_sold: number | null;
  order_count: number | null;
  net_sales: number | null;
  checks: number | null;
  events: unknown[];
};

/**
 * A month as the gateway sends it after ADR 0290: house-zoned days, net sales
 * for a caller who sees them. `dayDefault` fills every day, `days` overrides
 * single dates, the rest overrides the top level.
 */
function houseMonth({
  year = 2026,
  month = 10,
  dayDefault = {},
  days = {},
  ...top
}: {
  year?: number;
  month?: number;
  dayDefault?: Partial<Day>;
  days?: Record<string, Partial<Day>>;
  [key: string]: unknown;
} = {}) {
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    restaurant_id: 'rest-A',
    timezone: 'America/Los_Angeles',
    zone_unset: false,
    today: '2026-10-03',
    daily: Array.from({ length: n }, (_, i) => {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      return {
        date,
        procurement_spend: 0,
        bottles_sold: 0,
        order_count: 0,
        net_sales: 0,
        checks: 0,
        events: [],
        ...dayDefault,
        ...days[date],
      };
    }),
    monthly_procurement_spend: 0,
    monthly_bottles: 0,
    monthly_net_sales: 0,
    monthly_checks: 0,
    pos_connected: true,
    sales_withheld: false,
    ...top,
  };
}

const TRADING_DAY = {
  '2026-10-02': { net_sales: 800, checks: 12, procurement_spend: 500, bottles_sold: 24, order_count: 2 },
};

/** Serve `body(year, month)` for the calendar; everything else as routeGets. */
function routeMonth(
  body: (year: number, month: number) => unknown,
  overrides: Record<string, unknown> = {},
) {
  routeGets(overrides);
  const base = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config?: { params?: { year: number; month: number } }) => {
    if (url.includes('/dashboard/calendar-revenue/')) {
      return Promise.resolve({ data: body(config!.params!.year, config!.params!.month) });
    }
    return base(url, config);
  });
}

/** The browser's clock; only Date is faked, so waitFor keeps its timers. */
function browserAt(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

/**
 * A day's cell, by the date its label opens with. A plain selector, not
 * getByRole: role queries walk the accessibility tree of the whole page on
 * every waitFor retry, slow enough here to outlast the retry window.
 */
function dayCell(date: string): HTMLElement {
  const cell = document.body.querySelector<HTMLElement>(`button.dn-cell[aria-label^="${date}"]`);
  if (!cell) throw new Error(`no cell for ${date}`);
  return cell;
}
const cellFig = (date: string) => dayCell(date).querySelector('.dn-cell-fig')?.textContent;

describe('DashboardNext — the month calendar (ADR 0290)', () => {
  it('headlines net sales in the header and on the day, keeping the delivery mark', async () => {
    browserAt('2026-10-03T19:00:00Z');
    routeMonth(() =>
      houseMonth({
        days: TRADING_DAY,
        monthly_net_sales: 800,
        monthly_checks: 12,
        monthly_procurement_spend: 500,
        monthly_bottles: 24,
      }),
    );
    mount();

    await waitFor(() => expect(cellFig('2026-10-02')).toBe('$800'));
    const totals = screen.getByTestId('dn-month-totals').textContent ?? '';
    expect(totals).toMatch(/net sales\s*\$800/);
    expect(totals).toMatch(/paid to vendors\s*\$500/);
    expect(screen.getByRole('region', { name: 'Sales calendar — net sales per day' })).toBeInTheDocument();
    expect(within(dayCell('2026-10-02')).getByText('2 orders')).toBeInTheDocument();
    expect(dayCell('2026-10-02')).toHaveAttribute(
      'aria-label',
      '2026-10-02: net sales $800, paid to vendors $500, 0 events',
    );
    // A connected register's quiet day is a quiet blank, not "$0".
    expect(cellFig('2026-10-01')).toBe('·');
  });

  it("marks today on the house's clock when the browser has already turned the day", async () => {
    // Noon UTC on the 4th is the 4th in every browser zone from UTC-11 to
    // UTC+11; the house (Los Angeles) says it is still the 3rd.
    browserAt('2026-10-04T12:00:00Z');
    routeMonth(() => houseMonth({ today: '2026-10-03' }));
    mount();

    await waitFor(() => expect(dayCell('2026-10-03')).toHaveAttribute('data-today', 'true'));
    expect(dayCell('2026-10-04')).toHaveAttribute('data-today', 'false');
    expect(dayCell('2026-10-04')).toHaveAttribute('data-future', 'true');
    expect(dayCell('2026-10-04')).toBeDisabled();
    expect(cellFig('2026-10-04')).toBe('');
  });

  it("opens on the house's month when the browser's month has already turned", async () => {
    browserAt('2026-11-01T12:00:00Z');
    routeMonth((year, month) => houseMonth({ year, month, today: '2026-10-31' }));
    mount();

    await waitFor(() =>
      expect(
        api.get.mock.calls.some(
          (c) => String(c[0]).includes('/dashboard/calendar-revenue/') && c[1]?.params?.month === 10,
        ),
      ).toBe(true),
    );
    // October's last day exists only on October's grid, and it is today.
    await waitFor(() => expect(dayCell('2026-10-31')).toHaveAttribute('data-today', 'true'), {
      timeout: 3000,
    });
  });

  it('shows a house with no time zone as dashes and one line to set it, never a zero', async () => {
    browserAt('2026-10-20T12:00:00Z');
    routeMonth(() =>
      houseMonth({
        timezone: null,
        zone_unset: true,
        today: null,
        pos_connected: null,
        monthly_procurement_spend: null,
        monthly_bottles: null,
        monthly_net_sales: null,
        monthly_checks: null,
        dayDefault: {
          procurement_spend: null,
          bottles_sold: null,
          order_count: null,
          net_sales: null,
          checks: null,
        },
        days: {
          '2026-10-09': {
            events: [{ id: 'e1', title: 'Tasting', event_type: 'tasting', event_date: '2026-10-09', event_time: null }],
          },
        },
      }),
    );
    mount();

    const line = await screen.findByTestId('dn-zone-unset');
    expect(within(line).getByRole('link', { name: 'Set the time zone' })).toHaveAttribute(
      'href',
      '/settings?tab=time-zone',
    );
    for (let d = 1; d <= 19; d++) {
      const date = `2026-10-${String(d).padStart(2, '0')}`;
      expect(cellFig(date)).toBe('—');
      expect(dayCell(date)).toHaveAttribute('data-today', 'false');
    }
    const totals = screen.getByTestId('dn-month-totals').textContent ?? '';
    expect(totals).not.toMatch(/\$0|\b0\b/);
    expect(dayCell('2026-10-09').querySelector('.dn-dot')).not.toBeNull();

    fireEvent.click(dayCell('2026-10-09'));
    expect(await screen.findByText('Tasting')).toBeInTheDocument();
    expect(screen.getAllByText(/time zone, which isn’t set/).length).toBeGreaterThan(0);
  });

  it('withholds net sales from a role that does not see them', async () => {
    browserAt('2026-10-03T19:00:00Z');
    routeMonth(() =>
      houseMonth({
        days: { '2026-10-02': { ...TRADING_DAY['2026-10-02'], net_sales: null, checks: null } },
        dayDefault: { net_sales: null, checks: null },
        sales_withheld: true,
        pos_connected: null,
        monthly_net_sales: null,
        monthly_checks: null,
        monthly_procurement_spend: 500,
      }),
    );
    mount();

    await waitFor(() => expect(cellFig('2026-10-02')).toBe('$500'));
    expect(screen.getByRole('region', { name: 'Month calendar — paid to vendors per day' })).toBeInTheDocument();
    expect(screen.getByTestId('dn-month-totals').textContent).not.toMatch(/net sales/);

    fireEvent.click(dayCell('2026-10-02'));
    expect(await screen.findByText('Paid to vendors')).toBeInTheDocument();
    expect(screen.queryByText('Net sales')).not.toBeInTheDocument();
    expect(screen.queryByText('Checks')).not.toBeInTheDocument();
  });

  it("opens a day with its net sales and checks beside what was paid to vendors", async () => {
    browserAt('2026-10-03T19:00:00Z');
    routeMonth(() => houseMonth({ days: TRADING_DAY, monthly_net_sales: 800 }));
    mount();

    await waitFor(() => expect(cellFig('2026-10-02')).toBe('$800'));
    fireEvent.click(dayCell('2026-10-02'));
    const net = await screen.findByText('Net sales');
    expect(net.previousElementSibling?.textContent).toBe('$800');
    expect(screen.getByText('Checks').previousElementSibling?.textContent).toBe('12');
    expect(screen.getByText('Paid to vendors').previousElementSibling?.textContent).toBe('$500');
  });

  it('says no register is connected instead of drawing zero sales', async () => {
    browserAt('2026-10-03T19:00:00Z');
    routeMonth(() =>
      houseMonth({
        days: { '2026-10-02': { ...TRADING_DAY['2026-10-02'], net_sales: null, checks: null } },
        dayDefault: { net_sales: null, checks: null },
        pos_connected: false,
        monthly_net_sales: null,
        monthly_checks: null,
      }),
    );
    mount();

    await waitFor(() => expect(cellFig('2026-10-02')).toBe('$500'));
    expect(screen.getByTestId('dn-month-totals').textContent).not.toMatch(/net sales/);
    fireEvent.click(dayCell('2026-10-02'));
    expect(await screen.findByTestId('dn-no-register')).toHaveTextContent('No register connected');
    expect(screen.queryByText('Net sales')).not.toBeInTheDocument();
  });

  it("lists a delivery on the house's day, not the UTC date of its timestamp", async () => {
    browserAt('2026-10-05T19:00:00Z');
    routeMonth(() => houseMonth({ today: '2026-10-05', days: TRADING_DAY }), {
      '/orders/history': {
        orders: [
          // 20:00 on Oct 2 in Los Angeles; Oct 3 by the UTC prefix.
          { id: 'o1', wineName: 'Yakut', deliveredAt: '2026-10-03T03:00:00Z', quantity: 6, finalPrice: 10, totalCost: 60 },
        ],
        total: 1,
        page: 1,
        limit: 100,
        hasMore: false,
      },
    });
    mount();

    await waitFor(() => expect(cellFig('2026-10-02')).toBe('$800'));
    fireEvent.click(dayCell('2026-10-02'));
    expect(await screen.findByText('Yakut')).toBeInTheDocument();

    fireEvent.click(dayCell('2026-10-03'));
    expect(await screen.findByText('No deliveries landed this day.')).toBeInTheDocument();
    expect(screen.queryByText('Yakut')).not.toBeInTheDocument();
  });

  it('no longer says every figure on the page is procurement', async () => {
    browserAt('2026-10-03T19:00:00Z');
    routeMonth(() => houseMonth());
    mount();

    expect(await screen.findByTestId('dn-figures-note')).toHaveTextContent(
      'Net sales are register check subtotals before tax and surcharge',
    );
    expect(screen.queryByText(/Figures on this page are procurement/)).not.toBeInTheDocument();
  });
});
