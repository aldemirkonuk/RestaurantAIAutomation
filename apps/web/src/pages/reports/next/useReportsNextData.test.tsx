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
/**
 * The preferences hook as the real one behaves: `placeholderData: {}` puts the
 * query in `success` at once, so `isLoading` is false BEFORE the gateway has
 * answered — only `isPlaceholderData` says the sheet is not the reader's yet.
 */
const prefs = vi.hoisted(() => ({
  isPlaceholderData: false,
  error: null as Error | null,
  userId: 'u1' as string | null,
  write: vi.fn(),
}));
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: {},
    updatePreferences: vi.fn(),
    updatePreferencesAsync: prefs.write,
    isLoading: false,
    isPlaceholderData: prefs.isPlaceholderData,
    error: prefs.error,
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (pick: (s: { user: { userId: string } | null }) => unknown) =>
    pick({ user: prefs.userId ? { userId: prefs.userId } : null }),
}));
// The two desks are their own seams with their own tests; held still here.
vi.mock('./useGoalsDesk', () => ({ useGoalsDesk: () => ({}) }));
vi.mock('./useReportExports', () => ({ useReportExports: () => ({}) }));
// The role-aware default (r36 gap 3) is spied, not replaced: its own rules
// are tested in rp-readable.test.ts; here only that the hook hands it the role.
const readable = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('./rp-readable', async () => {
  const actual = await vi.importActual<typeof import('./rp-readable')>('./rp-readable');
  return {
    ...actual,
    defaultIdsFor: (role: unknown) => {
      readable.calls.push(role);
      return actual.defaultIdsFor(role as never);
    },
  };
});

import { defaultSheet, useReportsNextData } from './useReportsNextData';
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
    prefs.isPlaceholderData = false;
    prefs.error = null;
    prefs.userId = 'u1';
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

