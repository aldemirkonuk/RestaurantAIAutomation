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
import { render, screen, within } from '@testing-library/react';

vi.mock('@/services/api/orders', () => ({ mintOrderSeal: vi.fn(async () => 'seal') }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { LedgerRow } from './LedgerRow';
import { BulkApproveBar } from './BulkApproveBar';
import { monthFigure, toRow } from './useOrdersNextData';
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
    // The order's own money (PROCURE-01). Euros, deliberately not dollars: a
    // "$" anywhere in these rows is now the defect, not the default. The
    // PROCURE-01 block below varies it.
    currency: 'EUR',
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

  it('1b. reads NOTHING from the names the route does not send', () => {
    // The `?? o.unitPrice` / `?? o.totalPrice` fallbacks are gone with the keys
    // themselves (2026-09-05): the shared `Order` type is now exactly
    // `OrderResponseDto`, so those two names cannot reach this hook from any
    // route, and a payload carrying them is not an order this app can price.
    // Nulls here, never the 22 and the 110 — a figure under a name the server
    // never uses is a figure from somewhere nobody can name.
    const row = toRow(
      wire({ finalPrice: undefined, totalCost: undefined, unitPrice: 22, totalPrice: 110 }),
      NO_PROVIDERS,
    );
    expect(row.unitPrice).toBeNull();
    expect(row.listedTotal).toBeNull();
  });
});

