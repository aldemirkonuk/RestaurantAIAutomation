/** Every amount on /orders is in the ORDER's own currency; unknown prints bare, never `$` (ADR 0117). */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useOrders: () => ({ data: [], isLoading: false }),
}));

import { LedgerRow } from './LedgerRow';
import { fmtMoney, fmtMoneyWhole } from './format';
import { describeFees } from './price-unit';
import { sumInOneCurrency, toRow, type OrderRowVM } from './useOrdersNextData';

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

describe('a month in more than one currency is not added together', () => {
  const r = (total: number | null, currency: string | null) =>
    ({ total, currency }) as unknown as OrderRowVM;

  it('sums rows that share one currency and names it', () => {
    expect(sumInOneCurrency([r(100, 'TRY'), r(50, 'TRY'), r(null, 'EUR')])).toEqual({
      total: 150,
      currency: 'TRY',
      withheld: null,
    });
  });

  it('withholds the sum of a two-currency month, in words', () => {
    const s = sumInOneCurrency([r(100, 'TRY'), r(50, 'EUR')]);
    expect(s.total).toBeNull();
    expect(s.currency).toBeNull();
    expect(s.withheld).toMatch(/more than one currency/);
  });

  it('withholds the sum when a priced order names no currency', () => {
    const s = sumInOneCurrency([r(100, 'TRY'), r(50, null)]);
    expect(s.total).toBeNull();
    expect(s.withheld).toMatch(/name no currency/);
  });
});

describe('the month figure speaks the same money as the rows (r11)', () => {
  it('a lira month prints the lira sign, whole, never the code', () => {
    expect(fmtMoneyWhole(12480, 'TRY')).toBe('₺12,480');
    expect(fmtMoneyWhole(12480, 'TRY')).toBe(fmtMoney(12480, 'TRY').replace(/\.00$/, ''));
  });

  it('a money whose narrow sign is shared keeps its code; a dollar month keeps its dollar', () => {
    expect(fmtMoneyWhole(500, 'SEK')).toContain('SEK');
    expect(fmtMoneyWhole(500, 'USD')).toBe('$500');
  });

  it('a zero month with no currency is a plain 0, not a caveat about nothing', () => {
    expect(fmtMoneyWhole(0, null)).toBe('0');
    expect(sumInOneCurrency([])).toEqual({ total: 0, currency: null, withheld: null });
    expect(fmtMoneyWhole(sumInOneCurrency([]).total, null)).toBe('0');
  });

  it('a non-zero amount with no currency still carries its caveat, and an unknown is the dash', () => {
    expect(fmtMoneyWhole(600, null)).toBe('600 (currency not recorded)');
    expect(fmtMoneyWhole(null, 'TRY')).toBe('—');
  });
});
