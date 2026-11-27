/**
 * Perf p8-3. Opening a title read four things at the click: the ledger's
 * purchases, the auction lots, the till record and (page-level) the research
 * list. The first three now start on intent (the pointer resting on the row,
 * focus, a touch), under the keys the open uses, so the open renders from cache.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const get = vi.hoisted(() => vi.fn());
const house = vi.hoisted(() => ({ id: 'r1' }));
const lots = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: house.id }),
}));
vi.mock('../../../services/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { get },
}));
vi.mock('../../../services/api/documents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  documentsApi: { forOrder: vi.fn(async () => []) },
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchAuctionLotRecords: lots,
}));
vi.mock('./RowDropdown', () => ({ default: () => null }));
vi.mock('../command/HousePriceCell', () => ({ HousePriceCell: () => null }));

import { useRowDetail, useWarmRow, type InvRow } from './useInventoryNextData';
import { useRowRecord } from '../../cellar/next/useCellarNextData';
import InventoryTable, { WARM_REST_MS } from './InventoryTable';

/** The app's own defaults (App.tsx:158): 5 s stale, and every mount reads again. */
function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5_000, refetchOnMount: 'always' } },
  });
}
const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

const urls = () => get.mock.calls.map((c) => String(c[0]));
const count = (needle: string) => urls().filter((u) => u.includes(needle)).length;
/** The row's own reads; the research list is the page's, read by every row's hint. */
const rowReads = () => count('row-record') + count('/inventory-ledger/transactions') + lots.mock.calls.length;

beforeEach(() => {
  get.mockReset();
  lots.mockReset();
  lots.mockResolvedValue([]);
  house.id = 'r1';
  get.mockImplementation(async (url: string) =>
    String(url).includes('row-record')
      ? { data: { books: [] } }
      : { data: { transactions: [], total: 0 } },
  );
});

describe('a warmed row opens from cache', () => {
  it('reads the purchases, the lots and the till record once for warm-then-open', async () => {
    const qc = client();
    const warm = renderHook(() => useWarmRow(), { wrapper: wrap(qc) });
    await act(async () => {
      warm.result.current({ id: 'i1', name: 'Barolo' });
      await qc.isFetching();
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(count('row-record')).toBe(1));
    expect(count('/inventory-ledger/transactions')).toBe(1);
    expect(lots).toHaveBeenCalledTimes(1);

    // The open: the hooks the row makes, on the same client, while the warm is fresh.
    const open = renderHook(
      () => ({ d: useRowDetail('i1'), r: useRowRecord('Barolo') }),
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(open.result.current.d.purchases).not.toBeNull());
    expect(open.result.current.r.data).not.toBeNull();
    expect(count('row-record')).toBe(1);
    expect(count('/inventory-ledger/transactions')).toBe(1);
    expect(lots).toHaveBeenCalledTimes(1);
  });

  it('reads again for another house: every key carries the house', async () => {
    const qc = client();
    const warm = renderHook(() => useWarmRow(), { wrapper: wrap(qc) });
    await act(async () => {
      warm.result.current({ id: 'i1', name: 'Barolo' });
    });
    await waitFor(() => expect(count('row-record')).toBe(1));
    house.id = 'r2';
    warm.rerender();
    await act(async () => {
      warm.result.current({ id: 'i1', name: 'Barolo' });
    });
    await waitFor(() => expect(count('row-record')).toBe(2));
    expect(get.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('row-record'))).toEqual([
      '/beverages/r1/row-record',
      '/beverages/r2/row-record',
    ]);
    const keys = qc.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys.every((k) => k.includes('r1') || k.includes('r2'))).toBe(true);
  });

  it('makes no read for a row with no house yet', async () => {
    house.id = '';
    const qc = client();
    const warm = renderHook(() => useWarmRow(), { wrapper: wrap(qc) });
    await act(async () => warm.result.current({ id: 'i1', name: 'Barolo' }));
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the table warms a row on intent, not on a sweep', () => {
  const row = {
    id: 'i1', wineId: 'w1', name: 'Barolo', libraryName: null, producer: null, type: 'red', kind: 'wine',
    vintage: 2019, grape: null, bottleSizeMl: 750, stock: 4, shadow: 0, par: 6, reorderPoint: null,
    analyticsReadable: true, velocity: 1, runway: 4, daysSinceSale: 1, deadStock: false, abc: null,
    bottle: null, glass: null, pourMl: null, wac: null, costProvenance: null, value: null,
    lastCountedAt: null, openMl: null, zones: [], providerId: null, providerName: null,
    standing: 'ok', active: true,
  } as unknown as InvRow;
  const paint = (qc: QueryClient, openId: string | null = null) =>
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <InventoryTable
            rows={[row]}
            grouped={false}
            openId={openId}
            onToggle={vi.fn()}
            advice={{ kind: 'none' } as never}
            onPriceChanged={vi.fn()}
            currency={{ code: 'USD' } as never}
            canManage
            zoneName={() => ''}
            locations={{ list: [], loading: false, unavailable: false } as never}
            locationsUnavailable={false}
            providers={[] as never}
            providersError={null}
            restaurantId="r1"
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads nothing when the pointer sweeps across, and reads when it rests', async () => {
    paint(client());
    const tr = screen.getByTestId('inv-row-i1');

    fireEvent.pointerEnter(tr);
    await act(async () => vi.advanceTimersByTime(WARM_REST_MS - 20));
    fireEvent.pointerLeave(tr);
    await act(async () => vi.advanceTimersByTime(500));
    expect(rowReads()).toBe(0);

    fireEvent.pointerEnter(tr);
    await act(async () => vi.advanceTimersByTime(WARM_REST_MS + 1));
    expect(count('row-record')).toBe(1);
    expect(count('/inventory-ledger/transactions')).toBe(1);
  });

  it('reads at once on a touch and on focus', async () => {
    paint(client());
    fireEvent.touchStart(screen.getByTestId('inv-row-i1'));
    await act(async () => vi.advanceTimersByTime(0));
    expect(count('row-record')).toBe(1);
  });

  it('reads nothing for the row that is already open', async () => {
    paint(client(), 'i1');
    fireEvent.touchStart(screen.getByTestId('inv-row-i1'));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(rowReads()).toBe(0);
  });
});
