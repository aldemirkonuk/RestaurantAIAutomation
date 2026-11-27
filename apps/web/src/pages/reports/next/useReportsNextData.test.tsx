/**
 * ADR 0348 — staff keep /reports; the table and server registers are not sent.
 *
 * The gateway refuses `GET /analytics/table-performance/:rid` and
 * `GET /analytics/waiters/:rid` to every role but owner and manager
 * (`analytics.controller.ts`, `@Roles("owner", "manager")`). The page's half of
 * that ruling is that it never asks: a reader whose house role is not listed,
 * or not known yet, makes no request to either path and is handed a register
 * that says it is held back, with no retry. These run the real hook and the
 * real catalogue; only the HTTP boundary and the role are doubled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ rid: 'r1' as string | null, role: 'staff' as string | null }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid, activeRole: auth.role }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: {}, updatePreferences: vi.fn(), isLoading: false }),
}));
// The two desks are their own seams with their own tests; held still here.
vi.mock('./useGoalsDesk', () => ({ useGoalsDesk: () => ({}) }));
vi.mock('./useReportExports', () => ({ useReportExports: () => ({}) }));

import { useReportsNextData } from './useReportsNextData';
import type { AnalysisId } from './rp-sheet';

const SEATS = '/analytics/table-performance/r1?sinceDays=90';
const SERVICE = '/analytics/waiters/r1?sinceDays=90';
const READING = '/analytics/insights/r1?limit=40';

/** The 'service' preset's money half, plus the feed every sheet reads. */
const SHOWING: AnalysisId[] = ['seats', 'service'];

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function paths(): string[] {
  return api.get.mock.calls.map((c) => String(c[0]));
}

function mount() {
  return renderHook(() => useReportsNextData(30, () => {}, SHOWING), { wrapper: wrapper() });
}

describe('useReportsNextData — registers a role is not sent (ADR 0348)', () => {
  beforeEach(() => {
    auth.rid = 'r1';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path === SEATS) return { data: { tables: [] } };
      if (path === SERVICE) return { data: { waiters: [] } };
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it('staff: no request to either path, and each register says it is held back', async () => {
    auth.role = 'staff';
    const { result } = mount();

    // The feed staff may read is still asked for, so the page is not blank.
    await waitFor(() => expect(paths()).toContain(READING));
    expect(paths()).not.toContain(SEATS);
    expect(paths()).not.toContain(SERVICE);

    for (const id of SHOWING) {
      const reg = result.current.registers[id];
      expect(reg).toBeDefined();
      expect(reg!.loading).toBe(false);
      expect(reg!.data).toBeUndefined();
      expect(reg!.failure).toMatchObject({
        status: null,
        forbidden: true,
        heldBack: { readers: ['owner', 'manager'], known: true },
      });
    }
  });

  it('staff: reading everything again still does not ask for them', async () => {
    auth.role = 'staff';
    const { result } = mount();
    await waitFor(() => expect(paths()).toContain(READING));
    const before = api.get.mock.calls.length;

    act(() => {
      result.current.refetchAll();
      result.current.registers.seats!.refetch();
    });
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(before));
    expect(paths()).not.toContain(SEATS);
    expect(paths()).not.toContain(SERVICE);
  });

  it('a house role not known yet: nothing is asked, and the register says why', async () => {
    auth.role = null;
    const { result } = mount();
    await waitFor(() => expect(paths()).toContain(READING));
    expect(paths()).not.toContain(SEATS);
    expect(paths()).not.toContain(SERVICE);
    expect(result.current.registers.seats!.failure?.heldBack).toEqual({
      readers: ['owner', 'manager'],
      known: false,
    });
  });

  it.each(['owner', 'manager'])('%s: both registers are asked for and answered', async (role) => {
    auth.role = role;
    const { result } = mount();
    await waitFor(() => {
      expect(paths()).toContain(SEATS);
      expect(paths()).toContain(SERVICE);
    });
    await waitFor(() => expect(result.current.registers.seats!.loading).toBe(false));
    expect(result.current.registers.seats!.failure).toBeNull();
    expect(result.current.registers.service!.failure).toBeNull();
  });

  it('the feed has no readers list, so it is never held back', async () => {
    auth.role = 'staff';
    const { result } = mount();
    await waitFor(() => expect(result.current.reading.loading).toBe(false));
    expect(result.current.reading.failure).toBeNull();
  });
});

