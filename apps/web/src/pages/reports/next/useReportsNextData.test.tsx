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

describe('useReportsNextData — staff with no saved sheet (r36 reports gap 3)', () => {
  beforeEach(() => {
    auth.rid = 'r1';
    api.get.mockReset();
    api.get.mockResolvedValue({ data: [] });
  });

  it('hands staff the readable house sheet, and a manager the hand-set one', () => {
    auth.role = 'staff';
    const staff = renderHook(() => useReportsNextData(30, () => {}), { wrapper: wrapper() });
    const ids = staff.result.current.sheet.cuttings.map((c) => c.id);
    expect(ids).not.toContain('seats');
    expect(ids).not.toContain('service');
    expect(staff.result.current.role).toBe('staff');
    auth.role = 'manager';
    const manager = renderHook(() => useReportsNextData(30, () => {}), { wrapper: wrapper() });
    expect(manager.result.current.sheet.cuttings.map((c) => c.id)).toEqual(
      defaultSheet().cuttings.map((c) => c.id),
    );
  });
});
