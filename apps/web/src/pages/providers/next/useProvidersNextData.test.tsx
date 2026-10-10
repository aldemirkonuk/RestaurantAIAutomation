/**
 * The cards' "Open orders" are the gateway's per-vendor counts over the whole
 * book (F-905; which stages count as open is pinned on the gateway, in
 * open-orders-by-provider.spec.ts). Here: a vendor the counts leave out has
 * none open, and nothing is a number until the counts have answered.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const providersData = vi.hoisted(() => ({ current: [] as unknown[] }));
const ordersData = vi.hoisted(() => ({
  current: undefined as Record<string, number> | undefined,
}));

vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: providersData.current, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../hooks/queries/useOrderQueries', () => ({
  useOpenOrderCountsByProvider: () => ({ data: ordersData.current, refetch: vi.fn() }),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));

import { useProvidersNextData } from './useProvidersNextData';

const p = (id: string, name: string) => ({
  id,
  name,
  primaryBusinessType: 'Distributor',
  winePortfolio: '',
  phone: '',
  email: '',
  physicalAddress: '',
  website: '',
  restaurantId: 'r1',
});

describe('useProvidersNextData open-order counting', () => {
  it("reads each vendor's count from the gateway's answer, 0 when absent", () => {
    providersData.current = [p('a', 'Alpha'), p('b', 'Beta'), p('c', 'Gamma')];
    ordersData.current = { a: 4, c: 120 };
    const { result } = renderHook(() => useProvidersNextData());
    const byName = Object.fromEntries(result.current.cards.map((c) => [c.provider.name, c.openOrders]));
    expect(byName).toEqual({ Alpha: 4, Beta: 0, Gamma: 120 });
    // Open business first: the sort follows the whole-book count.
    expect(result.current.cards.map((c) => c.provider.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(result.current.ordersKnown).toBe(true);
  });

  it('keeps every count null while the orders book is unanswered', () => {
    providersData.current = [p('a', 'Alpha')];
    ordersData.current = undefined;
    const { result } = renderHook(() => useProvidersNextData());
    expect(result.current.cards[0].openOrders).toBeNull();
    expect(result.current.ordersKnown).toBe(false);
  });
});
