/**
 * F-333: a row's order and invoice books are read to a cap of 400 lines. When
 * the gateway says a book stopped at that cap (`truncated`), the record shows
 * the newest lines and never says the drink was never ordered.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SeriesPanel from './SeriesPanel';
import RowExpander from './RowExpander';
import { setCellarCurrency } from './cellar-format';
import type { BookRecordVM, RowRecordVM } from './useCellarNextData';

const CAPPED_EMPTY =
  'The newest 400 order lines that could name this were read and none does. Older ones were not read, so this does not say it was never ordered.';
const CAPPED_FOUND =
  'Only the newest 400 order lines that could name this were read, so older ones are not listed here.';

function book(b: BookRecordVM['book'], over: Partial<BookRecordVM> = {}): BookRecordVM {
  return {
    book: b,
    readable: true,
    reason: 'Nothing here.',
    rows: 0,
    price: [],
    quantity: [],
    ledger: [],
    source: b,
    truncated: false,
    ...over,
  };
}

function record(order: BookRecordVM): RowRecordVM {
  return {
    restaurantId: 'r1',
    label: 'Efes Pilsen',
    matchRule: 'rule',
    books: [book('menu'), book('invoice'), order, book('quote'), book('pos')],
    named: order.rows ? ['order'] : [],
    nothingNamesIt: false,
  };
}

describe('a capped order book (F-333)', () => {
  it('the series panel says only the newest lines were read', () => {
    const order = book('order', {
      reason: CAPPED_FOUND,
      rows: 1,
      truncated: true,
      ledger: [
        {
          at: '2026-10-01',
          label: 'Efes Pilsen',
          who: 'Vendor',
          qty: 6,
          unitPrice: 4,
          total: null,
          note: null,
          matchedBy: 'exact',
        },
      ],
    });
    render(
      <SeriesPanel
        label="Efes Pilsen"
        columnLabel="Ordered"
        columnId="ordered"
        book="order"
        record={record(order)}
        loading={false}
        error={null}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('series-capped-order')).toHaveTextContent(/newest 400/);
  });

  it('the row never says "never ordered" when the order book stopped at its cap', () => {
    const order = book('order', { reason: CAPPED_EMPTY, truncated: true });
    render(
      <RowExpander
        row={{ key: 'k', name: 'Efes Pilsen', producer: null, catalogue: null, house: null }}
        register="beer"
        record={record(order)}
        loading={false}
        error={null}
        stockingReason="none"
        onOpenSeries={() => {}}
      />,
    );
    const none = screen.getByTestId('ledger-none');
    expect(none).not.toHaveTextContent(/Never ordered and never invoiced/);
    expect(none).toHaveTextContent(/does not say it was never ordered/);
  });
});

// F-998: `beverages.price_reference` has no currency on record, so the card
// must not print it in the house's money (₺28 here, $28 next door).
describe('the catalogue reference on the record card (F-998)', () => {
  afterEach(() => setCellarCurrency(undefined));

  it('says its currency was not recorded instead of borrowing the house sign', () => {
    setCellarCurrency('TRY');
    render(
      <RowExpander
        row={{
          key: 'k',
          name: 'Efes Pilsen',
          producer: null,
          catalogue: {
            id: 'b1',
            beverageType: 'beer',
            country: null,
            region: null,
            abvPct: null,
            volumeMl: null,
            packageFormat: null,
            priceReference: 28,
            matchedBy: 'exact',
          },
          house: null,
        }}
        register="beer"
        record={record(book('order'))}
        loading={false}
        error={null}
        stockingReason="none"
        onOpenSeries={() => {}}
      />,
    );
    const line = screen.getByText('Catalogue reference').parentElement!;
    expect(line).toHaveTextContent(/28[.,]00 \(currency not recorded\)/);
    expect(line).not.toHaveTextContent('₺');
  });
});
