/**
 * r27: an open order says its vendor was removed.
 *
 * The gateway (#1351) sends `vendorRemoved` on `GET /procurement/orders`. A
 * pending order of a removed vendor cannot be approved (#1339); an approved or
 * sent one stays open to letters a person writes. A delivered or cancelled
 * order shows nothing, and `null` or an absent key is "not known", never a
 * claim either way.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/services/api/orders', () => ({ mintOrderSeal: vi.fn(async () => 'seal') }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { LedgerRow } from './LedgerRow';
import { toRow } from './useOrdersNextData';

function wire(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'i-1',
    providerId: 'p-1',
    providerName: 'Vinifera Imports',
    quantity: 5,
    unitType: 'bottle',
    bottlesTotal: 5,
    finalPrice: 42,
    totalCost: 210,
    currency: 'TRY',
    status: 'PENDING',
    requestedAt: '2026-11-01T10:00:00Z',
    wineName: 'Barolo Riserva',
    ...over,
  } as never;
}

function mount(over: Record<string, unknown> = {}) {
  render(
    <LedgerRow
      row={toRow(wire(over), new Map())}
      expanded={false}
      onToggle={() => {}}
      selected={false}
      onSelectChange={() => {}}
      bulkRunning={false}
    />,
  );
  return screen.queryByTestId('row-vendor-removed')?.textContent ?? null;
}

describe('an open order says its vendor was removed', () => {
  it('a pending order says it cannot be approved', () => {
    expect(mount({ vendorRemoved: true, status: 'PENDING' })).toBe(
      'Vendor removed. This order cannot be approved; place it with another vendor.',
    );
  });

  it.each(['APPROVED', 'IN_TRANSIT'])('a %s order says only automatic sends stop', (status) => {
    expect(mount({ vendorRemoved: true, status })).toBe(
      'Vendor removed. Nothing more goes to them automatically; you can still write to them about this order.',
    );
  });

  it.each(['DELIVERED', 'CANCELLED'])('a %s order says nothing', (status) => {
    expect(mount({ vendorRemoved: true, status })).toBeNull();
  });

  it.each([
    ['a live vendor', false],
    ['no vendor row (null)', null],
    ['an older gateway (key absent)', undefined],
  ])('%s says nothing', (_label, vendorRemoved) => {
    const over: Record<string, unknown> = {};
    if (vendorRemoved !== undefined) over.vendorRemoved = vendorRemoved;
    expect(mount(over)).toBeNull();
  });
});