describe('useReportsNextData — a window switch leaves the other registers the same objects (perf-p4-5)', () => {
  it('seats keeps its register identity while till reads the new window', async () => {
    auth.role = 'owner';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path === SEATS) return { data: { tables: [] } };
      if (path.startsWith('/analytics/pos-revenue/r1')) return { data: { posConnected: true } };
      throw new Error(`unexpected GET ${path}`);
    });
    const { result, rerender } = renderHook(
      ({ days }: { days: number }) => useReportsNextData(days, () => {}, ['seats', 'till']),
      { wrapper: wrapper(), initialProps: { days: 30 } },
    );
    await waitFor(() => expect(result.current.registers.till?.loading).toBe(false));
    await waitFor(() => expect(result.current.registers.seats?.loading).toBe(false));
    const seats = result.current.registers.seats;
    const till = result.current.registers.till;

    rerender({ days: 90 });
    await waitFor(() => expect(paths()).toContain('/analytics/pos-revenue/r1?days=90'));

    expect(result.current.registers.seats).toBe(seats);
    expect(result.current.registers.till).not.toBe(till);
  });
});

describe('useReportsNextData — a till window is read before the click (perf-p6-4)', () => {
  const TILL90 = '/analytics/pos-revenue/r1?days=90';
  function arrange() {
    auth.role = 'owner';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path.startsWith('/analytics/pos-revenue/r1')) return { data: { posConnected: true } };
      throw new Error(`unexpected GET ${path}`);
    });
  }

  it('warming 90d reads it once, and the click then reads nothing more', async () => {
    arrange();
    const { result, rerender } = renderHook(
      ({ days }: { days: number }) => useReportsNextData(days, () => {}, ['till']),
      { wrapper: wrapper(), initialProps: { days: 30 } },
    );
    await waitFor(() => expect(result.current.registers.till?.loading).toBe(false));

    act(() => {
      result.current.warmTillWindow(90);
      result.current.warmTillWindow(90); // a second hover is the same read
    });
    await waitFor(() => expect(paths().filter((p) => p === TILL90)).toHaveLength(1));

    rerender({ days: 90 }); // the click
    await waitFor(() => expect(result.current.registers.till?.loading).toBe(false));
    expect(result.current.registers.till?.data).toBeDefined();
    expect(paths().filter((p) => p === TILL90)).toHaveLength(1);
  });

  it('does not warm the window already showing, nor for a role held back', async () => {
    arrange();
    const { result } = renderHook(() => useReportsNextData(30, () => {}, ['till']), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.registers.till?.loading).toBe(false));
    const before = paths().length;
    act(() => result.current.warmTillWindow(30));
    expect(paths().length).toBe(before);
  });
});

describe('useReportsNextData — no till window is read ahead without intent (perf-p9-2)', () => {
  const TILL = (d: number) => `/analytics/pos-revenue/r1?days=${d}`;
  let idle: Array<() => void>;
  function arrange() {
    auth.role = 'owner';
    idle = [];
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (fn: () => void) => idle.push(fn);
    (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = () => {};
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path.startsWith('/analytics/pos-revenue/r1')) return { data: { posConnected: true } };
      throw new Error(`unexpected GET ${path}`);
    });
  }
  afterEach(() => {
    cleanup();
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  });

  it('once settled and idle, reads only the window showing; the other two wait for a pointer or focus', async () => {
    arrange();
    const { result } = renderHook(() => useReportsNextData(30, () => {}, ['till']), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.registers.till?.loading).toBe(false));
    await new Promise((r) => setTimeout(r, 300)); // past the old 200 ms fallback timer
    expect(idle).toHaveLength(0); // nothing queued for idle time
    expect(paths().filter((p) => p !== READING)).toEqual([TILL(30)]);
  });

  it('a hover still reads exactly the window it points at', async () => {
    arrange();
    const { result } = renderHook(() => useReportsNextData(30, () => {}, ['till']), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.registers.till?.loading).toBe(false));
    act(() => result.current.warmTillWindow(7));
    await waitFor(() => expect(paths()).toContain(TILL(7)));
    expect(paths()).not.toContain(TILL(90));
  });
});
