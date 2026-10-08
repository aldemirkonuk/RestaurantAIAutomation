/**
 * What a station lists once /orders reads every order (F-140, ADR 0269 PR-B):
 * every open order first, with its mark; finished ones behind Show older, 50 a
 * tap; the newest 50 at once when nothing is open; cancelled ones never; and a
 * read that did not cover every order says so, one fact a line.
 *
 * The data hook is mocked; `stationView` and `OLDER_STEP` stay real (the mock
 * spreads `importOriginal`), so what is listed is the module's own rule.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('./useOrdersNextData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useOrdersNextData')>();
  return { ...actual, useOrdersNextData: () => state.current };
});

vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/queries/useDraftEmailQueries', () => ({
  useActiveConversations: () => ({ data: [], isError: false }),
  useDraftStanding: () => ({ data: undefined, isPending: true, isError: false }),
  useEditDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useOrderConversations: () => ({ data: [], isError: false }),
  useApproveDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCancelScheduledSend: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/mudavym/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mudavym/motion')>()),
  useReducedMotion: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'rest-A',
    user: { userId: 'u1', restaurantId: 'rest-A', role: 'owner' },
  }),
}));

import OrdersNext from './OrdersNext';
import { RECURRENCE_UNREAD } from './recurrence';
import type { BookStateView, OrderRowVM, OrdersNextData } from './useOrdersNextData';
import { markFor } from '@/services/api/order-book';
import type { Order } from '@/services/api/types';

/** Newest first by index: hour `i` before 2026-09-30 12:00 UTC. */
const at = (i: number) => new Date(Date.UTC(2026, 8, 30, 12) - i * 3_600_000).toISOString();

function row(over: Partial<OrderRowVM> = {}): OrderRowVM {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00001',
    wineName: 'Barolo Riserva',
    producer: null,
    providerName: 'Anadolu',
    quantity: 5,
    unitPrice: 400,
    bottlesTotal: 5,
    unitType: 'bottle',
    priceUnit: { read: true, stated: { priceUom: 'bottle', pricePackSize: 1 } },
    fees: { read: true, fees: { allowance: null, deposit: null, freight: null } },
    agreement: { ok: true, goods: 2000, total: 2000, working: '5 × $400.00 per bottle.' },
    computedTotal: 2000,
    listedTotal: 2000,
    total: 2000,
    stage: 'pending',
    status: 'pending',
    mark: null,
    recurring: false,
    recurrence: RECURRENCE_UNREAD,
    recurrenceLabel: null,
    requestedAt: at(0),
    approvedAt: null,
    deliveredAt: null,
    notes: null,
    ...over,
  };
}

/** The founder's marks, from PR-A's `markFor` itself. */
const MARK = {
  notCounted: markFor({ status: 'DELIVERED' } as Order),
  backorder: markFor({
    status: 'PARTIALLY_RECEIVED',
    received: { readable: true, verifiedAt: '2026-09-29T10:00:00Z', backorderBottles: 3 },
  } as unknown as Order),
  countedNotChecked: markFor({
    status: 'PARTIALLY_RECEIVED',
    received: { readable: true, verifiedAt: null },
  } as unknown as Order),
  awaitingInvoice: markFor({
    status: 'PARTIALLY_RECEIVED',
    received: { readable: true, verifiedAt: '2026-09-29T10:00:00Z', backorderBottles: 0 },
  } as unknown as Order),
  unreadable: markFor({ status: 'PARTIALLY_RECEIVED', received: { readable: false } } as unknown as Order),
};

/** `n` finished deliveries, `f-000`… newest first, from hour `from` back. */
function finished(n: number, from = 0, prefix = 'f'): OrderRowVM[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      id: `${prefix}-${String(i).padStart(3, '0')}`,
      orderNumber: `ORD-${prefix}-${i}`,
      stage: 'delivered',
      status: 'completed',
      requestedAt: at(from + i),
    }),
  );
}

/** An open arrival at Delivered, carrying its mark. */
function arrival(id: string, mark: OrderRowVM['mark'], hour: number): OrderRowVM {
  return row({
    id,
    orderNumber: `ORD-${id}`,
    stage: 'delivered',
    status: mark?.kind === 'not_counted' ? 'delivered' : 'partially_received',
    mark,
    requestedAt: at(hour),
  });
}

