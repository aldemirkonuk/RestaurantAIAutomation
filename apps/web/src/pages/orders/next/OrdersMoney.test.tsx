/** Every amount on /orders is in the ORDER's own currency; unknown prints bare, never `$` (ADR 0117). */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useOrders: () => ({ data: [], isLoading: false }),
}));

import { LedgerRow } from './LedgerRow';
import { fmtMoney } from './format';
import { describeFees } from './price-unit';
import { toRow, type OrderRowVM } from './useOrdersNextData';

const NO_PROVIDERS = new Map<string, string>();

function wire(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'i-1',
    providerId: 'p-1',
    quantity: 5,
    unitType: 'case',
    bottlesTotal: 60,
    finalPrice: 420,
    totalCost: 2100,
    status: 'PENDING',
    requestedAt: '2026-09-01T10:00:00Z',
    wineName: 'Barolo Riserva',
    priceUom: 'case',
    pricePackSize: 12,
    allowance: null,
    deposit: 30,
    freight: null,
    ...over,
  } as never;
}

function mount(row: OrderRowVM) {
  render(
    <LedgerRow
      row={row}
      expanded
      onToggle={() => {}}
      selected={false}
      onSelectChange={() => {}}
      bulkRunning={false}
    />,
  );
}

describe('the order row speaks the order’s own money', () => {
  it('a TRY order prints the lira sign everywhere and no dollar sign', () => {
    const row = toRow(wire({ currency: 'TRY' }), NO_PROVIDERS);
    expect(row.currency).toBe('TRY');
    mount(row);
    const text = document.body.textContent ?? '';
    expect(text).toContain('₺');
    expect(text).not.toContain('$');
  });

  it('the working sentence of a TRY agreement carries the lira sign and no dollar sign', () => {
    const row = toRow(wire({ currency: 'TRY' }), NO_PROVIDERS);
    expect(row.agreement && row.agreement.ok).toBe(true);
    const working = row.agreement && row.agreement.ok ? row.agreement.working : '';
    expect(working).toContain('₺420.00');
    expect(working).toContain('Goods ₺2,100.00');
    expect(working).toContain('plus deposit ₺30.00');
    expect(working).not.toContain('$');
  });

  it('a row that names no currency prints bare with the caveat, never a dollar sign', () => {
    const row = toRow(wire({ currency: null }), NO_PROVIDERS);
    expect(row.currency).toBeNull();
    mount(row);
    const text = document.body.textContent ?? '';
    expect(text).toContain('currency not recorded');
    expect(text).not.toContain('$');
  });

  it('a route that did not read currency (key absent) is treated as not recorded', () => {
    const row = toRow(wire(), NO_PROVIDERS);
    expect(row.currency).toBeNull();
    expect(fmtMoney(row.total, row.currency)).not.toContain('$');
    expect(row.agreement && row.agreement.ok ? row.agreement.working : '').not.toContain('$');
  });

  it('describeFees takes the order’s money, and defaults to the bare figure', () => {
    const fees = { allowance: 25, deposit: null, freight: null };
    expect(describeFees(fees, (n) => fmtMoney(n, 'TRY'))).toBe('an allowance of ₺25.00');
    expect(describeFees(fees)).toBe('an allowance of 25.00');
  });

});