describe('a stated price is printed with its unit', () => {
  it('2. prints "€420.00 per case (12 bottles)" and totals by the case', () => {
    const row = mount();
    expect(row.priceUnit).toEqual({
      read: true,
      stated: { priceUom: 'case', pricePackSize: 12 },
    });
    expect(screen.getByTestId('agreed-price').textContent).toContain(
      '€420.00 per case (12 bottles)',
    );
    // The working names the conversion, so the figure can be re-derived.
    expect(screen.getByTestId('row-working').textContent).toBe(
      '60 bottles ÷ 12 = 5 cases × €420.00.',
    );
    expect(row.computedTotal).toBe(2100);
    // NOT the per-bottle reading, which would be 60 × $420 = $25,200.
    expect(row.computedTotal).not.toBe(25200);
  });

  it('2b. a per-bottle price on a case order is ordinary, and said to be', () => {
    mount({ priceUom: 'bottle', pricePackSize: 1, finalPrice: 22, totalCost: 1320 });
    expect(screen.getByTestId('agreed-price').textContent).toContain('€22.00 per bottle');
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
      'nothing says what unit €420.00 is in',
    );
    // and no figure of the page's own invention anywhere in the row
    expect(document.body.textContent).not.toContain('25,200');
    // The price is still shown — the row does not hide the number, it refuses
    // to let the number stand as though a unit had been stated.
    expect(screen.getByTestId('agreed-price').textContent).toContain('€420.00');
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

/*
 * ORD-W4, 2026-10-01. The list route joins `providers` and sends the vendor's
 * name; a vendor with no house id is absent from the house's providers list,
 * so reading the list alone printed an em dash for a vendor the order names.
 */
describe('the ledger row names the vendor the route sends', () => {
  it('prefers the route’s providerName over the house’s providers list', () => {
    const row = toRow(wire({ providerName: 'Aldemir Distribution' }), NO_PROVIDERS);
    expect(row.providerName).toBe('Aldemir Distribution');
  });

  it('falls back to the providers list when the route did not join', () => {
    const row = toRow(wire(), new Map([['p-1', 'Listed Vendor']]));
    expect(row.providerName).toBe('Listed Vendor');
  });

  it('a blank or null name from the route is not a name', () => {
    expect(toRow(wire({ providerName: '  ' }), NO_PROVIDERS).providerName).toBeNull();
    expect(toRow(wire({ providerName: null }), new Map([['p-1', 'Listed Vendor']])).providerName).toBe(
      'Listed Vendor',
    );
  });
});

describe('a count is said in words (ORD-W17)', () => {
  it('says "5 cases", never "case(s)"', () => {
    mount({ priceUom: null, pricePackSize: null });
    const said = screen.getByTestId('row-no-working').textContent ?? '';
    expect(said).toContain('5 cases —');
    expect(said).not.toContain('(s)');
  });

  it('says one of a unit in the singular, and a split case as two words', () => {
    mount({ priceUom: null, pricePackSize: null, quantity: 1, unitType: 'split_case' });
    expect(screen.getByTestId('row-no-working').textContent).toContain('1 split case —');
  });
});

/*
 * PROCURE-01, 2026-10-07. Every figure on /orders was formatted as US dollars
 * (an en-US Intl formatter pinned to the dollar), and the month figure and
 * the bulk-approve total added lira, euros and dollars into one "$" sum. The
 * gateway had sent each order's `currency` all along (`mapOrderRow`). Nothing
 * converts and nothing sums across currencies (ADR 0117 rule 3).
 */
/** Intl puts a no-break space between a code and its figure ("TRY\u00a0420.00"). */
const flat = (t: string | null | undefined) => (t ?? '').replace(/\u00a0/g, ' ');

describe('each order is printed in its own currency (PROCURE-01)', () => {
  it('reads the currency in its three states, and never defaults it', () => {
    expect(toRow(wire({ currency: 'TRY' }), NO_PROVIDERS).currency).toBe('TRY');
    expect(toRow(wire({ currency: ' eur ' }), NO_PROVIDERS).currency).toBe('EUR');
    // read, names none: null — not USD
    expect(toRow(wire({ currency: null }), NO_PROVIDERS).currency).toBeNull();
    // not a currency code: read as naming none, not as money
    expect(toRow(wire({ currency: 'lira' }), NO_PROVIDERS).currency).toBeNull();
    // never read: absent, a third state
    const payload = wire();
    delete (payload as Record<string, unknown>).currency;
    expect(toRow(payload, NO_PROVIDERS).currency).toBeUndefined();
  });

  it('prints a lira order in lira, with no dollar sign anywhere in the row', () => {
    mount({ currency: 'TRY' });
    const body = flat(document.body.textContent);
    expect(flat(screen.getByTestId('agreed-price').textContent)).toContain('TRY 420.00 per case');
    expect(flat(screen.getByTestId('row-working').textContent)).toBe(
      '60 bottles ÷ 12 = 5 cases × TRY 420.00.',
    );
    expect(body).toContain('TRY 2,100.00');
    expect(body).not.toContain('$');
    // EVERY figure in the row has the order's currency — the row total, the
    // agreement total and the approval hold — so none says it was not read.
    expect(body).not.toContain('currency not');
    expect(flat(screen.getByTestId('row-working').nextSibling?.nextSibling?.textContent)).toBe(
      'TRY 2,100.00',
    );
    expect(
      flat(screen.getByRole('button', { name: /^Hold to approve · / }).getAttribute('aria-label')),
    ).toBe('Hold to approve · TRY 2,100.00');
  });

  it('says what the ledger lists in the order’s currency when the two disagree', () => {
    mount({ currency: 'TRY', totalCost: 2178 });
    expect(flat(document.body.textContent)).toContain(
      'the ledger lists TRY 2,178.00 — the two disagree',
    );
  });

  it('prints a yen order in yen, in its own decimal places', () => {
    mount({ currency: 'JPY' });
    expect(screen.getByTestId('agreed-price').textContent).toContain('¥420 per case');
    expect(screen.getByTestId('row-working').textContent).toBe('60 bottles ÷ 12 = 5 cases × ¥420.');
    expect(document.body.textContent).not.toContain('$');
  });

  it('says "currency not recorded" for an order that names none — never USD', () => {
    mount({ currency: null });
    const body = document.body.textContent ?? '';
    expect(body).toContain('2,100.00 (currency not recorded)');
    expect(body).not.toContain('$');
  });

  it('says "currency not read" when the route never sent the key', () => {
    const payload = wire();
    delete (payload as Record<string, unknown>).currency;
    render(
      <LedgerRow
        row={toRow(payload, NO_PROVIDERS)}
        expanded
        onToggle={() => {}}
        selected={false}
        onSelectChange={() => {}}
        bulkRunning={false}
      />,
    );
    const body = document.body.textContent ?? '';
    expect(body).toContain('2,100.00 (currency not read)');
    expect(body).not.toContain('$');
    expect(body).not.toContain('not recorded');
  });

  it('groups the month figure per currency, never one sum across them', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const rows = [
      toRow(wire({ id: 'a', currency: 'TRY', totalCost: 1200, requestedAt: '2026-10-02T10:00:00Z' }), NO_PROVIDERS),
      toRow(wire({ id: 'b', currency: 'TRY', totalCost: 300, requestedAt: '2026-10-03T10:00:00Z' }), NO_PROVIDERS),
      toRow(wire({ id: 'c', currency: 'EUR', totalCost: 1500, requestedAt: '2026-10-04T10:00:00Z' }), NO_PROVIDERS),
      toRow(wire({ id: 'd', currency: null, totalCost: 80, requestedAt: '2026-10-05T10:00:00Z' }), NO_PROVIDERS),
      toRow(wire({ id: 'e', currency: 'GBP', totalCost: 900, requestedAt: '2026-09-05T10:00:00Z' }), NO_PROVIDERS),
      // unpriced this month: counted, not zeroed
      toRow(
        wire({ id: 'f', currency: 'TRY', totalCost: null, finalPrice: null, requestedAt: '2026-10-06T10:00:00Z' }),
        NO_PROVIDERS,
      ),
      // cancelled: excluded
      toRow(wire({ id: 'g', currency: 'TRY', totalCost: 5000, status: 'CANCELLED', requestedAt: '2026-10-07T10:00:00Z' }), NO_PROVIDERS),
    ];
    const m = monthFigure(rows, now);
    expect(m.thisMonth).toEqual([
      { currency: 'EUR', amount: 1500 },
      { currency: 'TRY', amount: 1500 },
      { currency: null, amount: 80 },
    ]);
    expect(m.lastMonth).toEqual([{ currency: 'GBP', amount: 900 }]);
    expect(m.unpricedThisMonth).toBe(1);
    // the old cross-currency sum, 1200 + 300 + 1500 + 80, is nowhere
    expect(JSON.stringify(m)).not.toContain('3080');
  });

  it('the bulk-approve bar states each currency on its own line, never their sum', () => {
    const rows = [
      toRow(wire({ id: 'a', currency: 'TRY', totalCost: 1200 }), NO_PROVIDERS),
      toRow(wire({ id: 'b', currency: 'EUR', totalCost: 1500 }), NO_PROVIDERS),
      toRow(wire({ id: 'c', currency: 'TRY', totalCost: null, finalPrice: null }), NO_PROVIDERS),
    ];
    const { container } = render(
      <BulkApproveBar
        selectedRows={rows}
        onClear={() => {}}
        onApproved={() => {}}
        onRunningChange={() => {}}
      />,
    );
    const said = flat(within(container).getByText(/known/).textContent);
    expect(said).toBe('€1,500.00 · TRY 1,200.00 known · 1 unpriced');
    expect(container.textContent).not.toContain('2,700');
    expect(container.textContent).not.toContain('$');
  });

  it('the bulk-approve bar says no price is known, never a zero, when none is', () => {
    const rows = [
      toRow(wire({ id: 'a', currency: 'TRY', totalCost: null, finalPrice: null }), NO_PROVIDERS),
      toRow(wire({ id: 'b', currency: 'EUR', totalCost: null, finalPrice: null }), NO_PROVIDERS),
    ];
    const { container } = render(
      <BulkApproveBar
        selectedRows={rows}
        onClear={() => {}}
        onApproved={() => {}}
        onRunningChange={() => {}}
      />,
    );
    expect(within(container).getByText(/known/).textContent).toBe('no price known · 2 unpriced');
  });
});