function whole(n: number, over: Partial<BookStateView> = {}): BookStateView {
  return {
    mode: 'whole',
    total: n,
    readCount: n,
    openComplete: true,
    unreadableStates: null,
    deliveredAtLeast: null,
    recurringAtLeast: null,
    older: { canRead: false, reading: false, error: null, read: vi.fn() },
    ...over,
  };
}

function capped(over: Partial<BookStateView> = {}): BookStateView {
  return whole(3000, {
    mode: 'capped',
    total: 3412,
    readCount: 3005,
    unreadableStates: 0,
    deliveredAtLeast: 2980,
    recurringAtLeast: 4,
    older: { canRead: true, reading: false, error: null, read: vi.fn() },
    ...over,
  });
}

function ordersData(rows: OrderRowVM[], over: Partial<OrdersNextData> = {}): OrdersNextData {
  return {
    rows,
    counts: { pending: 0, approved: 0, ordered: 0, delivered: 0 },
    recurringCount: 0,
    recurrenceReadCount: 0,
    cancelledCount: 0,
    month: { thisMonth: 0, lastMonth: null, unpricedThisMonth: 0 },
    hasData: true,
    isLoading: false,
    isError: false,
    errorMessage: null,
    refetch: vi.fn(),
    approvalByOrder: new Map(),
    approvalGateError: null,
    approvalPolicyNote: null,
    dataUpdatedAt: Date.UTC(2026, 9, 1, 9, 30),
    book: whole(rows.length),
    target: { state: 'none' },
    ...over,
  };
}

function harness(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/orders/:id" element={<OrdersNext />} />
          <Route path="/orders" element={<OrdersNext />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, again: () => view.rerender(tree()) };
}

/** The ids listed, top to bottom. */
const listed = () =>
  Array.from(document.querySelectorAll('[id^="order-row-"]')).map((el) =>
    el.id.slice('order-row-'.length),
  );

const showOlder = () => screen.queryByTestId('show-older');
const tab = (name: RegExp) => screen.getByRole('tab', { name });

beforeEach(() => {
  state.current = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Delivered: open arrivals first, finished behind Show older', () => {
  it('B1: lists the open ones with their marks, then 50 finished a tap, to the end', () => {
    const open = [arrival('a-1', MARK.backorder, 500), arrival('a-2', MARK.countedNotChecked, 501)];
    state.current = ordersData([...finished(120), ...open]);
    harness('/orders?station=delivered');

    expect(listed()).toEqual(['a-1', 'a-2']);
    const marks = screen.getAllByTestId('order-mark');
    expect(marks.map((m) => m.textContent)).toEqual([
      'Backorder: 3 bottles still owed',
      'Counted, not checked yet',
    ]);
    expect(screen.queryByTestId('finished-label')).not.toBeInTheDocument();
    expect(showOlder()).toHaveTextContent('Show older (120 more)');

    fireEvent.click(showOlder()!);
    expect(screen.getByTestId('finished-label')).toHaveTextContent('Finished deliveries');
    expect(listed()).toHaveLength(52);
    expect(listed().slice(0, 3)).toEqual(['a-1', 'a-2', 'f-000']);
    expect(showOlder()).toHaveTextContent('Show older (70 more)');

    fireEvent.click(showOlder()!);
    fireEvent.click(showOlder()!);
    expect(listed()).toHaveLength(122);
    expect(showOlder()).not.toBeInTheDocument();
  });

  it('B2: with nothing open, the newest 50 show at once, and no empty sentence', () => {
    state.current = ordersData(finished(70));
    harness('/orders?station=delivered');
    expect(listed()).toHaveLength(50);
    expect(listed()[0]).toBe('f-000');
    expect(showOlder()).toHaveTextContent('Show older (20 more)');
    expect(screen.queryByText(/Nothing sits at/)).not.toBeInTheDocument();
  });

  it('B3: once opened on its newest 50, an open order arriving later does not fold them away', () => {
    state.current = ordersData(finished(70));
    const page = harness('/orders?station=delivered');
    expect(listed()).toHaveLength(50);

    state.current = ordersData([...finished(70), arrival('a-1', MARK.notCounted, 0)]);
    page.again();
    expect(listed()).toHaveLength(51);
    expect(listed()[0]).toBe('a-1');
  });

  it('B3b: a station that first had an open arrival still opens on 50 once nothing is open', () => {
    const open = arrival('a-1', MARK.notCounted, 0);
    state.current = ordersData([...finished(70, 1), open]);
    const page = harness('/orders?station=delivered');
    expect(listed()).toEqual(['a-1']);
    expect(showOlder()).toBeInTheDocument();

    state.current = ordersData([
      ...finished(70, 1),
      { ...open, status: 'completed', mark: null },
    ]);
    page.again();
    expect(listed()).toHaveLength(50);
  });

  it('B13: nothing open, 120 finished: 50, then 100, then 120 and no button', () => {
    state.current = ordersData(finished(120));
    harness('/orders?station=delivered');
    expect(listed()).toHaveLength(50);
    fireEvent.click(showOlder()!);
    expect(listed()).toHaveLength(100);
    fireEvent.click(showOlder()!);
    expect(listed()).toHaveLength(120);
    expect(showOlder()).not.toBeInTheDocument();
  });
});

