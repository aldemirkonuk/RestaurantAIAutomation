/**
 * r83 errors-rest, PR B (orders, receiving, connections, shared hooks): each
 * site used to print axios's "Network Error" as the reason. A call that got no
 * answer now says the unreachable words; an answered failure keeps its own.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { UNREACHABLE_WORDS } from './unreachable';

const noAnswer = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const answered = Object.assign(new Error('Network Error'), {
  code: 'ERR_NETWORK',
  response: { status: 502 },
});

const m = vi.hoisted(() => ({
  get: vi.fn(),
  q: { current: {} as Record<string, unknown> },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', user: { restaurantId: 'r1' } }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: { get: m.get }, getErrorMessage: () => '' }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({ useOrders: () => m.q.current }));
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: undefined, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../hooks/queries/useInventoryQueries', () => ({
  useInventory: () => m.q.current,
  useInventorySummary: () => ({ ...m.q.current, data: undefined }),
  useLowStockItems: () => ({ ...m.q.current, data: undefined }),
  useUpdateInventoryItem: () => ({ mutateAsync: vi.fn() }),
}));

import { readError } from '../pages/connections/next/cx-format';
import { failureOf, useManagerQueue } from '../pages/receiving/next/useReceivingNextData';
import { useOrdersNextData } from '../pages/orders/next/useOrdersNextData';
import { useInventoryData } from '../hooks/useInventoryData';

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe('connections', () => {
  it('readError says the unreachable words and keeps an answered failure', () => {
    expect(readError(noAnswer)).toBe(UNREACHABLE_WORDS);
    expect(readError(answered)).toBe('Network Error');
  });
});

describe('receiving', () => {
  it('failureOf says the unreachable words, and the gateway sentence still wins', () => {
    expect(failureOf(true, noAnswer)?.message).toBe(UNREACHABLE_WORDS);
    expect(failureOf(true, answered)?.message).toBe('Network Error');
    expect(
      failureOf(true, { ...answered, response: { status: 400, data: { message: 'bad' } } })?.message,
    ).toBe('bad');
  });

  it('manager queue hook: errorMessage is the unreachable words', async () => {
    m.get.mockRejectedValue(noAnswer);
    const { result } = renderHook(() => useManagerQueue(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.errorMessage).toBe(UNREACHABLE_WORDS);
  });
});

describe('orders', () => {
  it('orders hook: errorMessage is the unreachable words', () => {
    m.q.current = { data: undefined, isError: true, error: noAnswer, refetch: vi.fn() };
    const { result } = renderHook(() => useOrdersNextData(), { wrapper: wrap });
    expect(result.current.errorMessage).toBe(UNREACHABLE_WORDS);
  });
});

describe('shared hooks', () => {
  it('useInventoryData: all three error strings say the unreachable words', () => {
    m.q.current = { data: undefined, isError: true, error: noAnswer, refetch: vi.fn() };
    const { result } = renderHook(() => useInventoryData());
    expect(result.current.error).toBe(UNREACHABLE_WORDS);
    expect(result.current.summaryError).toBe(UNREACHABLE_WORDS);
    expect(result.current.lowStockError).toBe(UNREACHABLE_WORDS);
  });
});
