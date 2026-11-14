/**
 * r41 /reports gaps 4 and 5: picking another till window keeps the chart on
 * screen, and a quick return to the tab does not read the sheet again.
 *
 * The hook half runs the real `useReportsNextData` against the real catalogue;
 * only the HTTP boundary, the role and the preferences are doubled (as in
 * useReportsNextData.test.tsx). The cutting half renders one `Cutting` with a
 * stand-in register, as CuttingFlat.test.tsx does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ rid: 'r1' as string | null, role: 'owner' as string | null }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid, activeRole: auth.role }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: {},
    updatePreferences: vi.fn(),
    updatePreferencesAsync: vi.fn(),
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (pick: (s: { user: { userId: string } | null }) => unknown) =>
    pick({ user: { userId: 'u1' } }),
}));
vi.mock('./useGoalsDesk', () => ({ useGoalsDesk: () => ({}) }));
vi.mock('./useReportExports', () => ({ useReportExports: () => ({}) }));

import Cutting, { standInSentence } from './Cutting';
import { CATALOGUE } from './rp-catalogue';
import { ANALYSIS_IDS, type AnalysisId } from './rp-sheet';
import type { ArrangeApi } from './rp-arrange';
import { REGISTER_FRESH_MS, useReportsNextData, type Register } from './useReportsNextData';

const SHOWING: AnalysisId[] = ['till'];
const READING = '/analytics/insights/r1?limit=40';
const tillPath = (rid: string, days: number) => `/analytics/pos-revenue/${rid}?days=${days}`;

const tillBody = (days: number, revenue: number) => ({
  posConnected: true,
  revenue,
  checkCount: 10,
  from: '2026-10-01',
  to: '2026-11-13',
  days,
  timezone: 'Europe/Istanbul',
  dailySeries: [{ date: '2026-11-12', revenue, checks: 10 }],
});

/** A GET that answers only when the test says so. */
function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function mountAt(days: number) {
  return renderHook(({ d }) => useReportsNextData(d, () => {}, SHOWING), {
    wrapper: wrapper(),
    initialProps: { d: days },
  });
}

const calls = (path: string) => api.get.mock.calls.filter((c) => String(c[0]) === path).length;

describe('a till window just picked keeps the last one on screen (r41 gap 4)', () => {
  let pending: Record<string, ReturnType<typeof deferred>>;

  beforeEach(() => {
    auth.rid = 'r1';
    auth.role = 'owner';
    pending = {};
    api.get.mockReset();
    api.get.mockImplementation((path: string) => {
      if (path === READING) return Promise.resolve({ data: { insights: [] } });
      if (path === '/settings/currency') return Promise.resolve({ data: { readable: true, code: 'TRY' } });
      if (path === tillPath('r1', 30)) return Promise.resolve({ data: tillBody(30, 300) });
      if (path === tillPath('r2', 30)) return Promise.resolve({ data: tillBody(30, 999) });
      pending[path] = deferred();
      return pending[path].promise.then((data) => ({ data }));
    });
  });

  it('while 90 days are read, the 30-day figures stay, said to be 30 days', async () => {
    const { result, rerender } = mountAt(30);
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());

    rerender({ d: 90 });
    await waitFor(() => expect(pending[tillPath('r1', 90)]).toBeDefined());
    const till = result.current.registers.till!;
    expect(till.loading).toBe(false);
    expect(till.failure).toBeNull();
    expect((till.data as { revenue: number }).revenue).toBe(300);
    expect(till.standIn).toEqual({ shownDays: 30, readingDays: 90 });

    await act(async () => pending[tillPath('r1', 90)].resolve(tillBody(90, 900)));
    await waitFor(() => expect(result.current.registers.till?.standIn).toBeUndefined());
    expect((result.current.registers.till!.data as { revenue: number }).revenue).toBe(900);
  });

  it('a window read before comes back at once, with no stand-in', async () => {
    const { result, rerender } = mountAt(30);
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
    rerender({ d: 90 });
    await act(async () => {
      await waitFor(() => expect(pending[tillPath('r1', 90)]).toBeDefined());
      pending[tillPath('r1', 90)].resolve(tillBody(90, 900));
    });
    await waitFor(() => expect(result.current.registers.till?.standIn).toBeUndefined());

    rerender({ d: 30 });
    expect(result.current.registers.till!.standIn).toBeUndefined();
    expect((result.current.registers.till!.data as { revenue: number }).revenue).toBe(300);
  });

  it('another house never stands in for this one', async () => {
    const { result, rerender } = mountAt(30);
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());

    auth.rid = 'r2';
    rerender({ d: 90 });
    await waitFor(() => expect(pending[tillPath('r2', 90)]).toBeDefined());
    const till = result.current.registers.till!;
    expect(till.standIn).toBeUndefined();
    expect(till.data).toBeUndefined();
    expect(till.loading).toBe(true);
  });

  it('a new window that fails says so; the old figures do not cover it', async () => {
    const { result, rerender } = mountAt(30);
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
    // The register's own `retry: 1` asks twice; both are refused.
    const refuse = api.get.getMockImplementation()!;
    api.get.mockImplementation((path: string) =>
      path === tillPath('r1', 365)
        ? Promise.reject(Object.assign(new Error('boom'), { response: { status: 503 } }))
        : refuse(path),
    );
    rerender({ d: 365 });
    await waitFor(() => expect(result.current.registers.till?.failure).not.toBeNull(), {
      timeout: 4000,
    });
    expect(result.current.registers.till!.standIn).toBeUndefined();
    expect(result.current.registers.till!.data).toBeUndefined();
  });

  it('a register that does not take the window is never a stand-in', async () => {
    // `reading` has no window: its key does not change with the till's.
    const { result, rerender } = mountAt(30);
    await waitFor(() => expect(result.current.reading.data).toBeDefined());
    rerender({ d: 90 });
    expect(result.current.reading.standIn).toBeUndefined();
    expect(result.current.reading.loading).toBe(false);
  });
});