describe('cancelled orders, other stations and the All view', () => {
  it('B4: cancelled and rejected orders are never listed, however far Show older goes', () => {
    const gone = [
      ...['c-1', 'c-2', 'c-3', 'c-4'].map((id, i) =>
        row({ id, stage: 'cancelled', status: 'cancelled', requestedAt: at(i) }),
      ),
      row({ id: 'r-1', stage: 'cancelled', status: 'rejected', requestedAt: at(5) }),
    ];
    state.current = ordersData([...finished(60, 10), ...gone], { cancelledCount: 5 });
    harness('/orders');
    while (showOlder()) fireEvent.click(showOlder()!);
    expect(listed()).toHaveLength(60);
    for (const id of ['c-1', 'c-2', 'c-3', 'c-4', 'r-1']) {
      expect(screen.queryByTestId(`order-row-${id}`)).not.toBeInTheDocument();
    }
    expect(screen.getByText('5 cancelled — kept in the book, off the figures.')).toBeInTheDocument();
  });

  it('B5: a station change starts Show older again at none, and resets the first-50 latch', () => {
    state.current = ordersData(finished(70));
    const page = harness('/orders?station=delivered');
    fireEvent.click(showOlder()!);
    expect(listed()).toHaveLength(70);

    fireEvent.click(tab(/pending/i));
    state.current = ordersData([...finished(70, 1), arrival('a-1', MARK.notCounted, 0)]);
    page.again();
    fireEvent.click(tab(/delivered/i));
    expect(listed()).toEqual(['a-1']);
  });

  it('B6: the All view lists the open orders of every stage first', () => {
    const open = [
      row({ id: 'p-1', stage: 'pending', status: 'pending', requestedAt: at(200) }),
      row({ id: 'ap-1', stage: 'approved', status: 'approved', requestedAt: at(201) }),
      row({ id: 'or-1', stage: 'ordered', status: 'in_transit', requestedAt: at(202) }),
      arrival('a-1', MARK.notCounted, 203),
    ];
    state.current = ordersData([...finished(60), ...open]);
    harness('/orders');
    expect(listed()).toEqual(['p-1', 'ap-1', 'or-1', 'a-1']);
    expect(showOlder()).toHaveTextContent('Show older (60 more)');
  });

  it('B7: Pending lists every one of 70 orders, with no Show older', () => {
    state.current = ordersData(
      Array.from({ length: 70 }, (_, i) =>
        row({ id: `p-${i}`, stage: 'pending', status: 'pending', requestedAt: at(i) }),
      ),
    );
    harness('/orders?station=pending');
    expect(listed()).toHaveLength(70);
    expect(showOlder()).not.toBeInTheDocument();
  });

  it('B12: a deep-linked finished order is listed wherever it falls, before any tap', () => {
    const rows = [...finished(120, 1), arrival('a-1', MARK.notCounted, 0)];
    state.current = ordersData(rows, { target: { state: 'none' } });
    harness('/orders/f-079');
    expect(listed()).toEqual(['a-1', 'f-079']);
  });

  it('B15: a cancelled recurring order is listed under Recurring and is not said to be unlisted', () => {
    const weekly = {
      ...RECURRENCE_UNREAD,
      read: true,
      frequency: 'weekly' as const,
    };
    state.current = ordersData(
      [row({ id: 'rc-1', stage: 'cancelled', status: 'cancelled', recurring: true, recurrence: weekly })],
      { recurringCount: 1, recurrenceReadCount: 1, cancelledCount: 1 },
    );
    const page = harness('/orders/rc-1');
    expect(screen.getByTestId('order-row-rc-1')).toBeInTheDocument();
    expect(screen.queryByTestId('target-order-cancelled')).not.toBeInTheDocument();
    page.unmount();

    state.current = ordersData([row({ id: 'c-1', stage: 'cancelled', status: 'cancelled' })], {
      cancelledCount: 1,
    });
    harness('/orders/c-1');
    expect(screen.getByTestId('target-order-cancelled')).toBeInTheDocument();
  });
});

