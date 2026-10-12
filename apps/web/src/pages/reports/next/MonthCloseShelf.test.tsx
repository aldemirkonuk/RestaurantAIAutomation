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
    till: { posConnected: true, revenue: 1000, checkCount: 10, days: [] },
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
    { figure: 'till_revenue', label: 'Taken through the till', atClose: 1000, now: 880, delta: -120, currency: 'EUR' },
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
    expect(kept.textContent).toContain('Taken through the till: €1,000');
    expect(kept.textContent).toContain('1 order with no price');
    expect(kept.textContent).toContain('2 bottles short, 1 bottle over');
    // The cellar's value is not invented: only the priced wines, and how many have no cost.
    expect(kept.textContent).toContain('for the priced wines; 3 wines have no cost');
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
      'Taken through the till: €1,000 kept, €880 now (-€120)',
    );
    expect(api.get).toHaveBeenCalledWith('/reports/month-close/c1');
  });

  it('marks an earlier version of a month closed again', async () => {
    api.get.mockResolvedValueOnce({
      data: { closes: [close({ id: 'c2', version: 2 }), close()] },
    });
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    expect(await screen.findByText(/closed again \(version 2\)/)).toBeInTheDocument();
    expect(screen.getByText(/closed, an earlier version/)).toBeInTheDocument();
  });

  it('says the list could not be read rather than showing an empty house', async () => {
    api.get.mockRejectedValueOnce(new Error('Network Error'));
    wrap(<MonthCloseShelf restaurantId="r1" zone={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/list of closed months could not be read/);
    expect(screen.queryByText('No month has been closed for this house yet.')).toBeNull();
  });
});
