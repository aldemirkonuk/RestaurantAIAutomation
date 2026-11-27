/**
 * r107 g2: with compare on, Checks and Average check are the shown window's own (the N-day
 * read the card reads with compare off), not a dash. The doubled read supplies Taken, the
 * line and the prior; the two reads are pinned so they cannot disagree silently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
const auth = vi.hoisted(() => ({ role: 'owner' as string }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: 'r1', activeRole: auth.role }) }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: {}, updatePreferences: vi.fn(), updatePreferencesAsync: vi.fn(),
    isLoading: false, isPlaceholderData: false, error: null,
  }),
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (pick: (s: unknown) => unknown) => pick({ user: { userId: 'u1' } }) }));
vi.mock('./useGoalsDesk', () => ({ useGoalsDesk: () => ({}) }));
vi.mock('./useReportExports', () => ({ useReportExports: () => ({}) }));

import { useReportsNextData } from './useReportsNextData';
import { daysBetween, till } from './rp-registers-trade';

// The 600-check seed, 30 days: 176 checks in the window (owner, 2026-09-02..10-01).
const FROM = '2026-09-02';
const TO = '2026-10-01';
const P_FROM = '2026-08-03';
const seriesOf = (from: string, to: string, revenue: number) =>
  daysBetween(from, to).map((date) => ({ date, revenue })); // the gateway sends no per-day checks
const N_READ = {
  posConnected: true, revenue: 30 * 130, checkCount: 176, from: FROM, to: TO, days: 30,
  timezone: 'America/Los_Angeles', zoneUnset: false, dailySeries: seriesOf(FROM, TO, 130),
};
const TWO_N_READ = {
  ...N_READ, revenue: 30 * 130 + 30 * 100, checkCount: 301, from: P_FROM, days: 60,
  dailySeries: [...seriesOf(P_FROM, '2026-09-01', 100), ...seriesOf(FROM, TO, 130)],
};
const N_URL = '/analytics/pos-revenue/r1?days=30';
const TWO_N_URL = '/analytics/pos-revenue/r1?days=60';
const ctx = (compare: boolean) => ({ days: 30, compare, currency: 'USD' });

/** The page's own hook over fake reads, then the till's view of what it handed over. */
async function readTill(compare: boolean, failN = false) {
  api.get.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path === TWO_N_URL) return { data: TWO_N_READ };
    if (path === N_URL) {
      if (failN) throw new Error('boom');
      return { data: N_READ };
    }
    return { data: { insights: [] } }; // the feed and the currency, which this spec does not read
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useReportsNextData(30, () => {}, ['till'], undefined, compare), { wrapper });
  await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
  return { view: till.view(result.current.registers.till!.data as never, ctx(compare)), paths: api.get.mock.calls.map((c) => String(c[0])) };
}
const fig = (v: { figures: Array<{ label: string; value: unknown }> }, label: string) => v.figures.find((f) => f.label === label)!.value;

describe('till compare keeps the shown window\u2019s checks', () => {
  beforeEach(() => api.get.mockReset());

  it('[REVERT-FAILS] compare ON reads Checks 176 and the same Average as OFF', async () => {
    const on = await readTill(true);
    const off = await readTill(false);
    expect(fig(on.view, 'Checks')).toBe('176');
    expect(fig(on.view, 'Checks')).toBe(fig(off.view, 'Checks'));
    expect(fig(on.view, 'Average check')).toBe(fig(off.view, 'Average check'));
    expect(fig(on.view, 'Average check')).not.toBe('\u2014');
    // Both reads on: the doubled one for the line and the prior, the plain one for the counts.
    expect(on.paths).toEqual(expect.arrayContaining([TWO_N_URL, N_URL]));
    expect(off.paths).not.toContain(TWO_N_URL);
  });

  it('[REVERT-FAILS] Taken is the sum of the split series and Checks is the N read, so the two reads cannot disagree silently', async () => {
    const { view } = await readTill(true);
    const taken = view.cats!.data.reduce((a, d) => a + (d.value ?? 0), 0);
    expect(taken).toBe(30 * 130);
    expect(N_READ.revenue).toBe(taken); // the N read's takings are the split's
    expect(fig(view, 'Checks')).toBe('176'); // not the doubled read's 301, not a recount
    expect(view.cats!.data.some((d) => d.prior != null)).toBe(true);
  });

  it('[REVERT-FAILS] asks the N-day read only while comparing, never past what can be doubled', () => {
    expect(till.shownPath!('r1', ctx(true))).toBe(N_URL);
    expect(till.shownPath!('r1', ctx(false))).toBeNull();
    expect(till.shownPath!('r1', { days: 365, compare: true })).toBeNull();
  });

  it('is a dash only if the N read itself failed, and the doubled read still draws', async () => {
    const { view } = await readTill(true, true);
    expect(fig(view, 'Checks')).toBe('\u2014');
    expect(fig(view, 'Average check')).toBe('\u2014');
    expect(fig(view, 'Taken')).not.toBe('\u2014');
    expect(view.cats!.data.some((d) => d.prior != null)).toBe(true);
  });
});