describe('a read that did not cover every order', () => {
  it('B8: capped, every open order read: says so a fact a line, and Show older names no count', () => {
    state.current = ordersData(finished(60), {
      book: capped(),
      counts: { pending: 0, approved: 0, ordered: 0, delivered: null },
      recurringCount: null,
      month: { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 },
    });
    harness('/orders?station=delivered');
    const notice = screen.getByTestId('orders-read-notice');
    expect(notice).toHaveTextContent(
      'This house has 3,412 orders, more than this screen reads at once. The newest 3,000 are read; older finished orders come in under Show older.',
    );
    expect(notice).toHaveTextContent('Every open order is listed.');
    expect(notice).toHaveTextContent(
      'Delivered, Recurring and the month figures show — because not every order was read. At least 2,980 delivered and 4 recurring orders were read.',
    );
    expect(tab(/delivered/i)).toHaveTextContent('—');
    expect(listed()).toHaveLength(50);
    expect(showOlder()!.textContent).toBe('Show older');
  });

  it('B9: partial, open orders maybe missing, two unreadable states', () => {
    state.current = ordersData(finished(10), {
      book: whole(10, {
        mode: 'partial',
        total: 900,
        readCount: 10,
        openComplete: false,
        unreadableStates: 2,
        deliveredAtLeast: 10,
        recurringAtLeast: 0,
      }),
    });
    harness('/orders');
    const notice = screen.getByTestId('orders-read-notice');
    expect(notice).toHaveTextContent(
      'The orders kept changing while they were read, so some finished orders may be missing from this list.',
    );
    expect(notice).toHaveTextContent('Some open orders may be missing.');
    expect(notice).toHaveTextContent('2 orders are in a state this screen cannot read.');
    expect(notice).toHaveTextContent(
      'Every count and the month figures show — because not every order was read. At least 10 delivered and 0 recurring orders were read.',
    );
  });

  it('B10: past the cap, a tap reads older orders and counts once they are in', async () => {
    const read = vi.fn().mockResolvedValue(true);
    state.current = ordersData(finished(10), { book: capped({ older: { canRead: true, reading: false, error: null, read } }) });
    const page = harness('/orders?station=delivered');
    expect(listed()).toHaveLength(10);
    await act(async () => {
      fireEvent.click(showOlder()!);
    });
    // 50 for the tap, plus the 50 a station with nothing open opens on, less the 10 read.
    expect(read).toHaveBeenCalledWith(90);

    state.current = ordersData(finished(120), { book: capped({ older: { canRead: true, reading: false, error: null, read } }) });
    page.again();
    expect(listed()).toHaveLength(100);

    state.current = ordersData(finished(10), { book: capped({ older: { canRead: true, reading: true, error: null, read } }) });
    page.again();
    expect(showOlder()).toHaveTextContent('Reading older orders…');
    expect(showOlder()).toBeDisabled();

    state.current = ordersData(finished(10), {
      book: capped({ older: { canRead: true, reading: false, error: 'no answer came back', read } }),
    });
    page.again();
    expect(screen.getByTestId('show-older-error')).toHaveTextContent(
      'Older orders could not be read (no answer came back). Show older tries again.',
    );
  });

  it('B14: a failed older read leaves the tap unspent, and a read that lands after a station change counts for nothing', async () => {
    const read = vi.fn().mockResolvedValue(false);
    state.current = ordersData(finished(10), { book: capped({ older: { canRead: true, reading: false, error: null, read } }) });
    const page = harness('/orders?station=delivered');
    await act(async () => {
      fireEvent.click(showOlder()!);
    });
    expect(listed()).toHaveLength(10);
    await act(async () => {
      fireEvent.click(showOlder()!);
    });
    expect(read.mock.calls).toEqual([[90], [90]]);

    let land!: (ok: boolean) => void;
    read.mockReset();
    read.mockImplementation(() => new Promise<boolean>((r) => (land = r)));
    fireEvent.click(showOlder()!);
    fireEvent.click(tab(/pending/i));
    fireEvent.click(tab(/delivered/i));
    await act(async () => {
      land(true);
    });
    state.current = ordersData(finished(120), { book: capped({ older: { canRead: true, reading: false, error: null, read } }) });
    page.again();
    expect(listed()).toHaveLength(50);
  });

  it('B11: an empty station off a read that missed open orders does not say nothing sits there', () => {
    state.current = ordersData([], {
      book: whole(0, { mode: 'partial', total: 40, openComplete: false, deliveredAtLeast: 0, recurringAtLeast: 0 }),
    });
    harness('/orders?station=approved');
    expect(screen.getByTestId('orders-empty-incomplete')).toHaveTextContent(
      'Nothing here among the orders read. Some open orders may be missing.',
    );
    expect(screen.queryByText('Nothing sits at approved right now.')).not.toBeInTheDocument();
  });

  it('B11b: an empty Recurring station off a capped or partial read does not say none repeats', () => {
    const read = { ...RECURRENCE_UNREAD, read: true };
    const rows = Array.from({ length: 3000 }, (_, i) =>
      row({ id: `o-${i}`, stage: 'delivered', status: 'completed', recurrence: read, requestedAt: at(i) }),
    );
    const N9 = 'Not every order was read, so it cannot be said whether any order repeats.';
    for (const book of [capped(), whole(3000, { mode: 'partial', openComplete: true })]) {
      state.current = ordersData(rows, { book, recurringCount: null, recurrenceReadCount: 3000 });
      const page = harness('/orders?station=recurring');
      expect(screen.getByTestId('orders-empty-incomplete')).toHaveTextContent(N9);
      expect(screen.queryByText(/None of the 3000 orders/)).not.toBeInTheDocument();
      page.unmount();
    }
    state.current = ordersData(rows, { recurrenceReadCount: 3000 });
    harness('/orders?station=recurring');
    expect(screen.getByText('None of the 3000 orders in this book repeats.')).toBeInTheDocument();
    expect(screen.queryByTestId('orders-empty-incomplete')).not.toBeInTheDocument();
  });
});

