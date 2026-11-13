/**
 * /orders says a unit in words, never in the database's spelling.
 *
 * `procurement_orders.unit_type` and `procurement_order_items.price_uom` store
 * `split_case`, `each` and `liter`. Six sentences printed that code as it came
 * (2026-11-13 audit, r21): "counted in split_cases", "$4.00 per each",
 * "per liter" beside rows that elsewhere say "litre", "= 3 split_cases ×", the
 * picker's "per each", and the sheet's "Bottles in one split case" only by a
 * one-underscore `replace`. Each case below is one of those sentences.
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
import {
  PRICE_UOMS,
  PRICE_UOM_LABEL,
  agreementTotal,
  describeStatedPrice,
  halfStatedRefusal,
  uomMany,
  uomOne,
} from './price-unit';

const CODE = /split_case|\beach(s)?\b|\bliters?\b/;

function wire(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'i-1',
    providerId: 'p-1',
    quantity: 3,
    unitType: 'split_case',
    bottlesTotal: 18,
    finalPrice: 22,
    totalCost: 396,
    currency: 'TRY',
    status: 'PENDING',
    requestedAt: '2026-09-01T10:00:00Z',
    wineName: 'Kalecik Karası',
    priceUom: 'bottle',
    pricePackSize: 1,
    ...over,
  } as never;
}

describe('the ledger row says the unit it is counted in, in words', () => {
  it('"counted in split cases", never "split_cases"', () => {
    const row = toRow(wire(), new Map());
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
    const said = screen.getByTestId('units-differ').textContent ?? '';
    expect(said).toContain('counted in split cases, priced per bottle');
    expect(said).not.toMatch(CODE);
  });

  it('"counted in items" and "counted in litres"', () => {
    expect(uomMany('each')).toBe('items');
    expect(uomMany('liter')).toBe('litres');
  });
});

describe('a stated price names its unit as a word', () => {
  it('per item, per litre, per split case', () => {
    expect(describeStatedPrice(4, { priceUom: 'each', pricePackSize: 1 })).toBe('4.00 per item');
    expect(describeStatedPrice(9.5, { priceUom: 'liter', pricePackSize: 1 })).toBe('9.50 per litre');
    expect(describeStatedPrice(120, { priceUom: 'split_case', pricePackSize: 6 })).toBe(
      '120.00 per split case (6 bottles)',
    );
  });

  it('the picker offers no code word', () => {
    for (const u of PRICE_UOMS) expect(PRICE_UOM_LABEL[u]).not.toMatch(CODE);
    expect(PRICE_UOM_LABEL.each).toBe('per item');
  });
});

describe('the working says its units in words', () => {
  it('"= 3 split cases ×", not "= 3 split_cases ×"', () => {
    const t = agreementTotal({
      price: 120,
      stated: { priceUom: 'split_case', pricePackSize: 6 },
      quantity: 3,
      unitType: 'split_case',
      bottlesPerUnit: 6,
    });
    expect(t && t.ok && t.working).toBe('18 bottles ÷ 6 = 3 split cases × 120.00.');
  });

  it('one split case is singular', () => {
    const t = agreementTotal({
      price: 120,
      stated: { priceUom: 'split_case', pricePackSize: 6 },
      quantity: 1,
      unitType: 'split_case',
      bottlesPerUnit: 6,
    });
    expect(t && t.ok && t.working).toBe('6 bottles ÷ 6 = 1 split case × 120.00.');
  });

  it('a keg priced per litre is refused in words', () => {
    const t = agreementTotal({
      price: 9.5,
      stated: { priceUom: 'liter', pricePackSize: 1 },
      quantity: 2,
      unitType: 'keg',
      bottlesPerUnit: null,
    });
    expect(t && !t.ok && t.message).toBe(
      "This order is placed in kegs and the price is stated per litre. Nothing says how many litres a keg is, so the order's value cannot be worked out.",
    );
  });

  it('split cases priced per litre are refused in words', () => {
    const t = agreementTotal({
      price: 9.5,
      stated: { priceUom: 'liter', pricePackSize: 1 },
      quantity: 2,
      unitType: 'split_case',
      bottlesPerUnit: 6,
    });
    expect(t && !t.ok && t.message).toBe(
      "This order is placed in split cases and the price is stated per litre. Nothing says how many litres a split case is, so the order's value cannot be worked out.",
    );
  });

  it('an opaque unit priced in itself says "per litre"', () => {
    const t = agreementTotal({
      price: 9.5,
      stated: { priceUom: 'liter', pricePackSize: 1 },
      quantity: 20,
      unitType: 'liter',
      bottlesPerUnit: null,
    });
    expect(t && t.ok && t.working).toBe('20 × 9.50 per litre.');
  });

  it('the half-statement refusal names the unit in words', () => {
    expect(halfStatedRefusal('split_case')).toContain('"per split case"');
    expect(uomOne('split_case')).toBe('split case');
  });
});
