/**
 * The ledger row states the unit its price is in — ADR 0119 phase 2.
 *
 * Phase 1 gave `procurement_order_items` a `(price_uom, price_pack_size)` pair
 * and taught `AgreementSheet` to ask for it. Nothing downstream could READ it:
 * `GET /procurement/orders` did not join the line, so every row on the rebuilt
 * `/orders` printed a figure that could equally have been a bottle price or a
 * case price twelve times its size. This file owns the half a person sees, and
 * each case is a way the row could lie about it:
 *
 *  1. the price ARRIVES at all. The route sends `finalPrice` / `totalCost`;
 *     the shared `Order` type calls them `unitPrice` / `totalPrice`, and the
 *     hook read only the shared names — so both figures were `undefined` for
 *     every live row and the ledger printed an em dash where the money goes.
 *     This case fails against the pre-fix hook.
 *  2. a stated case price is printed WITH its unit and its pack, and the total
 *     is worked out from that unit rather than per bottle. Sixty bottles at
 *     $420 per case of twelve is $2,100 — the pre-fix arithmetic
 *     (`quantity × price`) gave $2,100 by coincidence on this shape and
 *     $25,200 on the one below, which is the error this ADR exists to end.
 *  3. an UNSTATED pair prints the register's refusal beside the price, never a
 *     bare number that reads as though a unit had been stated.
 *  4. keys ABSENT from the payload is a THIRD state, not the second one: a row
 *     fed by a route that never read the line must say it does not know, not
 *     announce a refusal about a line nobody looked at.
 *  5. a price stated per keg on an order counted in bottles is REFUSED in
 *     words, because nothing on the order says how many kegs a bottle is.
 *
 * None of 2-5 render at all against the pre-fix `LedgerRow`, which had no
 * price-unit output of any kind.
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
import { ROW_PRICE_UNIT_NOT_READ, ROW_UNSTATED_PRICE_UNIT } from './price-unit';

const NO_PROVIDERS = new Map<string, string>();

/**
 * One row of `GET /procurement/orders` as `OrderResponseDto` actually
 * serialises it — `finalPrice`, `totalCost`, `bottlesTotal`, `unitType`, and
 * since this pass `priceUom` / `pricePackSize`. Deliberately NOT built from the
 * shared `Order` type: the whole defect was the two shapes disagreeing, so a
 * fixture that used the shared names would have passed against the bug.
 */
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
    ...over,
  } as never;
}

function mount(over: Record<string, unknown> = {}) {
  const row = toRow(wire(over), NO_PROVIDERS);
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
  return row;
}

describe('the ledger row reads the price the route actually sends', () => {
  it('1. reads finalPrice and totalCost, the keys OrderResponseDto uses', () => {
    const row = toRow(wire(), NO_PROVIDERS);
    // Pre-fix this read `o.unitPrice` / `o.totalPrice`, which the list route
    // has never sent: both were null and `total` was null with them.
    expect(row.unitPrice).toBe(420);
    expect(row.listedTotal).toBe(2100);
    expect(row.total).toBe(2100);
  });

  it('1b. still reads the shared names when a caller sends those instead', () => {
    const row = toRow(
      wire({ finalPrice: undefined, totalCost: undefined, unitPrice: 22, totalPrice: 110 }),
      NO_PROVIDERS,
    );
    expect(row.unitPrice).toBe(22);
    expect(row.listedTotal).toBe(110);
  });
});

describe('a stated price is printed with its unit', () => {
  it('2. prints "$420.00 per case (12 bottles)" and totals by the case', () => {
    const row = mount();
    expect(row.priceUnit).toEqual({
      read: true,
      stated: { priceUom: 'case', pricePackSize: 12 },
    });
    expect(screen.getByTestId('agreed-price').textContent).toContain(
      '$420.00 per case (12 bottles)',
    );
    // The working names the conversion, so the figure can be re-derived.
    expect(screen.getByTestId('row-working').textContent).toBe(
      '60 bottles ÷ 12 = 5 cases × $420.00.',
    );
    expect(row.computedTotal).toBe(2100);
    // NOT the per-bottle reading, which would be 60 × $420 = $25,200.
    expect(row.computedTotal).not.toBe(25200);
  });

  it('2b. a per-bottle price on a case order is ordinary, and said to be', () => {
    mount({ priceUom: 'bottle', pricePackSize: 1, finalPrice: 22, totalCost: 1320 });
    expect(screen.getByTestId('agreed-price').textContent).toContain('$22.00 per bottle');
    expect(screen.getByTestId('units-differ').textContent).toContain('that is ordinary');
  });
});

