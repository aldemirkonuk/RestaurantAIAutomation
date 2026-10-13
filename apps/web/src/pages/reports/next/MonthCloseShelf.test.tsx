/**
 * F-1013 — closed months on /reports (founder 2026-10-11, option C, the
 * snapshot close). Before this lane /reports had no way to close a month at
 * all; every case here failed on a build without `MonthCloseShelf.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setHouseCurrency, setHouseLocale } from '@/lib/houseCurrency';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));

import MonthCloseShelf, { monthBefore, type MonthClose, type MonthCloseDetail } from './MonthCloseShelf';
import { houseToday } from '@/lib/houseZone';
import { monthLabel, thisMonth } from './rp-registers-trade';

const close = (over: Partial<MonthClose> = {}): MonthClose => ({
  id: 'c1',
  month: '2026-07',
  version: 1,
  closedAt: '2026-08-02T09:00:00Z',
  closedBy: { id: 'u1', name: 'Ayla' },
  zone: 'Europe/Istanbul',
  hasTillFile: true,
  figures: {
    currency: 'EUR',
    till: { posConnected: true, netSales: 1000, netSalesCheckCount: 10, checkCount: 10, days: [] },
    valuation: { inventoryValue: null, pricedInventoryValue: 4200, unpricedWines: 3, valuedAt: '2026-08-02T09:00:00Z' },
    purchases: { orders: 2, unpriced: 1, totals: [{ currency: 'EUR', total: 300 }] },
    variance: { counts: 2, netBottles: -1, shortBottles: 2, overBottles: 1 },
  },
  ...over,
});

const detail = (): MonthCloseDetail => ({
  ...close(),
  changes: [
    {
      kind: 'till',
      at: '2026-08-03T10:00:00Z',
      day: '2026-07-20',
      who: 'The till',
      what: 'Check T-17 voided at the till',
      delta: -120,
      unit: 'money',
      currency: null,
    },
    {
      kind: 'stock',
      at: '2026-08-04T08:00:00Z',
      day: '2026-07-15',
      who: 'Deniz',
      what: 'Written off: Barolo 2019',
      delta: -1,
      unit: 'bottles',
      currency: null,
    },
  ],
  changesNotListed: 0,
  againstNow: [
    {
      figure: 'till_net_sales',
      label: 'Net sales through the till',
      atClose: 1000,
      now: 880,
      delta: -120,
      currency: 'EUR',
    },
  ],
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('MonthCloseShelf (F-1013)', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    setHouseLocale('en-US');
    setHouseCurrency('EUR');
  });

  it('names the month before, across a new year', () => {
    expect(monthBefore('2026-01')).toBe('2025-12');
    expect(monthBefore('2026-10')).toBe('2026-09');
  });

  it('closes the month picked and reads the list again', async () => {
    api.get.mockResolvedValueOnce({ data: { closes: [] } });
    api.post.mockResolvedValueOnce({ data: close() });
    api.get.mockResolvedValueOnce({ data: { closes: [close()] } });
    wrap(<MonthCloseShelf restaurantId="r1" zone="Europe/Istanbul" />);

    await screen.findByText('No month has been closed for this house yet.');
    fireEvent.change(screen.getByLabelText('Month to close'), { target: { value: '2026-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close the month' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reports/month-close', { month: '2026-07' }));
    const kept = await screen.findByLabelText(/Figures kept for/);
    // F-1494: the till's figure is net (ADR 0287 AW17), and says so.
    expect(kept.textContent).toContain('Net sales through the till: €1,000 over 10 checks');
    expect(kept.textContent).toContain('1 order with no price');
    expect(kept.textContent).toContain('2 bottles short, 1 bottle over');
    // The cellar's value is not invented: only the priced wines, and how many have no cost.
    expect(kept.textContent).toContain('for the priced wines; 3 wines have no cost');
  });

  it('brings itself into view when /logs links to it (F-1513)', async () => {
    api.get.mockResolvedValueOnce({ data: { closes: [] } });
    const scroll = vi.fn();
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, '', '/reports#rp-month-close');
    try {
      wrap(<MonthCloseShelf restaurantId="r1" zone="Europe/Istanbul" />);
      await screen.findByText('No month has been closed for this house yet.');
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = before;
      window.history.replaceState(null, '', '/');
    }
  });

  it('says why a close was refused, in the gateway’s words', async () => {
    api.get.mockResolvedValueOnce({ data: { closes: [] } });
    api.post.mockRejectedValueOnce({
      response: { data: { message: 'October 2026 is not over yet on this house’s clock.' } },
    });
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    await screen.findByText('No month has been closed for this house yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Close the month' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The month was not closed: October 2026 is not over yet on this house’s clock.',
    );
  });

  it('lists what changed after the close: who, what, by how much, against the record', async () => {
    api.get.mockImplementation(async (url: string) =>
      url === '/reports/month-close' ? { data: { closes: [close()] } } : { data: detail() },
    );
    wrap(<MonthCloseShelf restaurantId="r1" zone="Europe/Istanbul" />);
    fireEvent.click(await screen.findByRole('button', { name: 'What changed since' }));

    const changed = await screen.findByLabelText('Changed after close');
    const rows = within(changed).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      '2026-07-20 · The till · Check T-17 voided at the till -€120',
      '2026-07-15 · Deniz · Written off: Barolo 2019 -1 bottle',
    ]);
    expect(screen.getByLabelText('Kept against now').textContent).toContain(
      'Net sales through the till: €1,000 kept, €880 now (-€120)',
    );
    expect(api.get).toHaveBeenCalledWith('/reports/month-close/c1');
  });

  it('says when net sales come from only some checks, or from none (F-1494)', async () => {
    const f = close().figures;
    api.get.mockResolvedValueOnce({
      data: {
        closes: [
          close({ figures: { ...f, till: { ...f.till, netSales: 800, netSalesCheckCount: 8 } } }),
          close({
            id: 'c0',
            month: '2026-06',
            figures: { ...f, till: { ...f.till, netSales: null, netSalesCheckCount: 0 } },
          }),
        ],
      },
    });
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    const kept = await screen.findAllByLabelText(/Figures kept for/);
    expect(kept[0].textContent).toContain(
      'Net sales through the till: €800 from 8 of 10 checks; the rest carried no net figure',
    );
    expect(kept[1].textContent).toContain('Net sales through the till: —, not recorded: no check carried a net figure');
    expect(kept[1].textContent).not.toContain('€0');
  });

  it('says the tax inside the till and the basis each close’s net was on (F-1606)', async () => {
    const f = close().figures;
    api.get.mockResolvedValueOnce({
      data: {
        closes: [
          // Switched mid-month: net holds KDV before the day, not after.
          close({
            taxBasis: 'prices_include_tax',
            figures: {
              ...f,
              taxWord: 'KDV',
              taxBasisSince: '2026-07-15',
              till: { ...f.till, taxInside: 100, taxInsideCheckCount: 4 },
            },
          }),
          // Kept before closes recorded a basis.
          close({ id: 'c0', month: '2026-06' }),
        ],
      },
    });
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    const kept = await screen.findAllByLabelText(/Figures kept for/);
    expect(kept[0].textContent).toContain('KDV inside till prices: €100 from 4 of 10 checks');
    expect(kept[0].textContent).toContain(
      'Tax basis: till prices include KDV. Net is as the till sent it, with KDV inside, before 2026-07-15, and without KDV from that day on.',
    );
    expect(kept[1].textContent).not.toContain('inside till prices');
    expect(kept[1].textContent).toContain('Tax basis: not recorded with this close');
  });

  it('says beside the net figure that the kept Till CSV is gross check totals (F-1578)', async () => {
    api.get.mockResolvedValueOnce({ data: { closes: [close(), close({ id: 'c0', month: '2026-06', hasTillFile: false })] } });
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    await screen.findAllByLabelText(/Figures kept for/);
    const said = screen.getAllByText(/The Till CSV is the check totals as your till sent them/);
    // Only the close that keeps a file says it.
    expect(said).toHaveLength(1);
    expect(said[0].textContent).toMatch(/reads higher than the net sales above/);
  });

  it('never says nothing changed while a figure moved (F-1467)', async () => {
    api.get.mockImplementation(async (url: string) =>
      url === '/reports/month-close' ? { data: { closes: [close()] } } : { data: { ...detail(), changes: [] } },
    );
    wrap(<MonthCloseShelf restaurantId="r1" zone="Europe/Istanbul" />);
    fireEvent.click(await screen.findByRole('button', { name: 'What changed since' }));
    expect(
      await screen.findByText(
        'A figure above has moved since the month was closed, but no single change could be listed for it.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing dated in this month has changed/)).not.toBeInTheDocument();
  });

  it('marks an earlier version of a month closed again', async () => {
    api.get.mockResolvedValueOnce({
      data: { closes: [close({ id: 'c2', version: 2 }), close()] },
    });
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    expect(await screen.findByText(/closed again \(version 2\)/)).toBeInTheDocument();
    expect(screen.getByText(/closed, an earlier version/)).toBeInTheDocument();
  });

  // F-1517 (sim 49): the shelf preselected last month for a house opened this
  // month, and let any month before the house opened be picked.
  it('[REVERT-FAILS] preselects no month for a house opened this month, and says when its first can close', async () => {
    const opened = thisMonth(houseToday('Europe/Istanbul'));
    api.get.mockResolvedValueOnce({ data: { closes: [], openedMonth: opened } });
    wrap(<MonthCloseShelf restaurantId="r1" zone="Europe/Istanbul" />);
    expect(
      await screen.findByText(new RegExp(`This house opened in ${monthLabel(opened)}\\. Its first month can be closed`)),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Month to close')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Close the month' })).toBeDisabled();
  });

  it('[REVERT-FAILS] offers no month before the house opened', async () => {
    api.get.mockResolvedValueOnce({ data: { closes: [], openedMonth: '2025-03' } });
    wrap(<MonthCloseShelf restaurantId="r1" zone="Europe/Istanbul" />);
    await screen.findByText('No month has been closed for this house yet.');
    const input = screen.getByLabelText('Month to close');
    expect(input).toHaveAttribute('min', '2025-03');
    expect(input).toHaveValue(monthBefore(thisMonth(houseToday('Europe/Istanbul'))));
    expect(screen.getByRole('button', { name: 'Close the month' })).toBeEnabled();
  });

  it('says the list could not be read rather than showing an empty house', async () => {
    api.get.mockRejectedValueOnce(new Error('Network Error'));
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/list of closed months could not be read/);
    expect(screen.queryByText('No month has been closed for this house yet.')).toBeNull();
  });
});
