/**
 * A register's rows and their expanded cards print the house's money. On a
 * lira house the Listed, Paid, Charged and Quote cells and the "What it costs
 * and what it makes" card read "$…" (r8 browser check, 2026-11-12): the
 * cellar's `money()` wrote $ for every house. The catalogue's reference price
 * is not the house's money and names no currency, so it prints bare.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RowExpander from './RowExpander';
import { cellFor } from './registerCells';
import type { RegisterRowVM, RowRecordVM } from './useCellarNextData';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));
vi.mock('../../../services/api/settings', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    settingsApi: {
      ...(actual.settingsApi as object),
      houseCurrency: async () => ({ readable: true, code: 'TRY' }),
    },
  };
});

const row = {
  key: 'h1',
  register: 'beer',
  name: 'Efes Pilsen',
  producer: 'Anadolu Efes',
  house: {
    firstSeen: '2026-03-01',
    books: ['menu', 'invoice', 'pos', 'quote'],
    onMenu: { lines: 1, bottlePrice: 95, glassPrice: null, sections: ['Bira'] },
    bought: { first: '2026-03-01', last: '2026-03-05', bottles: 24, paidTotal: 206.4, lastUnitPrice: 8.6, lastFrom: 'Mey', lines: 1, doorChecked: 0 },
    ordered: null,
    quoted: { count: 1, lastAt: '2026-03-04', lastPrice: 8.2, lastFrom: 'Mey', lastSource: 'email' },
    poured: { lines: 2, qty: 3, revenue: 285, firstAt: '2026-03-06', lastAt: '2026-03-07' },
  },
  catalogue: {
    matchedBy: 'exact',
    beverageType: 'beer',
    region: null,
    country: 'Türkiye',
    abvPct: 5,
    volumeMl: 500,
    packageFormat: 'bottle',
    priceReference: 2.5,
  },
} as unknown as RegisterRowVM;

const lira = (n: number | null | undefined) => (n == null ? '—' : `₺${n.toFixed(2)}`);

describe("a register's cells print the money they are handed", () => {
  it('listed, paid, charged and quote read the house money, never $', () => {
    const { container } = render(
      <div>
        <span data-testid="listed">{cellFor(row, 'listed', lira)}</span>
        <span data-testid="paid">{cellFor(row, 'paid', lira)}</span>
        <span data-testid="charged">{cellFor(row, 'charged', lira)}</span>
        <span data-testid="quote">{cellFor(row, 'quote', lira)}</span>
      </div>,
    );
    expect(screen.getByTestId('listed')).toHaveTextContent('₺95.00');
    expect(screen.getByTestId('paid')).toHaveTextContent('₺206.40');
    expect(screen.getByTestId('charged')).toHaveTextContent('₺285.00');
    expect(screen.getByTestId('quote')).toHaveTextContent('₺8.20');
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("the expanded row prints the house's money", () => {
  it('cost and list read lira; the catalogue reference names no currency', async () => {
    const book = (b: string, unitPrice: number, total: number | null) => ({
      book: b,
      readable: true,
      reason: null,
      rows: 1,
      price: [],
      quantity: [],
      ledger: [{ at: '2026-03-05T00:00:00Z', label: 'Efes Pilsen', who: 'Mey', qty: 24, unitPrice, total, note: null, matchedBy: 'exact' }],
      source: b,
    });
    const record = {
      restaurantId: 'r1',
      label: 'Efes Pilsen',
      matchRule: 'exact',
      named: ['invoice', 'menu'],
      nothingNamesIt: false,
      books: [book('invoice', 8.6, 206.4), book('menu', 95, null)],
    } as unknown as RowRecordVM;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (children: ReactNode) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    render(
      wrap(
        <RowExpander
          row={row}
          register="beer"
          record={record}
          loading={false}
          error={null}
          stockingReason="Beer has no stock row."
          onOpenSeries={() => {}}
        />,
      ),
    );
    await waitFor(() => expect(document.body).toHaveTextContent('₺8.60'));
    expect(document.body).toHaveTextContent('₺95.00');
    expect(document.body).toHaveTextContent('2.50 (currency not stated)');
    expect(document.body.textContent).not.toMatch(/₺2\.50/);
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });
});