describe('an unstated unit is a refusal, not a default', () => {
  it('3. prints the register refusal beside the price, and NO working', () => {
    const row = mount({ priceUom: null, pricePackSize: null });
    expect(row.priceUnit).toEqual({ read: true, stated: null });
    /*
      The regression this case exists for. The first build totalled an unstated
      price on "the old per-bottle convention" and printed 60 x $420 =
      $25,200.00 in bold beside the ledger's own $2,100.00 — the twelve-times
      error ADR 0119 exists to end, reprinted by the screen built to end it.
      Caught in the first capture, not by a test; the test is the guard.
    */
    expect(row.agreement).toBeNull();
    expect(row.computedTotal).toBeNull();
    expect(screen.queryByTestId('row-working')).toBeNull();
    expect(screen.getByTestId('row-no-working').textContent).toContain(
      'nothing says what unit $420.00 is in',
    );
    // and no figure of the page's own invention anywhere in the row
    expect(document.body.textContent).not.toContain('25,200');
    // The price is still shown — the row does not hide the number, it refuses
    // to let the number stand as though a unit had been stated.
    expect(screen.getByTestId('agreed-price').textContent).toContain('$420.00');
    expect(screen.getByTestId('agreed-price').textContent).not.toContain('per');
    expect(screen.getByTestId('price-unit-unstated').textContent).toBe(
      ROW_UNSTATED_PRICE_UNIT,
    );
    expect(screen.queryByTestId('price-unit-unread')).toBeNull();
  });

  it('3b. half a pair is unstated, not half a claim', () => {
    const row = toRow(wire({ pricePackSize: null }), NO_PROVIDERS);
    expect(row.priceUnit).toEqual({ read: true, stated: null });
  });
});

describe('not knowing is a third state', () => {
  it('4. absent keys say so, and do not announce the register refusal', () => {
    const payload = wire();
    delete (payload as Record<string, unknown>).priceUom;
    delete (payload as Record<string, unknown>).pricePackSize;
    const row = toRow(payload, NO_PROVIDERS);
    expect(row.priceUnit).toEqual({ read: false, stated: null });

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
    expect(screen.getByTestId('price-unit-unread').textContent).toBe(ROW_PRICE_UNIT_NOT_READ);
    expect(screen.queryByTestId('price-unit-unstated')).toBeNull();
  });
});

describe('an uncountable pairing is refused in words', () => {
  it('5. a per-keg price on a bottle-counted order gives no total', () => {
    const row = mount({
      unitType: 'bottle',
      quantity: 60,
      bottlesTotal: 60,
      priceUom: 'keg',
      pricePackSize: 1,
    });
    expect(row.agreement?.ok).toBe(false);
    expect(row.computedTotal).toBeNull();
    // The gateway's own words, copied into `price-unit.ts` (a browser cannot
    // import a server module) — straight apostrophe, as that file has it.
    expect(screen.getByTestId('row-uncountable').textContent).toContain(
      "the order's value cannot be worked out",
    );
    // and the "that is ordinary" reassurance must NOT also appear.
    expect(screen.queryByTestId('units-differ')).toBeNull();
  });

  it('5b. no pack size means no working, stated as such rather than assumed', () => {
    const row = mount({ bottlesTotal: null });
    expect(row.agreement).toBeNull();
    expect(row.computedTotal).toBeNull();
    expect(screen.getByTestId('row-no-working').textContent).toContain(
      'the working needs the order’s pack size',
    );
  });
});
