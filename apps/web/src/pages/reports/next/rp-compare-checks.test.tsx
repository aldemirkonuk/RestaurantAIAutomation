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
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: 'r1', activeRole: 'owner' }) }));
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
import { flushWarm, forgetWarm, warmRead } from './rp-warm';

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

describe('warm start keeps only a whole read (r108 g8)', () => {
  const OWNER = { userId: 'u1', restaurantId: 'r1', role: 'owner' };
  beforeEach(() => forgetWarm());

  it('[REVERT-FAILS] a till read whose N read failed is not kept; a whole one is', async () => {
    const key = JSON.stringify(['till', 30, 'prior']);
    await readTill(true, true);
    flushWarm();
    expect(warmRead(OWNER, key)).toBeUndefined();
    forgetWarm();
    await readTill(true);
    flushWarm();
    expect(warmRead(OWNER, key)).toBeDefined();
  });

  it('[REVERT-FAILS] a three-source read with one source down is not kept', async () => {
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/analytics/seasonality/')) throw new Error('down');
      return { data: {} };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useReportsNextData(30, () => {}, ['bench']), { wrapper });
    await waitFor(() => expect(result.current.registers.bench?.data).toBeDefined());
    flushWarm();
    expect(warmRead(OWNER, JSON.stringify(['bench', null, null]))).toBeUndefined();
  });
});