describe('a return to the tab reads again only once the figures are five minutes old (r41 gap 5)', () => {
  const realNow = Date.now;

  beforeEach(() => {
    auth.rid = 'r1';
    auth.role = 'owner';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path === tillPath('r1', 30)) return { data: tillBody(30, 300) };
      return { data: {} };
    });
  });
  afterEach(() => {
    Date.now = realNow;
    focusManager.setFocused(undefined);
  });

  const comeBack = async (afterMs: number) => {
    const t0 = realNow();
    Date.now = () => t0 + afterMs;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
  };

  it('back after two minutes: nothing is read again', async () => {
    const { result } = mountAt(30);
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
    const before = calls(tillPath('r1', 30));
    await comeBack(2 * 60_000);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls(tillPath('r1', 30))).toBe(before);
  });

  it('back on the page within five minutes: the figures already read are drawn, not read again', async () => {
    // The app mounts every query with `refetchOnMount: 'always'` (App.tsx), so
    // the register's own read runs again; the raw payload it shares is what
    // must still count as fresh.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: 'always' } },
    });
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useReportsNextData(30, () => {}, SHOWING), { wrapper: wrap });
    await waitFor(() => expect(first.result.current.registers.till?.data).toBeDefined());
    first.unmount();
    const before = calls(tillPath('r1', 30));
    const t0 = realNow();
    Date.now = () => t0 + 2 * 60_000;
    const again = renderHook(() => useReportsNextData(30, () => {}, SHOWING), { wrapper: wrap });
    await waitFor(() => expect(again.result.current.registers.till?.data).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    expect(calls(tillPath('r1', 30))).toBe(before);
  });

  it('back after six minutes: the till is read again', async () => {
    const { result } = mountAt(30);
    await waitFor(() => expect(result.current.registers.till?.data).toBeDefined());
    const before = calls(tillPath('r1', 30));
    await comeBack(REGISTER_FRESH_MS + 60_000);
    await waitFor(() => expect(calls(tillPath('r1', 30))).toBeGreaterThan(before));
  });
});

/* ───────────────────────────────────────────── the cutting's half ───── */

const noop = vi.fn();
const arrangeStub: ArrangeApi = {
  ...{ picked: null, origin: null, message: '', cols: 12, keyDown: () => noop },
  ...{ pickUp: noop, place: noop, cancel: noop, nudge: noop, resize: noop },
};

function paintTill(register: Register<unknown>, days: number) {
  return render(
    <MemoryRouter initialEntries={['/reports']}>
      <Cutting
        id="till"
        graph="table"
        register={register}
        ctx={{ days }}
        arranging={false}
        swapOptions={ANALYSIS_IDS.map((id) => ({ id, taken: false }))}
        arrange={arrangeStub}
        onGraph={vi.fn()}
        onSwap={vi.fn()}
        onRemove={vi.fn()}
        onDays={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('a cutting standing in for the window being read', () => {
  const data = CATALOGUE.till.select(tillBody(30, 300));

  it('draws the old figures over their own days and says the new ones are being read', () => {
    paintTill(
      { data, loading: false, failure: null, refetch: vi.fn(), standIn: { shownDays: 30, readingDays: 90 } },
      90,
    );
    const cut = screen.getByRole('region', { name: CATALOGUE.till.title });
    expect(within(cut).getByText('the last 30 days of POS checks')).toBeInTheDocument();
    expect(within(cut).queryByText('the last 90 days of POS checks')).toBeNull();
    expect(within(cut).getByRole('status')).toHaveTextContent(
      'Reading the last 90 days. Until they arrive, the figures shown are the last 30 days.',
    );
    // The chip held is the window picked, not the one drawn.
    expect(within(cut).getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cut).getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a register with its own window says nothing more', () => {
    paintTill({ data, loading: false, failure: null, refetch: vi.fn() }, 30);
    const cut = screen.getByRole('region', { name: CATALOGUE.till.title });
    expect(within(cut).getByText('the last 30 days of POS checks')).toBeInTheDocument();
    expect(within(cut).queryByRole('status')).toBeNull();
  });

  it('the sentence names both windows', () => {
    expect(standInSentence({ shownDays: 7, readingDays: 365 })).toBe(
      'Reading the last 365 days. Until they arrive, the figures shown are the last 7 days.',
    );
  });
});
