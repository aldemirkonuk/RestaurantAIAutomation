/**
 * /orders on the order book (F-140, ADR 0269 PR-B): the pure list and figure
 * rules (`stationView`, `figuresFor`, `orderBookErrorWords`), then the real
 * `useOrdersNextData` on the fake gateway, through the real runner.
 *
 * Rows carry `requestedAt`: `makeOrders` sets `createdAt` only, and the page
 * sorts and counts the month by `requestedAt`, which the gateway's rows carry.
 * Month tests build their dates in local time, so they hold in any time zone.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/client')>();
  return { ...actual, apiClient: { get: vi.fn() } };
});
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [], isError: false, isLoading: false }),
}));

import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { queryKeys } from '@/lib/query-keys';
import {
  BookShapeError,
  ForeignRowError,
  HouseChangedError,
  RateLimitedError,
  type OrderBook,
} from '@/services/api/order-book';
import { BOOK_INTERVAL_MS, resetOrderBookRunnerForTests } from '@/hooks/queries/useOrderBook';
import type { Order, OrderWireStatus } from '@/services/api/types';
import {
  FakeOrderGateway,
  HOUSE_A,
  HOUSE_B,
  makeOrders,
  signInAs,
} from '@/__tests__/utils/fakeOrderGateway';
import {
  figuresFor,
  orderBookErrorWords,
  stationView,
  toRow,
  useOrdersNextData,
  type OrderRowVM,
} from './useOrdersNextData';

const GATE_URL = '/procurement/order-approval-gate';
const NO_NAMES = new Map<string, string>();

let gw: FakeOrderGateway;

/** As the gateway's rows are: `requestedAt` set (risk T-D6, Attack ledger 14). */
const dated = (orders: Order[]): Order[] =>
  orders.map((o) => ({ ...o, requestedAt: (o as unknown as { createdAt: string }).createdAt }));

const rowsOf = (orders: Order[]): OrderRowVM[] => orders.map((o) => toRow(o, NO_NAMES));

function book(over: Partial<OrderBook> = {}): OrderBook {
  return {
    house: HOUSE_A,
    mode: 'whole',
    reason: null,
    rows: [],
    total: 0,
    openComplete: true,
    statusTotals: null,
    unclassifiedCount: null,
    nextClosedPage: null,
    readStartedAt: 1,
    readFinishedAt: 2,
    requests: 1,
    ...over,
  };
}

/** One order of `house`, as the wire sends it. */
function order(id: string, status: OrderWireStatus, over: Record<string, unknown> = {}): Order {
  return {
    id,
    orderNumber: `PO-${id}`,
    restaurantId: HOUSE_A,
    inventoryId: 'inv-1',
    providerId: 'prov-1',
    quantity: 1,
    status,
    createdAt: '2026-09-15T10:00:00.000Z',
    requestedAt: '2026-09-15T10:00:00.000Z',
    ...over,
  } as unknown as Order;
}

const WEEKLY = { recurrenceFrequency: 'weekly', recurrenceStatus: 'active' };

function authAs(house: string) {
  vi.mocked(useAuth).mockReturnValue({
    activeRestaurantId: house,
    isAuthenticated: true,
    user: { userId: 'u1', restaurantId: house, role: 'owner' },
  } as unknown as ReturnType<typeof useAuth>);
}

/** The app's QueryClient defaults (App.tsx:150-161). */
function appClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000, refetchOnWindowFocus: true, refetchOnMount: 'always', retry: 1 },
    },
  });
}

function mount(house: string, target: string | null = null, client = appClient()) {
  signInAs(house);
  authAs(house);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ id }: { id: string | null }) => useOrdersNextData(id), {
    wrapper,
    initialProps: { id: target },
  });
  return { client, hook };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const listReads = () => gw.listCalls().length;
const byIdCalls = (id: string) => gw.calls.filter((c) => c.url === `/procurement/orders/${id}`).length;
const HOUSE_WORDS = /book|page|gateway|API/i;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetOrderBookRunnerForTests();
  gw = new FakeOrderGateway([]);
  gw.scopeByToken = true;
  vi.mocked(apiClient.get).mockReset();
  vi.mocked(apiClient.get).mockImplementation(((url: string, config?: never) =>
    url === GATE_URL
      ? Promise.resolve({ data: { readable: false, reason: 'not read in this test', orders: [] } })
      : gw.get(url, config)) as never);
});

