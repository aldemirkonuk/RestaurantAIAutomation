/**
 * F-1608 — spend by vendor for any period on /reports (sim 52,
 * owner-year-and-accountant finding 5). Before this lane there was no spend by
 * vendor anywhere; every case here failed on a build without
 * `VendorSpendShelf.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setHouseCurrency, setHouseLocale } from '@/lib/houseCurrency';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
const saved = vi.hoisted(() => vi.fn());
vi.mock('./useReportExports', async (orig) => ({
  ...(await orig<typeof import('./useReportExports')>()),
  saveFile: saved,
}));

import VendorSpendShelf, { dayOf, periods, type VendorSpend } from './VendorSpendShelf';
import { houseToday } from '@/lib/houseZone';
import { AuthContext } from '@/contexts/AuthContext';

const ROSSI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const spend = (over: Partial<VendorSpend> = {}): VendorSpend => ({
  from: '2026-01-01',
  to: '2026-10-13',
  zone: 'Europe/Istanbul',
  currency: 'EUR',
  vendors: [
    {
      providerId: ROSSI,
      name: 'Rossi Wines',
      received: [{ currency: 'EUR', total: 1500 }],
      receivedOrders: 2,
      unpricedOrders: 1,
      awaitingOrders: 0,
      awaiting: [],
      invoiced: [
        { currency: 'EUR', total: 1180 },
        { currency: 'TRY', total: 900 },
      ],
      invoices: 2,
      credited: [],
      creditNotes: 0,
      paperWithoutTotal: 0,
      unpaid: [],
      unpaidInvoices: 0,
      unpaidWithoutTotal: 0,
      owed: [],
      owedInvoices: 0,
      owedCreditNotes: 0,
      owedWithoutTotal: 0,
    },
  ],
  totals: {
    received: [{ currency: 'EUR', total: 1500 }],
    awaiting: [],
    invoiced: [
      { currency: 'EUR', total: 1180 },
      { currency: 'TRY', total: 900 },
    ],
    credited: [],
    unpaid: [],
    owed: [],
  },
  owedSince: null,
  unverifiedPaper: 1,
  duplicatePaper: 0,
  paperWithoutCurrency: 0,
  basis: ['Received is the delivered and completed orders, at each order’s total.'],
  ...over,
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('VendorSpendShelf (F-1608)', () => {
  beforeEach(() => {
    api.get.mockReset();
    saved.mockReset();
    setHouseCurrency('EUR');
    setHouseLocale('en-GB');
  });

  it('reads this year by default and lists each vendor with what was delivered and invoiced', async () => {
    api.get.mockResolvedValue({ data: spend() });
    wrap(<VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />);
    const today = dayOf(houseToday('Europe/Istanbul'));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/reports/vendor-spend', {
        params: { from: `${today.slice(0, 4)}-01-01`, to: today },
      }),
    );
    const list = await screen.findByRole('list', { name: 'Spend by vendor' });
    const row = within(list).getByText('Rossi Wines').closest('li')!;
    expect(row.textContent).toMatch(/Delivered: €1,500(\.00)? over 2 orders, and 1 order with no price/);
    // Another currency is shown in its own code, never added in.
    expect(row.textContent).toMatch(/Invoiced: €1,180(\.00)? \+ (TRY|₺)\s?900/);
    expect(screen.getByText(/1 invoice or credit note has not been checked/)).toBeInTheDocument();
    // The basis the gateway gives is said on the page.
    expect(screen.getByRole('list', { name: 'How these figures are counted' }).textContent).toContain(
      'Received is the delivered and completed orders',
    );
  });

  it('[REVERT-FAILS] says a delivery still open and what is not marked paid, per vendor (F-1632, F-1635)', async () => {
    const base = spend();
    const v = {
      ...base.vendors[0],
      awaitingOrders: 1,
      awaiting: [{ currency: 'EUR', total: 744 }],
      unpaid: [
        { currency: 'EUR', total: 1180 },
        { currency: 'TRY', total: 900 },
      ],
      unpaidInvoices: 2,
    };
    api.get.mockResolvedValue({
      data: spend({ vendors: [v], totals: { ...base.totals, unpaid: v.unpaid } }),
    });
    wrap(<VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />);
    const list = await screen.findByRole('list', { name: 'Spend by vendor' });
    const row = within(list).getByText('Rossi Wines').closest('li')!;
    expect(row.textContent).toMatch(
      /Not in Delivered yet: 1 order delivered but still open \(part still to come, or the invoice not checked yet\), €744(\.00)? at order total/,
    );
    expect(row.textContent).toMatch(/Not marked paid: €1,180(\.00)? \+ (TRY|₺)\s?900(\.00)? over 2 invoices/);
    expect(screen.getByText(/Not marked paid, any date:/)).toBeInTheDocument();
  });

  it('[REVERT-FAILS] says what is owed since the first marking, and the older invoices only as not marked (F-1635)', async () => {
    const base = spend();
    const v = {
      ...base.vendors[0],
      owed: [{ currency: 'EUR', total: 1000 }],
      owedInvoices: 2,
      owedCreditNotes: 1,
      unpaid: [{ currency: 'EUR', total: 9000 }],
      unpaidInvoices: 3,
    };
    api.get.mockResolvedValue({
      data: spend({
        vendors: [v],
        owedSince: '2026-10-14',
        totals: { ...base.totals, unpaid: v.unpaid, owed: v.owed },
      }),
    });
    wrap(<VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />);
    const list = await screen.findByRole('list', { name: 'Spend by vendor' });
    const row = within(list).getByText('Rossi Wines').closest('li')!;
    expect(row.textContent).toMatch(/Owed: €1,000(\.00)? over 2 invoices, less 1 credit note/);
    expect(row.textContent).toMatch(/Not marked paid, dated before 2026-10-14: €9,000(\.00)? over 3 invoices/);
    expect(row.textContent).not.toMatch(/Owed: €9,000/);
    expect(screen.getByText(/Owed now: €1,000/)).toBeInTheDocument();
  });

  it('[REVERT-FAILS] says one vendor\'s credit apart, never netted into Owed now (F-1673)', async () => {
    const base = spend();
    api.get.mockResolvedValue({
      data: spend({
        owedSince: '2026-10-14',
        totals: {
          ...base.totals,
          owed: [{ currency: 'EUR', total: 10000 }],
          inFavour: [{ currency: 'EUR', total: 3000 }],
        },
      }),
    });
    wrap(<VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />);
    const said = await screen.findByText(/Owed now: €10,000(\.00)?\./);
    expect(said.textContent).toMatch(
      /Credit in your favour, from vendors whose credit is more than their bills: €3,000(\.00)?\./,
    );
    expect(said.textContent).not.toMatch(/Owed now: €7,000/);
  });

  it('switches to last year with one tap', async () => {
    api.get.mockResolvedValue({ data: spend() });
    wrap(<VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />);
    fireEvent.click(screen.getByRole('button', { name: 'Last year' }));
    const y = Number(dayOf(houseToday('Europe/Istanbul')).slice(0, 4)) - 1;
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/reports/vendor-spend', {
        params: { from: `${y}-01-01`, to: `${y}-12-31` },
      }),
    );
  });

  it('downloads the period as a CSV file for the accountant', async () => {
    api.get.mockImplementation(async (url: string) =>
      url.endsWith('file.csv') ? { data: 'Mudavym report export\r\n' } : { data: spend() },
    );
    // An owner of two houses (F-1631): the file is named for this one.
    const houses = { availableRestaurants: [{ id: 'h0', name: 'Detroit' }, { id: 'h1', name: 'Tuzlu Rüzgar' }] };
    wrap(
      <AuthContext.Provider value={houses as never}>
        <VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />
      </AuthContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const [filename, mime, body] = saved.mock.calls[0];
    expect(filename).toMatch(/^mudavym-tuzlu-ruzgar-spend-by-vendor-\d{4}-01-01-to-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mime).toBe('text/csv;charset=utf-8');
    expect(body.startsWith('\uFEFF')).toBe(true);
  });

  it('says a refusal in the gateway’s words, never as an empty list', async () => {
    api.get.mockRejectedValue({ response: { status: 403, data: { message: 'Forbidden' } } });
    wrap(<VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/spend by vendor/);
    expect(screen.queryByText(/No order was delivered/)).toBeNull();
  });

  it('names the quick periods on the house’s calendar', () => {
    expect(periods('2027-01-15')).toEqual({
      thisMonth: { from: '2027-01-01', to: '2027-01-15' },
      lastMonth: { from: '2026-12-01', to: '2026-12-31' },
      thisYear: { from: '2027-01-01', to: '2027-01-15' },
      lastYear: { from: '2026-01-01', to: '2026-12-31' },
    });
    expect(periods('2028-03-02').lastMonth).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    // houseToday is a local-midnight Date; the period is its YYYY-MM-DD.
    expect(dayOf(new Date(2027, 0, 5))).toBe('2027-01-05');
  });

  // F-1643 (sim 54): a vendor with only old unpaid paper is not a row of the
  // period; its money is said in its own list, and an empty period says so.
  it('[REVERT-FAILS] says an empty period, and old unpaid paper apart from it (F-1643)', async () => {
    const base = spend();
    const kaya = {
      providerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Kaya Et',
      unpaid: [{ currency: 'EUR', total: 900 }],
      unpaidInvoices: 1,
      unpaidWithoutTotal: 0,
      owed: [],
      owedInvoices: 0,
      owedCreditNotes: 0,
      owedWithoutTotal: 0,
    };
    api.get.mockResolvedValue({
      data: spend({ vendors: [], owing: [kaya], totals: { ...base.totals, unpaid: kaya.unpaid } }),
    });
    wrap(<VendorSpendShelf restaurantId="h1" zone="Europe/Istanbul" />);
    expect(await screen.findByText('No order was delivered and no invoice is dated in this period.')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Owed and not marked paid, any date' });
    expect(within(list).getByText('Kaya Et').closest('li')!.textContent).toMatch(
      /Not marked paid: €900(\.00)? over 1 invoice/,
    );
  });
});
