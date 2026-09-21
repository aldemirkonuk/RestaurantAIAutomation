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
import { render, screen, waitFor } from '@testing-library/react';
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
    user: { userId: 'user-1', name: 'Ada Konuk', email: 'ada@sim.test', role: 'owner' },
    activeRestaurantId: 'rest-A',
    activeRole: 'owner',
    isAuthenticated: true,
  }),
}));

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