describe('a window switch with compare on reads the till alone (perf-p4-5 on the compare chain, r108)', () => {
  it('[REVERT-FAILS] 30 to 90 days asks days=180 beside days=90 once each, and the week keeps its register', async () => {
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/analytics/pos-revenue/r1')) return { data: N_READ };
      if (path === '/analytics/seasonality/r1') return { data: { weekdays: [] } };
      return { data: { insights: [] } };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(
      ({ days }: { days: number }) => useReportsNextData(days, () => {}, ['till', 'week'], undefined, true),
      { wrapper, initialProps: { days: 30 } },
    );
    await waitFor(() => {
      expect(result.current.registers.till?.data).toBeDefined();
      expect(result.current.registers.week?.data).toBeDefined();
    });
    const week = result.current.registers.week;
    const before = api.get.mock.calls.length;

    rerender({ days: 90 });
    await waitFor(() => expect(result.current.registers.till?.loading).toBe(false));
    const asked = api.get.mock.calls.slice(before).map((c) => String(c[0]));
    // One doubled read for Taken, the line and the prior; one N read for Checks and Average.
    expect(asked.filter((p) => p === '/analytics/pos-revenue/r1?days=180')).toHaveLength(1);
    expect(asked.filter((p) => p === '/analytics/pos-revenue/r1?days=90')).toHaveLength(1);
    expect(asked.filter((p) => !p.startsWith('/analytics/pos-revenue/'))).toEqual([]);
    expect(result.current.registers.week).toBe(week);
  });
});

describe('a staff till kept from the reader reads once, whatever the window (r109 reports-8)', () => {
  const WITHHELD = {
    restaurantId: 'r1', from: null, to: null, days: 30, timezone: null, zoneUnset: false,
    posConnected: true, salesWithheld: true, revenue: null, checkCount: null, dailySeries: null,
  };
  const mount = (role: string) => {
    auth.role = role;
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/analytics/pos-revenue/r1')) return { data: role === 'staff' ? WITHHELD : N_READ };
      return { data: { insights: [] } };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(
      ({ days, r }: { days: number; r: string }) => {
        auth.role = r;
        return useReportsNextData(days, () => {}, ['till'], undefined, false);
      },
      { wrapper, initialProps: { days: 30, r: role } },
    );
  };
  const tillReads = () => api.get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/analytics/pos-revenue/'));
  beforeEach(() => {
    auth.role = 'owner';
  });

  it('[REVERT-FAILS] 30 to 90 to 7 days fires no read, and the card is never a loading stand-in', async () => {
    const { result, rerender } = mount('staff');
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
    expect(tillReads()).toEqual(['/analytics/pos-revenue/r1?days=30']);
    const held = result.current.registers.till;
    for (const days of [90, 7, 365]) {
      rerender({ days, r: 'staff' });
      expect(result.current.registers.till?.loading).toBe(false);
      expect(till.view(result.current.registers.till!.data as never, { days, compare: false }).withheld).toBe(true);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(tillReads()).toEqual(['/analytics/pos-revenue/r1?days=30']);
    expect(result.current.registers.till).toBe(held);
  });

  it('an owner still reads each window it picks', async () => {
    const { result, rerender } = mount('owner');
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
    rerender({ days: 90, r: 'owner' });
    await waitFor(() => expect(tillReads()).toContain('/analytics/pos-revenue/r1?days=90'));
  });

  it('a role that moves is asked again, at the window on screen', async () => {
    const { result, rerender } = mount('staff');
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
    rerender({ days: 90, r: 'staff' });
    api.get.mockImplementation(async (path: string) =>
      path.startsWith('/analytics/pos-revenue/r1') ? { data: N_READ } : { data: { insights: [] } },
    );
    rerender({ days: 90, r: 'manager' });
    await waitFor(() => expect(tillReads()).toContain('/analytics/pos-revenue/r1?days=90'));
    await waitFor(() => expect(result.current.registers.till?.data).toMatchObject({ salesWithheld: false }));
  });
});