afterEach(() => {
  resetOrderBookRunnerForTests();
  vi.useRealTimers();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// figuresFor
// ---------------------------------------------------------------------------

describe('figuresFor', () => {
  it('A1: a whole read counts every row, not the newest 50', () => {
    const STATUS: OrderWireStatus[] = ['PENDING', 'APPROVED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'];
    const now = new Date(2026, 9, 20, 12);
    const orders = Array.from({ length: 160 }, (_, i) =>
      order(`o-${i}`, STATUS[i % 5], {
        // 150 in October, the oldest 10 in September (local time).
        requestedAt: (i < 150 ? new Date(2026, 9, 1 + (i % 15), 10) : new Date(2026, 8, 10, 10)).toISOString(),
        ...(i % 16 === 1 ? {} : { totalCost: 10 }),
      }),
    );
    const rows = rowsOf(orders);
    const f = figuresFor(book({ rows: orders, total: 160 }), rows, now);

    const want = { pending: 0, approved: 0, ordered: 0, delivered: 0, cancelled: 0, thisMonth: 0, lastMonth: 0, unpriced: 0 };
    orders.forEach((_, i) => {
      const s = STATUS[i % 5];
      if (s === 'CANCELLED') {
        want.cancelled++;
        return;
      }
      if (s === 'PENDING') want.pending++;
      if (s === 'APPROVED') want.approved++;
      if (s === 'IN_TRANSIT') want.ordered++;
      if (s === 'COMPLETED') want.delivered++;
      const priced = i % 16 !== 1;
      if (i < 150) {
        if (priced) want.thisMonth += 10;
        else want.unpriced++;
      } else if (priced) want.lastMonth += 10;
    });
    expect(f.counts).toEqual({
      pending: want.pending,
      approved: want.approved,
      ordered: want.ordered,
      delivered: want.delivered,
    });
    expect(want.pending + want.approved + want.ordered + want.delivered).toBe(128);
    expect(f.cancelledCount).toBe(32);
    expect(f.recurringCount).toBe(0);
    expect(f.month).toEqual({ thisMonth: want.thisMonth, lastMonth: want.lastMonth, unpricedThisMonth: want.unpriced });
    expect(f.deliveredAtLeast).toBeNull();
    expect(f.recurringAtLeast).toBeNull();
    expect(f.countsAreFloors).toBe(false);
  });

  function degraded(mode: 'capped' | 'partial', openComplete: boolean, totals: OrderBook['statusTotals']) {
    const orders = [
      ...Array.from({ length: 4 }, (_, i) => order(`p-${i}`, 'PENDING')),
      ...Array.from({ length: 3 }, (_, i) => order(`a-${i}`, 'APPROVED')),
      ...Array.from({ length: 2 }, (_, i) => order(`t-${i}`, 'IN_TRANSIT')),
      ...Array.from({ length: 20 }, (_, i) => order(`c-${i}`, 'COMPLETED', { totalCost: 10 })),
      ...Array.from({ length: 3 }, (_, i) => order(`x-${i}`, 'CANCELLED')),
      ...Array.from({ length: 2 }, (_, i) => order(`r-${i}`, 'COMPLETED', WEEKLY)),
    ];
    const b = book({ mode, reason: mode === 'capped' ? 'ceiling' : 'unstable', rows: orders, total: 5_000, openComplete, statusTotals: totals });
    return figuresFor(b, rowsOf(orders), new Date(2026, 8, 20));
  }

  it('A2: capped with openComplete true: open stations are floors (rule (d)), the rest a floor, cancelled from the counts', () => {
    const f = degraded('capped', true, { CANCELLED: 7, REJECTED: 2, FAILED: 1, PENDING: 4 });
    expect(f.counts).toEqual({ pending: 4, approved: 3, ordered: 2, delivered: null });
    expect(f.countsAreFloors).toBe(true);
    expect(f.recurringCount).toBeNull();
    expect(f.month).toEqual({ thisMonth: null, lastMonth: null, unpricedThisMonth: 0 });
    expect(f.cancelledCount).toBe(10);
    expect(f.deliveredAtLeast).toBe(20);
    expect(f.recurringAtLeast).toBe(2);
  });

  it('A3: partial with openComplete false: open stations are floors still, never dashes (rule (d))', () => {
    const f = degraded('partial', false, { CANCELLED: 7, REJECTED: 2, FAILED: 1 });
    expect(f.counts).toEqual({ pending: 4, approved: 3, ordered: 2, delivered: null });
    expect(f.countsAreFloors).toBe(true);
    expect(f.cancelledCount).toBe(10);
  });

  it('A4: a status count that did not come back gives no cancelled count, never a zero', () => {
    expect(degraded('capped', true, { CANCELLED: 7, FAILED: 1 }).cancelledCount).toBeNull();
    expect(degraded('capped', true, null).cancelledCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stationView
// ---------------------------------------------------------------------------

describe('stationView', () => {
  /** `n` finished deliveries, newest first, hours after 2026-09-01. */
  const finished = (n: number, prefix = 'f') =>
    rowsOf(
      Array.from({ length: n }, (_, i) =>
        order(`${prefix}-${String(i).padStart(3, '0')}`, 'COMPLETED', {
          requestedAt: new Date(Date.UTC(2026, 8, 20) - i * 3_600_000).toISOString(),
        }),
      ),
    );
  const ids = (rows: OrderRowVM[]) => rows.map((r) => r.id);
  const old = (id: string, status: OrderWireStatus, over: Record<string, unknown> = {}) =>
    toRow(order(id, status, { requestedAt: '2026-01-01T00:00:00.000Z', ...over }), NO_NAMES);

  it('A5: open arrivals first even when older, then 50 finished a tap', () => {
    const rows = [...finished(120), old('a-1', 'DELIVERED'), old('a-2', 'PARTIALLY_RECEIVED')];
    const v0 = stationView(rows, 'delivered', 0, null, false);
    expect(ids(v0.open)).toEqual(['a-1', 'a-2']);
    expect(v0.finished).toHaveLength(0);
    expect(v0.hiddenFinished).toBe(120);
    const v1 = stationView(rows, 'delivered', 1, null, false);
    expect(ids(v1.finished)).toEqual(ids(finished(50)));
    expect(v1.hiddenFinished).toBe(70);
    expect(stationView(rows, 'delivered', 3, null, false).finished).toHaveLength(120);
  });

  it('A6: nothing open opens on exactly the newest 50', () => {
    const v = stationView(finished(120), 'delivered', 0, null, false);
    expect(v.open).toHaveLength(0);
    expect(ids(v.finished)).toEqual(ids(finished(50)));
    expect(v.hiddenFinished).toBe(70);
  });

  it('A6b: once opened on 50, they stay when an open order arrives', () => {
    const v = stationView([...finished(120), old('a-1', 'DELIVERED')], 'delivered', 0, null, true);
    expect(v.open).toHaveLength(1);
    expect(v.finished).toHaveLength(50);
  });

  it('A7: cancelled and rejected orders are never listed, at Delivered or in All', () => {
    const rows = [...finished(10), old('x-1', 'CANCELLED'), old('x-2', 'REJECTED'), old('x-3', 'FAILED')];
    for (const station of ['delivered', null] as const) {
      for (const taps of [0, 1, 5]) {
        const v = stationView(rows, station, taps, null, false);
        const shown = ids([...v.open, ...v.finished]);
        expect(shown.filter((id) => id.startsWith('x-'))).toEqual([]);
        expect(v.hiddenFinished + v.finished.length).toBe(10);
      }
    }
  });

  it('A7b: a cancelled recurring order is listed under Recurring and nowhere else', () => {
    const rows = [...finished(3), old('rc-1', 'CANCELLED', WEEKLY)];
    expect(ids(stationView(rows, 'recurring', 0, null, false).open)).toEqual(['rc-1']);
    for (const station of [null, 'pending', 'approved', 'ordered', 'delivered'] as const) {
      const v = stationView(rows, station, 5, null, false);
      expect(ids([...v.open, ...v.finished])).not.toContain('rc-1');
    }
  });

  it('A8: a deep-linked finished order is listed wherever it falls', () => {
    const v = stationView([...finished(120), old('a-1', 'DELIVERED')], 'delivered', 0, 'f-079', false);
    expect(ids(v.finished)).toEqual(['f-079']);
    expect(v.hiddenFinished).toBe(119);
  });

  it('A9: every open order at Pending is listed, however many', () => {
    const rows = Array.from({ length: 70 }, (_, i) => old(`p-${i}`, 'PENDING'));
    const v = stationView(rows, 'pending', 0, null, false);
    expect(v.open).toHaveLength(70);
    expect(v.finished).toHaveLength(0);
    expect(v.hiddenFinished).toBe(0);
  });

  it('A10: Recurring lists every recurring order, finished and cancelled included', () => {
    const rows = [
      old('r-1', 'PENDING', WEEKLY),
      old('r-2', 'COMPLETED', WEEKLY),
      old('r-3', 'CANCELLED', WEEKLY),
      old('one-1', 'PENDING'),
    ];
    const v = stationView(rows, 'recurring', 0, null, false);
    expect(ids(v.open).sort()).toEqual(['r-1', 'r-2', 'r-3']);
    expect(v.finished).toHaveLength(0);
    expect(v.hiddenFinished).toBe(0);
  });

  it('A10c: a recurring open arrival is first in Delivered and under Recurring; not in All (fork 5)', () => {
    const rows = [
      ...finished(5),
      old('r-1', 'DELIVERED', WEEKLY),
      old('occ-1', 'DELIVERED', {
        recurrenceFrequency: null,
        recurrenceParentOrderId: 'r-1',
        recurrenceOccurrenceOn: '2026-09-29',
      }),
    ];
    const recurring = stationView(rows, 'recurring', 0, null, false);
    expect(ids(recurring.open)).toEqual(['r-1']);
    expect(recurring.open[0].mark?.text).toBe('Not counted yet');
    const delivered = stationView(rows, 'delivered', 0, null, false);
    expect(ids(delivered.open)).toEqual(['r-1', 'occ-1']);
    expect(delivered.open[0].mark?.text).toBe('Not counted yet');
    expect(ids(stationView(rows, null, 0, null, false).open)).toEqual(['occ-1']);
  });

  it('A10d: a recurring backorder is first in Delivered; a finished recurring delivery is not (fork 5)', () => {
    const rows = [
      ...finished(5),
      old('r-pr', 'PARTIALLY_RECEIVED', WEEKLY),
      old('r-done', 'COMPLETED', WEEKLY),
    ];
    const delivered = stationView(rows, 'delivered', 5, null, false);
    expect(ids(delivered.open)).toEqual(['r-pr']);
    expect(ids(delivered.finished)).not.toContain('r-done');
    expect(delivered.hiddenFinished + delivered.finished.length).toBe(5);
    expect(ids(stationView(rows, 'recurring', 0, null, false).open).sort()).toEqual(['r-done', 'r-pr']);
    for (const station of [null, 'pending', 'approved', 'ordered'] as const) {
      const v = stationView(rows, station, 5, null, false);
      expect(ids([...v.open, ...v.finished])).not.toContain('r-pr');
    }
    // Delivered's count is one-time orders only: the recurring arrival it lists is not in it.
    const f = figuresFor(book({ rows: [], total: rows.length }), rows, new Date(2026, 8, 20));
    expect(f.counts.delivered).toBe(5);
    expect(f.recurringCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// orderBookErrorWords
// ---------------------------------------------------------------------------

describe('orderBookErrorWords', () => {
  it('A10b: says each failure in the house words, never the error message', () => {
    const noResponse = new AxiosError('Network Error', 'ERR_NETWORK', undefined, {});
    const said = [
      [new RateLimitedError(10_000), 'too many reads in a short time'],
      [new ForeignRowError(), 'an order of another house came back, so nothing from that read was used'],
      [new BookShapeError('page 3 is not a page'), 'an answer came back that this screen cannot read'],
      [new HouseChangedError(), 'the house was switched during the read'],
      [{ response: { status: 503 } }, 'an error came back, code 503'],
      [noResponse, 'no answer came back'],
      [new TypeError('x'), 'something unexpected went wrong while reading'],
    ] as const;
    for (const [error, words] of said) {
      expect(orderBookErrorWords(error)).toBe(words);
      expect(orderBookErrorWords(error)).not.toMatch(HOUSE_WORDS);
    }
  });
});

// ---------------------------------------------------------------------------
// The hook on the fake gateway
// ---------------------------------------------------------------------------

describe('useOrdersNextData on the order book', () => {
  it('A11: lists an order past the 50 the list answers by default, and counts the whole read', async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 150, (i) => (i === 149 ? 'IN_TRANSIT' : 'COMPLETED')));
    const { hook } = mount(HOUSE_A);
    await advance(500);
    const data = hook.result.current;
    expect(data.rows.map((r) => r.id)).toContain('o-00149');
    expect(data.counts.ordered).toBe(1);
    expect(data.counts.delivered).toBe(149);
    expect(data.book.mode).toBe('whole');
    expect(data.book.total).toBe(150);
    expect(typeof data.dataUpdatedAt).toBe('number');
  });

  it('A12: every row carries the mark its order owes', async () => {
    const received = (r: Record<string, unknown>) => ({ received: r });
    gw.rows = dated(
      makeOrders(HOUSE_A, 6).map((o, i) =>
        [
          { ...o, status: 'DELIVERED' },
          { ...o, status: 'PARTIALLY_RECEIVED', ...received({ readable: true, verifiedAt: null }) },
          { ...o, status: 'PARTIALLY_RECEIVED', ...received({ readable: true, verifiedAt: '2026-09-29T10:00:00Z', backorderBottles: 3 }) },
          { ...o, status: 'PARTIALLY_RECEIVED', ...received({ readable: true, verifiedAt: '2026-09-29T10:00:00Z', backorderBottles: 0 }) },
          { ...o, status: 'PARTIALLY_RECEIVED', ...received({ readable: false }) },
          { ...o, status: 'COMPLETED' },
        ][i] as unknown as Order,
      ),
    );
    const { hook } = mount(HOUSE_A);
    await advance(500);
    const mark = (id: string) => hook.result.current.rows.find((r) => r.id === id)?.mark ?? null;
    expect(mark('o-00000')?.text).toBe('Not counted yet');
    expect(mark('o-00001')?.text).toBe('Counted, not checked yet');
    expect(mark('o-00002')?.text).toBe('Backorder: 3 bottles still owed');
    expect(mark('o-00003')?.text).toBe('Waiting on the invoice');
    expect(mark('o-00004')?.text).toBe('Receipt could not be read');
    expect(mark('o-00005')).toBeNull();
  });

  it("A13: a failed interval refresh over kept rows is said, and dated by the read, not the cache's write", async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 30));
    const { client, hook } = mount(HOUSE_A);
    await advance(500);
    const t0 = hook.result.current.dataUpdatedAt;
    const kept = client.getQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A))!;
    expect(t0).toBe(kept.readStartedAt);

    gw.before = (call) => (call.url === '/procurement/orders/history' ? { status: 500 } : undefined);
    await advance(BOOK_INTERVAL_MS + 500);
    expect(listReads()).toBe(2);
    const data = hook.result.current;
    expect(data.isError).toBe(true);
    expect(data.hasData).toBe(true);
    expect(data.errorMessage).toBe('the latest refresh failed');
    expect(data.dataUpdatedAt).toBe(t0);

    await act(async () => {
      client.setQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A), { ...kept, rows: kept.rows.slice(1) });
    });
    await advance(10);
    expect(hook.result.current.rows).toHaveLength(29);
    expect(hook.result.current.dataUpdatedAt).toBe(t0);
  });

  it('A14: a row of another house is said in the house words', async () => {
    gw.scopeByToken = false;
    gw.rows = dated([...makeOrders(HOUSE_A, 5), ...makeOrders(HOUSE_B, 1, undefined, 'b')]);
    const { hook } = mount(HOUSE_A);
    await advance(500);
    expect(hook.result.current.isError).toBe(true);
    expect(hook.result.current.errorMessage).toBe(
      'an order of another house came back, so nothing from that read was used',
    );
    expect(hook.result.current.errorMessage).not.toMatch(HOUSE_WORDS);
  });

  it('A14b: a read that gave up on 429s says so in the house words', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      gw.rows = dated(makeOrders(HOUSE_A, 30));
      gw.before = (call) =>
        call.params.page === 1 ? { status: 429, data: { statusCode: 429, retryAfter: 10 } } : undefined;
      const { hook } = mount(HOUSE_A);
      await advance(20_500);
      expect(hook.result.current.errorMessage).toBe('too many reads in a short time');
    } finally {
      random.mockRestore();
    }
  });

  it('A16: a capped read counts what it can back, and Show older reads page 31 through the runner', async () => {
    gw.rows = dated(
      makeOrders(HOUSE_A, 3_100, (i) => (i < 20 ? 'PENDING' : i >= 3_095 ? 'CANCELLED' : 'COMPLETED')),
    );
    const { hook } = mount(HOUSE_A);
    await advance(61_500);
    let data = hook.result.current;
    expect(data.book.mode).toBe('capped');
    expect(data.counts.pending).toBe(20);
    expect(data.countsAreFloors).toBe(true);
    expect(data.counts.delivered).toBeNull();
    expect(data.recurringCount).toBeNull();
    expect(data.month.thisMonth).toBeNull();
    expect(data.cancelledCount).toBe(5);
    expect(data.book.deliveredAtLeast).toBe(2_980);
    expect(data.book.older.canRead).toBe(true);
    expect(data.rows.some((r) => r.id === 'o-03000')).toBe(false);

    const before = listReads();
    let ok: boolean | undefined;
    await act(async () => {
      void data.book.older.read(50).then((r) => (ok = r));
    });
    await advance(1_000);
    data = hook.result.current;
    expect(ok).toBe(true);
    expect(data.rows.some((r) => r.id === 'o-03000')).toBe(true);
    expect(listReads()).toBe(before + 1);
    expect(gw.listCalls().at(-1)!.params).toMatchObject({ page: 31, limit: 100 });
    expect(data.book.older.canRead).toBe(false);
    // Older rows are listed, never counted.
    expect(data.book.deliveredAtLeast).toBe(2_980);
    expect(data.cancelledCount).toBe(5);
  });

  it('A17: a house switch aborts an older read under way, and no row of the old house reaches the new one', async () => {
    gw.rows = dated([
      ...makeOrders(HOUSE_A, 3_100),
      ...makeOrders(HOUSE_B, 120, undefined, 'b'),
    ]);
    const { hook } = mount(HOUSE_A);
    await advance(61_500);
    expect(hook.result.current.book.older.canRead).toBe(true);

    gw.before = (call) => (call.params.page === 31 ? { wait: new Promise<void>(() => {}) } : undefined);
    let ok: boolean | undefined;
    await act(async () => {
      void hook.result.current.book.older.read(50).then((r) => (ok = r));
    });
    await advance(500);
    const held = gw.listCalls().at(-1)!;
    expect(held.params.page).toBe(31);

    signInAs(HOUSE_B);
    authAs(HOUSE_B);
    hook.rerender({ id: null });
    await advance(1_000);
    expect(held.signal?.aborted).toBe(true);
    expect(ok).toBe(false);
    const rows = hook.result.current.rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id.startsWith('b-'))).toBe(true);
  });

  it('A18: rows are dated by requestedAt: newest first, and the month split by it', async () => {
    vi.setSystemTime(new Date(2026, 9, 1, 12));
    const first = new Date(2026, 9, 1, 0, 0, 30).getTime();
    gw.rows = makeOrders(HOUSE_A, 160).map((o, i) => {
      const iso = new Date(first - i * 60_000).toISOString();
      return { ...o, createdAt: iso, requestedAt: iso, totalCost: 10 } as unknown as Order;
    });
    const { hook } = mount(HOUSE_A);
    await advance(500);
    const data = hook.result.current;
    const shown = stationView(data.rows, 'delivered', 0, null, false).finished.map((r) => r.id);
    expect(shown).toEqual(Array.from({ length: 50 }, (_, i) => `o-${String(i).padStart(5, '0')}`));
    expect(data.month.thisMonth).toBe(10);
    expect(data.month.lastMonth).toBe(1_590);
  });

  it('A19: a looked-up row is counted with the rows the empty-station sentence compares it with', async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 10)).map((o) => ({ ...o, recurrenceFrequency: null }) as unknown as Order);
    const late = order('late-1', 'COMPLETED', { recurrenceFrequency: null });
    gw.before = (call) => (call.url === '/procurement/orders/late-1' ? { data: late } : undefined);
    const { hook } = mount(HOUSE_A, 'late-1');
    await advance(500);
    await advance(10);
    const data = hook.result.current;
    expect(data.target.state).toBe('found');
    expect(data.rows).toHaveLength(11);
    expect(data.recurrenceReadCount).toBe(11);
  });
});

