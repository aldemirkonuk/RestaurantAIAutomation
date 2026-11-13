/**
 * The house's record, its series panel and its price-lock note print the
 * house's money. On a lira house each read "$…" (r8 browser check,
 * 2026-11-12): the cellar's `money()` wrote $ for every house. The catalogue's
 * reference price is not the house's money and names no currency, so it is
 * printed bare and says so.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HouseRecordLeaf from './HouseRecordLeaf';
import SeriesPanel from './SeriesPanel';
import { lockWords } from './PriceLockNote';
import { REFERENCE_CURRENCY_NOTE } from './useHouseMoney';
import type { RegisterRowVM, RowRecordVM } from './useCellarNextData';
import type { PriceLock } from '../../../services/api/pricing';

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

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
}

const row = {
  key: 'h1',
  register: 'spirits',
  name: 'Rakı',
  producer: 'Yeni',
  house: {
    firstSeen: '2026-09-01',
    books: ['menu', 'pos'],
    onMenu: { lines: 1, bottlePrice: 950, glassPrice: 95, sections: ['Rakı'] },
    bought: null,
    ordered: null,
    quoted: null,
    poured: { lines: 3, qty: 4, revenue: 380, firstAt: '2026-09-02', lastAt: '2026-09-03' },
  },
  catalogue: {
    matchedBy: 'exact',
    beverageType: 'spirit',
    region: null,
    country: 'Türkiye',
    abvPct: 45,
    volumeMl: 700,
    packageFormat: null,
    priceReference: 62,
  },
} as unknown as RegisterRowVM;

describe("the cellar's leaves print the house's money", () => {
  it("the house's record reads lira; the catalogue's reference names no currency", async () => {
    wrap(<HouseRecordLeaf row={row} stockingReason="" onClose={() => {}} />);
    const leaf = screen.getByTestId('house-leaf');
    await waitFor(() => expect(leaf).toHaveTextContent('₺950.00'));
    expect(leaf).toHaveTextContent('₺95.00');
    expect(leaf).toHaveTextContent('₺380.00');
    expect(leaf).toHaveTextContent(`62.00 (${REFERENCE_CURRENCY_NOTE})`);
    expect(leaf).not.toHaveTextContent('₺62.00');
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });

  it('the series panel reads lira in its ledger and on its axis', async () => {
    const record: RowRecordVM = {
      restaurantId: 'r1',
      label: 'Rakı',
      matchRule: 'exact',
      named: ['invoice'],
      nothingNamesIt: false,
      books: [
        {
          book: 'invoice',
          readable: true,
          reason: null,
          rows: 2,
          price: [
            { at: '2026-09-01', value: 12.5, unit: 'money' },
            { at: '2026-09-08', value: 14, unit: 'money' },
          ],
          quantity: [],
          ledger: [
            { at: '2026-09-01', label: 'Rakı 70cl', who: 'Mey', qty: 6, unitPrice: 12.5, total: 75, note: null, matchedBy: 'exact' },
          ],
          source: 'the invoices',
        },
      ],
    };
    wrap(
      <SeriesPanel
        label="Rakı"
        columnLabel="Paid"
        columnId="paid"
        book="invoice"
        record={record}
        loading={false}
        error={null}
        onClose={() => {}}
      />,
    );
    const block = screen.getByTestId('series-book-invoice');
    await waitFor(() => expect(block).toHaveTextContent('₺12.50'));
    expect(block).toHaveTextContent('₺75.00');
    expect(block.innerHTML).toContain('from ₺12.50 to ₺14.00');
    expect(document.body.textContent).not.toMatch(/\$\d/);
  });

  it('a price lock is said in the money it is handed', () => {
    const lock = {
      kind: 'bottle',
      lockedPrice: 95,
      lockedAt: '2026-09-21T10:00:00Z',
      lockedBy: { userId: 'u-1', name: 'Ayse' },
    } as unknown as PriceLock;
    expect(lockWords(lock, (n) => `₺${n}`)).toContain('locked at ₺95 at this house');
  });
});
