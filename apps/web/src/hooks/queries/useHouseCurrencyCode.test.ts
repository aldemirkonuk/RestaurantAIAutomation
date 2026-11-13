import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ activeRestaurantId: 'r1' as string | null }));
const read = vi.hoisted(() => vi.fn());

vi.mock('../../stores', () => ({ useAuthStore: (pick: (s: typeof auth) => unknown) => pick(auth) }));
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: read } }));

import { useHouseCurrencyCode } from './useHouseCurrencyCode';

const wrap = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: qc }, children);
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useHouseCurrencyCode', () => {
  beforeEach(() => {
    read.mockReset();
    auth.activeRestaurantId = 'r1';
  });

  it('gives the house code once read', async () => {
    read.mockResolvedValue({ restaurantId: 'r1', code: 'TRY', country: 'TR', readable: true, reason: null, statedAt: null });
    const { result } = renderHook(() => useHouseCurrencyCode(), { wrapper: wrap(fresh()) });
    await waitFor(() => expect(result.current).toBe('TRY'));
  });

  it('gives null for a failed read, never a stale or guessed code', async () => {
    read.mockResolvedValue({ restaurantId: 'r1', code: 'TRY', country: 'TR', readable: false, reason: 'down', statedAt: null });
    const qc = fresh();
    const { result, rerender } = renderHook(() => useHouseCurrencyCode(), { wrapper: wrap(qc) });
    await waitFor(() => expect(qc.getQueryState(['settings', 'currency', 'r1'])?.status).toBe('success'));
    rerender();
    expect(result.current).toBeNull();
  });

  it('keys the read by the house, so one house never writes in another house money', async () => {
    const qc = fresh();
    qc.setQueryData(['settings', 'currency', 'r2'], { restaurantId: 'r2', code: 'GBP', country: 'GB', readable: true, reason: null, statedAt: null });
    read.mockResolvedValue({ restaurantId: 'r1', code: 'TRY', country: 'TR', readable: true, reason: null, statedAt: null });
    const { result } = renderHook(() => useHouseCurrencyCode(), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current).toBe('TRY'));
  });

  it('asks nothing while no house is chosen', async () => {
    auth.activeRestaurantId = null;
    const { result } = renderHook(() => useHouseCurrencyCode(), { wrapper: wrap(fresh()) });
    expect(result.current).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