describe('a deep-linked order that is not among the rows read (A15)', () => {
  const late = order('late-1', 'COMPLETED');

  it('(a) is asked for on its own, keeps asking through a failure, and is listed but never counted', async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 20, (i) => (i < 5 ? 'PENDING' : 'COMPLETED')));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let asked = 0;
    gw.before = (call) => {
      if (call.url !== '/procurement/orders/late-1') return undefined;
      asked++;
      return asked === 1 ? { wait: held } : { data: late };
    };
    const { hook } = mount(HOUSE_A, 'late-1');
    expect(hook.result.current.target.state).toBe('none');
    await advance(500);
    expect(hook.result.current.target.state).toBe('checking');
    const counts = hook.result.current.counts;
    // The first answer is the fake's own: a 500, the gateway's "not found".
    release();
    await advance(10);
    expect(hook.result.current.target.state).toBe('checking');
    await advance(1_000);
    expect(hook.result.current.target.state).toBe('found');
    expect(byIdCalls('late-1')).toBe(2);
    expect(hook.result.current.rows.map((r) => r.id)).toContain('late-1');
    expect(hook.result.current.counts).toEqual(counts);
    expect(hook.result.current.book.readCount).toBe(20);
  });

  it('(b) after three failed tries says it could not be read, and Try again asks again', async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 20));
    let found = false;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // Once found, the next ask is held, then answered by the fake from its rows.
    gw.before = (call) =>
      call.url === '/procurement/orders/late-1' && found ? { wait: held } : undefined;
    const { hook } = mount(HOUSE_A, 'late-1');
    await advance(500);
    expect(byIdCalls('late-1')).toBe(1);
    expect(hook.result.current.target.state).toBe('checking');
    await advance(1_000);
    expect(byIdCalls('late-1')).toBe(2);
    expect(hook.result.current.target.state).toBe('checking');
    await advance(2_000);
    await advance(10);
    expect(byIdCalls('late-1')).toBe(3);
    const target = hook.result.current.target;
    expect(target.state).toBe('unreadable');
    await advance(10_000);
    expect(byIdCalls('late-1')).toBe(3);

    found = true;
    gw.rows = [...gw.rows, late];
    await act(async () => {
      if (target.state === 'unreadable') target.retry();
    });
    await advance(10);
    expect(hook.result.current.target.state).toBe('checking');
    release();
    await advance(10);
    expect(hook.result.current.target.state).toBe('found');
    expect(byIdCalls('late-1')).toBe(4);
  });

  it("(c) another house's order cannot be read: unreadable after three tries", async () => {
    gw.rows = dated([...makeOrders(HOUSE_A, 20), ...makeOrders(HOUSE_B, 5, undefined, 'b')]);
    const { hook } = mount(HOUSE_A, 'b-00001');
    await advance(500);
    await advance(1_000);
    await advance(2_000);
    await advance(10);
    expect(hook.result.current.target.state).toBe('unreadable');
    expect(byIdCalls('b-00001')).toBe(3);
    expect(hook.result.current.rows.some((r) => r.id === 'b-00001')).toBe(false);
  });

  it('(d) once found it is not asked for again when the rows are read again', async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 20));
    gw.before = (call) => (call.url === '/procurement/orders/late-1' ? { data: late } : undefined);
    const { client, hook } = mount(HOUSE_A, 'late-1');
    await advance(500);
    await advance(10);
    expect(hook.result.current.target.state).toBe('found');
    const reads = listReads();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        void client.invalidateQueries({ queryKey: ['orders'] });
      });
      await advance(1_000);
    }
    expect(listReads()).toBe(reads + 2);
    expect(byIdCalls('late-1')).toBe(1);
    expect(hook.result.current.target.state).toBe('found');
  });

  it('(e) is not asked for while the read itself failed', async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 20));
    gw.before = (call) => (call.url === '/procurement/orders/history' ? { status: 500 } : undefined);
    const { hook } = mount(HOUSE_A, 'late-1');
    await advance(5_000);
    expect(hook.result.current.isError).toBe(true);
    expect(hook.result.current.target.state).toBe('none');
    expect(byIdCalls('late-1')).toBe(0);
  });

  it('(f) is not asked for while a re-read over kept rows failed', async () => {
    gw.rows = dated(makeOrders(HOUSE_A, 20));
    const { client, hook } = mount(HOUSE_A);
    await advance(500);
    expect(hook.result.current.hasData).toBe(true);
    gw.before = (call) => (call.url === '/procurement/orders/history' ? { status: 500 } : undefined);
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] });
    });
    await advance(5_000);
    expect(hook.result.current.isError).toBe(true);
    expect(hook.result.current.hasData).toBe(true);
    hook.rerender({ id: 'late-1' });
    await advance(5_000);
    expect(hook.result.current.target.state).toBe('none');
    expect(byIdCalls('late-1')).toBe(0);
  });
});
