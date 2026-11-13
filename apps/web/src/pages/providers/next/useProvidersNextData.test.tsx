/**
 * /vendors' open-order count per card comes from the gateway's whole-book
 * count, never from the newest 50 orders (r21, 2026-11-13).
 *
 * The earlier regression in this file (SCREAMING_SNAKE statuses dropped by a
 * lowercase match) now lives where the counting does: the gateway's
 * `OPEN_ORDER_STATUSES`, pinned by `open-orders-by-vendor.spec.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const providersData = vi.hoisted(() => ({ current: [] as unknown[] }));
const counts = vi.hoisted(() => ({
  current: { data: undefined as unknown, isError: false },
}));

vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: providersData.current, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../hooks/queries/useOpenOrdersByVendor', () => ({
  useOpenOrdersByVendor: () => ({ ...counts.current, refetch: vi.fn() }),
}));
// The newest-50 read must not feed the cards any more.
vi.mock('../../../hooks/queries/useOrderQueries', () => ({
  useOrders: () => {
    throw new Error('/vendors must not count from the newest 50 orders');
  },
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
  it("prints the gateway's whole-book count; a vendor it does not name has none", () => {
    providersData.current = [p('a', 'Alpha'), p('b', 'Beta'), p('q', 'Quiet')];
    // Quiet's three orders are older than the newest fifty: the old card read 0.
    counts.current = { data: { byVendor: { a: 57, q: 3 }, total: 60 }, isError: false };
    const { result } = renderHook(() => useProvidersNextData());
    const byName = Object.fromEntries(result.current.cards.map((c) => [c.provider.name, c.openOrders]));
    expect(byName).toEqual({ Alpha: 57, Quiet: 3, Beta: 0 });
    expect(result.current.cards.map((c) => c.provider.name)).toEqual(['Alpha', 'Quiet', 'Beta']);
    expect(result.current.ordersKnown).toBe(true);
    expect(result.current.ordersFailed).toBe(false);
  });

  it('keeps every count null while the count is unanswered', () => {
    providersData.current = [p('a', 'Alpha')];
    counts.current = { data: undefined, isError: false };
    const { result } = renderHook(() => useProvidersNextData());
    expect(result.current.cards[0].openOrders).toBeNull();
    expect(result.current.ordersKnown).toBe(false);
    expect(result.current.ordersFailed).toBe(false);
  });

  it('a refused count is null and said to have failed, never 0', () => {
    providersData.current = [p('a', 'Alpha')];
    counts.current = { data: undefined, isError: true };
    const { result } = renderHook(() => useProvidersNextData());
    expect(result.current.cards[0].openOrders).toBeNull();
    expect(result.current.ordersKnown).toBe(false);
    expect(result.current.ordersFailed).toBe(true);
  });
});
