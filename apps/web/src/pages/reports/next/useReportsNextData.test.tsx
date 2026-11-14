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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
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

describe('useReportsNextData — the till is not sent for staff (ADR 0298 decision 9)', () => {
  const TILL = '/analytics/pos-revenue/r1?days=30';

  beforeEach(() => {
    auth.rid = 'r1';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path === TILL) return { data: { posConnected: true, revenue: 10, checkCount: 1, dailySeries: [] } };
      throw new Error(`unexpected GET ${path}`);
    });
  });

  const mountTill = () =>
    renderHook(() => useReportsNextData(30, () => {}, ['till']), { wrapper: wrapper() });

  it('staff: no request to the till, and its register says it is held back', async () => {
    auth.role = 'staff';
    const { result } = mountTill();
    await waitFor(() => expect(paths()).toContain(READING));
    expect(paths()).not.toContain(TILL);
    expect(result.current.registers.till!.failure).toMatchObject({
      forbidden: true,
      heldBack: { readers: ['owner', 'manager'], known: true },
    });
  });

  it.each(['owner', 'manager'])('%s: the till is asked for and answered', async (role) => {
    auth.role = role;
    const { result } = mountTill();
    await waitFor(() => expect(paths()).toContain(TILL));
    await waitFor(() => expect(result.current.registers.till!.loading).toBe(false));
    expect(result.current.registers.till!.failure).toBeNull();
  });
});

describe('useReportsNextData — the house’s money (audit G5)', () => {
  const answer = (body: unknown | Error) => {
    auth.rid = 'r1';
    auth.role = 'owner';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === '/settings/currency') {
        if (body instanceof Error) throw body;
        return { data: body };
      }
      if (path === READING) return { data: { insights: [] } };
      return { data: {} };
    });
  };
  const row = (code: string | null, readable = true) => ({
    restaurantId: 'r1',
    code,
    country: null,
    readable,
    reason: readable ? null : 'read failed',
    statedAt: null,
  });

  it('a stated code is the one the sheet prints in', async () => {
    answer(row('TRY'));
    const { result } = mount();
    await waitFor(() => expect(result.current.currency).toEqual({ state: 'stated', code: 'TRY' }));
  });

  it('a house that never stated one is unstated, not dollars', async () => {
    answer(row(null));
    const { result } = mount();
    await waitFor(() => expect(result.current.currency).toEqual({ state: 'unstated', code: null }));
  });

  it('a failed or unreadable read is unread, never unstated', async () => {
    answer(row(null, false));
    const first = mount();
    await waitFor(() =>
      expect(first.result.current.currency).toMatchObject({ state: 'unread', pending: false }),
    );
    // A thrown read is retried once before it settles as unread.
    answer(new Error('503'));
    const second = mount();
    await waitFor(
      () => expect(second.result.current.currency).toMatchObject({ state: 'unread', pending: false }),
      { timeout: 4000 },
    );
  });
});

describe('useReportsNextData — the money lenses are not sent for staff (ADR 0348 decision 3)', () => {
  const QUADRANTS = '/analytics/menu-engineering/r1';
  const PACING = '/analytics/cashflow/r1';
  const BENCH = '/analytics/overview/r1';
  const MONEY: AnalysisId[] = ['quadrants', 'pacing', 'bench'];
  let answer: Record<string, unknown>;

  beforeEach(() => {
    auth.rid = 'r1';
    answer = {};
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path in answer) return { data: answer[path] };
      if ([QUADRANTS, PACING, BENCH].includes(path)) return { data: {} };
      throw new Error(`unexpected GET ${path}`);
    });
  });

  const mountMoney = () =>
    renderHook(() => useReportsNextData(30, () => {}, MONEY), { wrapper: wrapper() });

  it('[REVERT-FAILS] staff: no request to menu engineering, cashflow or the overview, and each says it is held back', async () => {
    auth.role = 'staff';
    const { result } = mountMoney();
    await waitFor(() => expect(paths()).toContain(READING));
    for (const p of [QUADRANTS, PACING, BENCH]) expect(paths()).not.toContain(p);
    for (const id of MONEY)
      expect(result.current.registers[id]!.failure).toMatchObject({
        forbidden: true,
        heldBack: { readers: ['owner', 'manager'], known: true },
      });
  });

  it('[REVERT-FAILS] a lens the gateway withheld for the role reads as held back, never as an empty register', async () => {
    auth.role = 'manager';
    answer[QUADRANTS] = { restaurantId: 'r1', withheldForRole: ['money', 'sales'] };
    const { result } = mountMoney();
    await waitFor(() => expect(result.current.registers.quadrants!.loading).toBe(false));
    expect(result.current.registers.quadrants!.data).toBeUndefined();
    expect(result.current.registers.quadrants!.failure).toMatchObject({
      forbidden: true,
      heldBack: { readers: ['owner', 'manager'], known: true },
    });
    await waitFor(() => expect(result.current.registers.pacing!.loading).toBe(false));
    expect(result.current.registers.pacing!.failure).toBeNull();
  });
});

describe('useReportsNextData — the figures of record and the reorder lens (ADR 0348, slice 4)', () => {
  const LEDGER = '/analytics/financial/r1';
  const RESTOCK = '/analytics/inventory-science/r1';
  const RESTOCK_WITHOUT_COST = {
    params: { serviceLevel: 0.95, leadTimeDays: 7, demandWindowDays: 90 },
    basis: {},
    costWithheld: true,
    skuCount: 1,
    reorderCount: 1,
    reorderList: [{ id: 'g1', name: 'Rakı', onHand: 2, daysOfCover: 1, reorderPoint: 4, safetyStock: 1, stockoutProbability: 0.6, unitCost: null }],
  };

  beforeEach(() => {
    auth.rid = 'r1';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path === LEDGER) return { data: {} };
      if (path === RESTOCK) return { data: RESTOCK_WITHOUT_COST };
      throw new Error(`unexpected GET ${path}`);
    });
  });

  const mountBoth = () =>
    renderHook(() => useReportsNextData(30, () => {}, ['ledger', 'restock']), { wrapper: wrapper() });

  it('[REVERT-FAILS] staff: no request to the figures of record, and the ledger says it is held back', async () => {
    auth.role = 'staff';
    const { result } = mountBoth();
    await waitFor(() => expect(paths()).toContain(RESTOCK));
    expect(paths()).not.toContain(LEDGER);
    expect(result.current.registers.ledger!.failure).toMatchObject({
      forbidden: true,
      heldBack: { readers: ['owner', 'manager'], known: true },
    });
  });

  it('staff: the reorder lens is asked for and read, its withheld cost is not the whole lens withheld', async () => {
    auth.role = 'staff';
    const { result } = mountBoth();
    await waitFor(() => expect(result.current.registers.restock!.loading).toBe(false));
    expect(result.current.registers.restock!.failure).toBeNull();
    const data = result.current.registers.restock!.data as { reorderList: Array<{ name: string; onHand: number }> };
    expect(data.reorderList.map((r) => [r.name, r.onHand])).toEqual([['Rakı', 2]]);
  });

  it.each(['owner', 'manager'])('%s: the figures of record are asked for', async (role) => {
    auth.role = role;
    const { result } = mountBoth();
    await waitFor(() => expect(paths()).toContain(LEDGER));
    await waitFor(() => expect(result.current.registers.ledger!.loading).toBe(false));
    expect(result.current.registers.ledger!.failure).toBeNull();
  });
});
