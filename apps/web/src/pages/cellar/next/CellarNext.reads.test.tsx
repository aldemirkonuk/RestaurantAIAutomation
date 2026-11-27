/**
 * What the cellar page reads on a cold load (p9-3).
 *
 * /cocktails draws neither the wine book nor the inventory overlay, so it must
 * not ask for them (GET /wines 318 KB, GET /inventory/<house> 745 KB measured).
 * Every other register still reads both. This goes through the real client
 * contract (`apiClient`) and the real `useInventory`, so a regression fails on
 * the request, not on a rendered string.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));
vi.mock('../../../contexts/RealtimeContext', () => ({
  useInventorySubscription: () => {},
  useWineSubscription: () => {},
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [], isError: false, error: null }),
}));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => api.get(...args) },
}));

import { useCellarNextData } from './useCellarNextData';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const paths = () => api.get.mock.calls.map(([p]) => String(p));
const reads = (re: RegExp) => paths().filter((p) => re.test(p));

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path === '/wines') return { data: [] };
    if (path.startsWith('/inventory/')) return { data: [] };
    throw new Error('not read in this test');
  });
});

describe('useCellarNextData — which register is open decides what it reads', () => {
  it('the cocktails register makes no /wines and no /inventory request', async () => {
    const { result } = renderHook(() => useCellarNextData('cocktails'), { wrapper });
    // The page's own reads (the registers readout) did go out, so the wait is
    // over a real settle and not an idle hook.
    await waitFor(() => expect(paths().some((p) => p.includes('/registers'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(reads(/^\/wines/)).toEqual([]);
    expect(reads(/^\/inventory/)).toEqual([]);
    // Unread stays unread (null), never an empty book that prints zeros.
    expect(result.current.bottles).toBeNull();
    expect(result.current.booking).toBe(false);
  });

  it.each([['wines' as const], ['beer' as const], [null]])(
    'the %s view still reads the book and the inventory',
    async (open) => {
      const { result } = renderHook(() => useCellarNextData(open), { wrapper });
      await waitFor(() => expect(result.current.bottles).not.toBeNull());
      await waitFor(() => expect(result.current.cellarKnown).toBe(true));
      expect(reads(/^\/wines/)).toHaveLength(1);
      expect(reads(/^\/inventory\/r1/)).toHaveLength(1);
    },
  );
});