describe('useReportsNextData — the bench reads what the sheet already reads (audit G9)', () => {
  const CASHFLOW = '/analytics/cashflow/r1';
  const SEASONALITY = '/analytics/seasonality/r1';
  const GOALS = '/analytics/goals/r1?status=active';

  beforeEach(() => {
    auth.rid = 'r1';
    auth.role = 'owner';
    api.get.mockReset();
    api.get.mockImplementation(async (path: string) => {
      if (path === READING) return { data: { insights: [] } };
      if (path === CASHFLOW) return { data: { spendLast30d: 1200, spendPrev30d: 900 } };
      if (path === SEASONALITY) throw Object.assign(new Error('503'), { response: { status: 503 } });
      if (path === GOALS) return { data: [] };
      if (path.startsWith('/settings/currency')) return { data: { currency: 'USD' } };
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it('never calls /overview, and pacing and the bench share one cashflow read', async () => {
    const { result } = renderHook(() => useReportsNextData(30, () => {}, ['pacing', 'bench']), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.registers.bench?.loading).toBe(false));
    await waitFor(() => expect(result.current.registers.pacing?.loading).toBe(false));
    expect(paths().some((p) => p.includes('/overview'))).toBe(false);
    expect(paths().filter((p) => p === CASHFLOW)).toHaveLength(1);
    // A failed source is a missing lens on the bench, not a failed bench.
    const bench = result.current.registers.bench!;
    expect(bench.failure).toBeNull();
    expect(bench.data).toMatchObject({ seasonalityMissing: true, cashflowMissing: false, goalsMissing: false });
  });
});

/**
 * The cold-load window. Until the account's preferences answer, the sheet on
 * screen is the HOUSE sheet, not the reader's — and a save made from it would
 * write the house sheet over the reader's own. So the sheet is not "known"
 * until `isPlaceholderData` is false, and a save is refused until it is.
 */
describe('useReportsNextData — whose sheet this is', () => {
  beforeEach(() => {
    auth.rid = 'r1';
    auth.role = 'owner';
    prefs.isPlaceholderData = false;
    prefs.error = null;
    prefs.userId = 'u1';
    prefs.write.mockReset();
    prefs.write.mockResolvedValue({});
    api.get.mockReset();
    api.get.mockResolvedValue({ data: {} });
  });

  it('is not known while the preferences are still the placeholder — and a read still starts', async () => {
    prefs.isPlaceholderData = true;
    const { result } = mount();
    expect(result.current.sheetKnown).toBe(false);
    expect(result.current.sheetUnread).toBeNull();
    // Nothing waits on the preferences round trip: the reads go out now.
    await waitFor(() => expect(paths()).toContain(READING));
  });

  it('is known once the account has answered', () => {
    const { result } = mount();
    expect(result.current.sheetKnown).toBe(true);
    expect(result.current.sheetUnread).toBeNull();
  });

  it('refuses to save a sheet that is not known, and writes nothing', async () => {
    prefs.isPlaceholderData = true;
    const { result } = mount();
    await expect(result.current.saveSheet(defaultSheet())).rejects.toThrow();
    expect(prefs.write).not.toHaveBeenCalled();
  });

  it('hands back the write itself, so the page learns whether it landed', async () => {
    const { result } = mount();
    await expect(result.current.saveSheet(defaultSheet())).resolves.toBeUndefined();
    expect(prefs.write).toHaveBeenCalledTimes(1);
    expect(Object.keys(prefs.write.mock.calls[0][0])).toEqual(['reportsSheet']);

    prefs.write.mockRejectedValueOnce(new Error('Request failed with status code 503'));
    await expect(result.current.saveSheet(defaultSheet())).rejects.toThrow('503');
  });

  it('says so when the preferences could not be read, instead of passing the house sheet off as the reader’s', () => {
    prefs.error = new Error('Request failed with status code 500');
    const { result } = mount();
    expect(result.current.sheetKnown).toBe(false);
    expect(result.current.sheetUnread).toBe(
      'Your own arrangement of this sheet could not be read (Mudavym’s side failed while reading it), so the house sheet is shown. Arranging is off until it can be read.',
    );
  });

  it('keeps the last good sheet, stays arrangeable and says the refresh failed when a refetch fails after a good load', () => {
    const { result, rerender } = mount();
    expect(result.current.sheetKnown).toBe(true);
    // A background refetch rejects: React Query keeps the data and sets `error`.
    prefs.error = new Error('Network Error');
    rerender();
    expect(result.current.sheetKnown).toBe(true);
    expect(result.current.sheetUnread).toBeNull();
    expect(result.current.sheetStale).toMatch(/could not be refreshed/);
    result.current.saveSheet(defaultSheet());
    expect(prefs.write).toHaveBeenCalledTimes(1);
    // It heals when a later read answers.
    prefs.error = null;
    rerender();
    expect(result.current.sheetStale).toBeNull();
  });

  it('never waits forever: with no account to read from, it says so', () => {
    // The preferences query is disabled without a user id, and a disabled
    // query keeps its placeholder forever — so placeholder alone cannot be
    // what the page waits on.
    prefs.userId = null;
    prefs.isPlaceholderData = true;
    const { result } = mount();
    expect(result.current.sheetKnown).toBe(false);
    expect(result.current.sheetUnread).toMatch(/signed in/);
  });
});

describe('useReportsNextData — the money lenses are not sent for staff (ADR 0348 decision 3)', () => {
  const QUADRANTS = '/analytics/menu-engineering/r1';
  const PACING = '/analytics/cashflow/r1';
  // The bench reads cashflow, seasonality and the active goals directly
  // (audit G9); seasonality is the source only it asks for here.
  const BENCH = '/analytics/seasonality/r1';
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

  it('[REVERT-FAILS] the bench is held back when one of its sources is withheld, never read as an empty register (r33 meet)', async () => {
    auth.role = 'manager';
    answer[BENCH] = { restaurantId: 'r1', withheldForRole: ['sales'] };
    const { result } = mountMoney();
    await waitFor(() => expect(result.current.registers.bench!.loading).toBe(false));
    expect(result.current.registers.bench!.data).toBeUndefined();
    expect(result.current.registers.bench!.failure).toMatchObject({
      forbidden: true,
      heldBack: { readers: ['owner', 'manager'], known: true },
    });
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

describe('useReportsNextData — staff with no saved sheet (r36 reports gap 3)', () => {
  beforeEach(() => {
    auth.rid = 'r1';
    api.get.mockReset();
    api.get.mockResolvedValue({ data: [] });
    readable.calls.length = 0;
  });

  it('builds the house sheet for the house role, and says which role that is', () => {
    for (const role of ['staff', 'manager'] as const) {
      auth.role = role;
      readable.calls.length = 0;
      const { result } = renderHook(() => useReportsNextData(30, () => {}), { wrapper: wrapper() });
      expect(readable.calls).toContain(role);
      expect(result.current.role).toBe(role);
    }
  });
});
