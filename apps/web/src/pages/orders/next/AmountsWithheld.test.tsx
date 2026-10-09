/**
 * F-441 (sim wave 21 residual, 2026-10-09): staff read every order's money
 * from `GET /procurement/orders` and `/orders/:id`. The gateway now leaves the
 * figures out for staff and says `amountsWithheld: true` at the list's root.
 * This file owns the page's half: a staff reader sees NO money — not a "$0"
 * month, not a "$0.00 known", and not a sentence about a price unit nobody
 * sent.
 *
 *  1. `getOrders` carries the root marker onto every row it hands back.
 *  2. the month figure on a staff list is null, not the $0 a sum of nothing
 *     gives (the hook summed withheld totals as zeroes).
 *  3. a withheld ledger row prints no amount and no "not stated" sentence.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const get = vi.fn();
vi.mock('@/services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
  getActiveRestaurantId: () => 'r-1',
  getErrorMessage: (e: unknown) => String(e),
}));

const ordersData: { current: unknown[] } = { current: [] };
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useOrders: () => ({
    data: ordersData.current,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    dataUpdatedAt: 1,
  }),
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [] }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r-1', user: { restaurantId: 'r-1' } }),
}));

import { getOrders } from '@/services/api/orders';
import { LedgerRow } from './LedgerRow';
import { toRow, useOrdersNextData } from './useOrdersNextData';
import { AMOUNTS_WITHHELD } from './format';
import { ROW_FEES_NOT_READ, ROW_PRICE_UNIT_NOT_READ } from './price-unit';

/** One order as the gateway sends it to staff: no price, total, unit or fee. */
const STAFF_ROW = {
  id: 'o-1',
  orderNumber: 'ORD-2026-00042',
  restaurantId: 'r-1',
  inventoryId: 'i-1',
  providerId: 'p-1',
  quantity: 5,
  unitType: 'case',
  bottlesTotal: 60,
  status: 'PENDING',
  requestedAt: new Date().toISOString(),
  wineName: 'Barolo Riserva',
  currency: 'USD',
};

beforeEach(() => {
  get.mockReset();
});

describe('F-441 — getOrders carries the root marker onto each row', () => {
  it('stamps every row when the list says amounts are withheld', async () => {
    get.mockResolvedValue({
      data: { orders: [{ ...STAFF_ROW }], total: 1, amountsWithheld: true },
    });
    const rows = await getOrders(undefined, 'r-1');
    expect(rows[0].amountsWithheld).toBe(true);
  });

  it('leaves an owner’s rows alone', async () => {
    get.mockResolvedValue({
      data: { orders: [{ ...STAFF_ROW, totalCost: 2100 }], total: 1 },
    });
    const rows = await getOrders(undefined, 'r-1');
    expect(rows[0]).not.toHaveProperty('amountsWithheld');
  });
});

describe('F-441 — the month figure on a staff list is not $0', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );

  it('stays null and says the amounts are withheld', () => {
    get.mockResolvedValue({ data: { readable: false, reason: 'n/a', orders: [] } });
    ordersData.current = [{ ...STAFF_ROW, amountsWithheld: true }];
    const { result } = renderHook(() => useOrdersNextData(), { wrapper });
    expect(result.current.amountsWithheld).toBe(true);
    expect(result.current.month.thisMonth).toBeNull();
    expect(result.current.month.lastMonth).toBeNull();
    expect(result.current.month.unpricedThisMonth).toBe(0);
  });

  it('still sums an owner’s month', () => {
    get.mockResolvedValue({ data: { readable: false, reason: 'n/a', orders: [] } });
    ordersData.current = [{ ...STAFF_ROW, totalCost: 2100 }];
    const { result } = renderHook(() => useOrdersNextData(), { wrapper });
    expect(result.current.amountsWithheld).toBe(false);
    expect(result.current.month.thisMonth).toBe(2100);
  });
});

describe('F-441 — a withheld ledger row prints no money', () => {
  it('shows the order and the one sentence, and no figure or unit refusal', () => {
    const row = toRow({ ...STAFF_ROW, amountsWithheld: true } as never, new Map());
    expect(row.amountsWithheld).toBe(true);
    const { container } = render(
      <LedgerRow
        row={row}
        expanded
        onToggle={() => {}}
        selected={false}
        onSelectChange={() => {}}
        bulkRunning={false}
      />,
    );
    expect(screen.getByTestId('amounts-withheld').textContent).toContain(AMOUNTS_WITHHELD);
    expect(container.textContent).not.toMatch(/\$/);
    expect(container.textContent).not.toContain(ROW_PRICE_UNIT_NOT_READ);
    expect(container.textContent).not.toContain(ROW_FEES_NOT_READ);
    expect(screen.queryByTestId('agreed-price')).toBeNull();
  });
});
