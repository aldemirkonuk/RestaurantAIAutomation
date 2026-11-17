import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A role still being asked is not a role that refused (r41 gap 2). While
 * `/auth/me/role` is in flight the held registers draw as skeletons, the
 * exports desk is loading, and the house sheet is not shown to a reader it may
 * then be clipped for. A failed read, or a role not listed, still says so.
 */
const auth = vi.hoisted(() => ({
  rid: 'r1' as string | null,
  role: null as string | null,
  state: 'loading' as string | undefined,
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: auth.rid,
    activeRole: auth.role,
    activeRoleState: auth.state,
  }),
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

import { useReportsNextData } from './useReportsNextData';
import { useReportExports } from './useReportExports';
import type { AnalysisId } from '@/pages/reports/next/rp-sheet';

const SEATS = '/analytics/table-performance/r1?sinceDays=90';
const READING = '/analytics/insights/r1?limit=40';
const SHOWING: AnalysisId[] = ['seats', 'service'];

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}
const paths = () => api.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  auth.rid = 'r1';
  auth.role = null;
  auth.state = 'loading';
  api.get.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path === READING) return { data: { insights: [] } };
    return { data: {} };
  });
});

describe('a role still being asked', () => {
  it('draws a held register as a skeleton, asks for nothing, and claims nothing', async () => {
    const { result } = renderHook(() => useReportsNextData(30, () => {}, SHOWING), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(paths()).toContain(READING));
    expect(paths()).not.toContain(SEATS);
    const reg = result.current.registers.seats!;
    expect(reg.loading).toBe(true);
    expect(reg.failure).toBeNull();
    expect(reg.data).toBeUndefined();
  });

  it('keeps the sheet behind the outlines, so staff are not shown the house sheet first', () => {
    const { result } = renderHook(() => useReportsNextData(30, () => {}, SHOWING), {
      wrapper: wrapper(),
    });
    expect(result.current.sheetKnown).toBe(false);
    expect(result.current.sheetUnread).toBeNull();
  });

  it('lets go once the role is known: an owner is asked for the register', async () => {
    auth.state = 'known';
    auth.role = 'owner';
    const { result } = renderHook(() => useReportsNextData(30, () => {}, SHOWING), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(paths()).toContain(SEATS));
    expect(result.current.sheetKnown).toBe(true);
  });

  it('still refuses in words when the role read failed', async () => {
    auth.state = 'unknown';
    auth.role = null;
    const { result } = renderHook(() => useReportsNextData(30, () => {}, SHOWING), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(paths()).toContain(READING));
    const reg = result.current.registers.seats!;
    expect(reg.loading).toBe(false);
    expect(reg.failure?.heldBack).toEqual({ readers: ['owner', 'manager'], known: false });
  });

  it('still says who a register is written for when the role is known and not listed', async () => {
    auth.state = 'known';
    auth.role = 'staff';
    const { result } = renderHook(() => useReportsNextData(30, () => {}, SHOWING), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(paths()).toContain(READING));
    const reg = result.current.registers.seats!;
    expect(reg.loading).toBe(false);
    expect(reg.failure?.heldBack).toEqual({ readers: ['owner', 'manager'], known: true });
  });

  it('the exports desk is loading, not "your role is not known yet"', () => {
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), {
      wrapper: wrapper(),
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.readOnlyReason).toBeNull();
  });

  it('the exports desk says so once the role read has failed', () => {
    auth.state = 'unknown';
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), {
      wrapper: wrapper(),
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.readOnlyReason).toMatch(/not known yet/);
  });
});
