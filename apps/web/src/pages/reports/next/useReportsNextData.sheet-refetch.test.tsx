/**
 * The failed-save path, with the REAL preferences hook and the REAL React
 * Query underneath — only the HTTP boundary is doubled.
 *
 * The audit of #851/#852 found the hook spec and the page spec could not see
 * this, because both double `useUserPreferences`: a PATCH that the gateway
 * refuses settles, `onSettled` invalidates the preferences, and the refetch
 * fails too (`retry: 1`). React Query then sets `error` but KEEPS the last
 * good data (query-core: a failed refetch does not drop `data`). If
 * `sheetKnown` is read from `error` alone, it goes false while the reader is
 * still arranging their own sheet, so every "Try again" is refused on the spot
 * without reaching the network, and the page says "the house sheet is shown"
 * over the reader's own. A good answer, once had, must keep the sheet known.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const prefsRead = vi.hoisted(() => ({ fail: false }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (pick: (s: { user: { userId: string } | null }) => unknown) =>
    pick({ user: { userId: 'u1' } }),
}));
// The two desks are their own seams with their own tests; held still here.
vi.mock('./useGoalsDesk', () => ({ useGoalsDesk: () => ({}) }));
vi.mock('./useReportExports', () => ({ useReportExports: () => ({}) }));

import { defaultSheet, useReportsNextData } from './useReportsNextData';

const PREFS = '/users/u1/preferences';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReportsNextData(30, () => {}, ['seats']), { wrapper });
}

function prefsReads(): number {
  return api.get.mock.calls.filter((c) => String(c[0]) === PREFS).length;
}

describe('useReportsNextData — a save the gateway refuses, then a refetch that fails', () => {
  beforeEach(() => {
    prefsRead.fail = false;
    api.get.mockReset();
    api.patch.mockReset();
    api.get.mockImplementation(async (url: string) => {
      if (url === PREFS) {
        if (prefsRead.fail) throw new Error('Request failed with status code 502');
        return { data: { preferences: {} } };
      }
      return { data: {} };
    });
  });

  it('keeps the sheet known, says the refresh failed, and lets "Try again" reach the gateway', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.sheetKnown).toBe(true));
    expect(result.current.sheetUnread).toBeNull();
    const readsBefore = prefsReads();

    // The gateway is having a bad minute: the PATCH and every read after it fail.
    prefsRead.fail = true;
    api.patch.mockRejectedValueOnce(new Error('Request failed with status code 503'));
    await act(async () => {
      await expect(result.current.saveSheet(defaultSheet())).rejects.toThrow('503');
    });
    expect(api.patch).toHaveBeenCalledTimes(1);

    // onSettled invalidates; the refetch and its one retry both fail, and
    // React Query sets `error` while keeping the last good preferences.
    await waitFor(() => expect(result.current.sheetStale).not.toBeNull(), { timeout: 5000 });
    expect(prefsReads()).toBeGreaterThanOrEqual(readsBefore + 2);
    expect(result.current.sheetKnown).toBe(true);
    // Never "the house sheet is shown … Arranging is off" over the reader's own.
    expect(result.current.sheetUnread).toBeNull();

    // "Try again": the write is sent, not refused on the spot.
    api.patch.mockResolvedValueOnce({ data: { preferences: {} } });
    await act(async () => {
      await expect(result.current.saveSheet(defaultSheet())).resolves.toBeUndefined();
    });
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(Object.keys(api.patch.mock.calls[1][1].preferences)).toEqual(['reportsSheet']);
  }, 10_000);

  it('still refuses to save when the very first read fails — nothing was ever answered', async () => {
    prefsRead.fail = true;
    const { result } = mount();
    await waitFor(() => expect(result.current.sheetUnread).not.toBeNull(), { timeout: 5000 });
    expect(result.current.sheetKnown).toBe(false);
    expect(result.current.sheetStale).toBeNull();
    await act(async () => {
      await expect(result.current.saveSheet(defaultSheet())).rejects.toThrow(/not known/);
    });
    expect(api.patch).not.toHaveBeenCalled();
  }, 10_000);
});
