/**
 * Regression for the providers-audit BLOCKER: the gateway speaks
 * SCREAMING_SNAKE ProcurementOrderStatus (CONFIRMED, IN_TRANSIT,
 * APPROVAL_NEEDED, …) and a raw lowercase match silently dropped every one of
 * them — a vendor with live in-flight orders showed a confident 0. Open
 * counting must go through canonicalStatus.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const providersData = vi.hoisted(() => ({ current: [] as unknown[] }));
const ordersData = vi.hoisted(() => ({ current: undefined as unknown[] | undefined }));

vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: providersData.current, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../../hooks/queries/useOrderQueries', () => ({
  useOrders: () => ({ data: ordersData.current, refetch: vi.fn() }),
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
  it("counts the gateway's SCREAMING_SNAKE in-flight statuses as open", () => {
    providersData.current = [p('a', 'Alpha'), p('b', 'Beta')];
    ordersData.current = [
      { providerId: 'a', status: 'CONFIRMED' },
      { providerId: 'a', status: 'IN_TRANSIT' },
      { providerId: 'a', status: 'APPROVAL_NEEDED' },
      { providerId: 'a', status: 'pending' },
      { providerId: 'a', status: 'DELIVERED' }, // closed — not open
      { providerId: 'b', status: 'CANCELLED' }, // closed — not open
    ];
    const { result } = renderHook(() => useProvidersNextData());
    const byName = Object.fromEntries(result.current.cards.map((c) => [c.provider.name, c.openOrders]));
    expect(byName.Alpha).toBe(4);
    expect(byName.Beta).toBe(0);
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