describe('B16: new copy is in the house words', () => {
  it('no new sentence says book, page, gateway or API, or a wire status', async () => {
    const IDS = [
      'orders-read-notice',
      'show-older',
      'show-older-error',
      'target-order-checking',
      'target-order-missing',
      'orders-empty-incomplete',
      'finished-label',
      'order-mark',
    ];
    const seen = new Set<string>();
    const sweep = () => {
      for (const id of IDS) {
        for (const el of screen.queryAllByTestId(id)) {
          seen.add(id);
          expect(el.textContent).not.toMatch(/\b(book|page|gateway|api)\b/i);
          expect(el.textContent).not.toMatch(/PARTIALLY_RECEIVED|DELIVERED/);
        }
      }
    };
    const marks = [
      arrival('a-1', MARK.notCounted, 300),
      arrival('a-2', MARK.backorder, 301),
      arrival('a-3', MARK.countedNotChecked, 302),
      arrival('a-4', MARK.awaitingInvoice, 303),
      arrival('a-5', MARK.unreadable, 304),
    ];

    // Capped, unreadable states, an older read under way and one that failed, looking for a link.
    state.current = ordersData([...finished(60), ...marks], {
      book: capped({ unreadableStates: 2, older: { canRead: true, reading: true, error: 'no answer came back', read: vi.fn() } }),
      target: { state: 'checking' },
    });
    let page = harness('/orders/9f3c2a71-5b8e-4d10-a2c4-7e6f0b1d9a33');
    sweep();
    page.unmount();

    // Partial, a link that could not be read, an empty station.
    state.current = ordersData([], {
      book: whole(0, { mode: 'partial', total: 40, openComplete: false, deliveredAtLeast: 0, recurringAtLeast: 0 }),
      target: { state: 'unreadable', retry: vi.fn() },
    });
    page = harness('/orders/ghost-id');
    sweep();
    page.unmount();

    // Whole: S18, and Show older with its count and the finished label.
    state.current = ordersData([...finished(60), ...marks], { target: { state: 'unreadable', retry: vi.fn() } });
    page = harness('/orders/ghost-id');
    fireEvent.click(showOlder()!);
    sweep();
    page.unmount();

    // Recurring, empty, off a capped read.
    state.current = ordersData(finished(5), { book: capped() });
    page = harness('/orders?station=recurring');
    sweep();

    expect([...seen].sort()).toEqual([...IDS].sort());
  });
});
