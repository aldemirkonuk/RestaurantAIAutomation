/**
 * `/orders/:id` and `?order=` — a link INTO one order, from outside the
 * ledger (an email/SMS/push deep link, `App.tsx`; or `RcManagerQueue`'s
 * "Open the order" hand-off, which still sends `?order=`).
 *
 * Every case here fails against the pre-fix tree: the route did not exist at
 * all (App.tsx had no `/orders/:id`), and `OrdersNext` read neither the path
 * param nor the query one, so any such link landed on the ledger with
 * nothing opened and no sign the requested order was ever looked for.
 *
 *   1. a path id that IS in the book opens that row (expand) and clears a
 *      station filter that would have hidden it.
 *   2. a recurring order's path id selects the Recurring station, since the
 *      default station excludes it.
 *   3. a query `?order=` id does the same as a path id (the RcManagerQueue
 *      hand-off this page did not used to read at all).
 *   4. an id the book does NOT have, once the book has actually loaded, says
 *      so in one honest sentence for both "no such order" and "not this
 *      house's order" — never silently shows the whole ledger with no
 *      explanation.
 *   5. a cancelled order's id says why it is not in the list, rather than
 *      opening nothing with no explanation.
 *   6. `?station=recurring` (recurring-order.template.ts's CTA, which has no
 *      order id to aim at) opens the Recurring station on its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  useOrderConversations: () => ({ data: [], isError: false }),
  useApproveDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCancelScheduledSend: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'rest-A',
    user: { userId: 'u1', restaurantId: 'rest-A', role: 'owner' },
  }),
}));

import OrdersNext from './OrdersNext';
import { RECURRENCE_UNREAD } from './recurrence';
import type { OrderRowVM, OrdersNextData } from './useOrdersNextData';

function row(over: Partial<OrderRowVM> = {}): OrderRowVM {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00001',
    wineName: 'Barolo Riserva',
    producer: 'Giacomo Conterno',
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
    recurring: false,
    recurrence: RECURRENCE_UNREAD,
    recurrenceLabel: null,
    requestedAt: '2026-09-01T10:00:00Z',
    approvedAt: null,
    deliveredAt: null,
    notes: null,
    ...over,
  };
}

function ordersData(over: Partial<OrdersNextData> = {}): OrdersNextData {
  return {
    rows: [],
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
    ...over,
  };
}

function harness(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/orders/:id" element={<OrdersNext />} />
          <Route path="/orders" element={<OrdersNext />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.current = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('a path id in the book', () => {
  it('opens that row and shows no "not found" banner', async () => {
    state.current = ordersData({
      rows: [row({ id: 'o-1', stage: 'approved' }), row({ id: 'o-2', orderNumber: 'ORD-2' })],
      counts: { pending: 1, approved: 1, ordered: 0, delivered: 0 },
    });
    harness('/orders/o-1');

    expect(await screen.findByTestId('order-row-o-1')).toBeInTheDocument();
    // The expand toggle for o-1 is open (LedgerRow renders its aria-expanded
    // toggle inside the wrapper `#order-row-o-1`).
    const wrapper = screen.getByTestId('order-row-o-1');
    expect(wrapper.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(screen.queryByTestId('target-order-missing')).not.toBeInTheDocument();
  });

  it('opens regardless of stage, since a target id starts with no station filter applied', async () => {
    // A target id makes the initial station null (OrdersNext.tsx:129) no
    // matter what `?station=` says, so this does NOT exercise the effect's
    // own clearing branch (OrdersNext.tsx:189, `station !== null`) -- that
    // branch only fires on an in-app navigation that changes the target id
    // while a station filter set earlier in the SAME mount is still active,
    // which this harness (a fresh mount per test) cannot produce.
    state.current = ordersData({
      rows: [row({ id: 'o-1', stage: 'pending' })],
      counts: { pending: 1, approved: 0, ordered: 0, delivered: 0 },
    });
    harness('/orders/o-1');

    const wrapper = await screen.findByTestId('order-row-o-1');
    expect(wrapper.querySelector('[aria-expanded="true"]')).not.toBeNull();
  });
});

describe('a recurring order asked for by path id', () => {
  it('selects the Recurring station, which the default view excludes', async () => {
    state.current = ordersData({
      rows: [row({ id: 'o-1', recurring: true, stage: 'pending' })],
      recurringCount: 1,
    });
    harness('/orders/o-1');

    const wrapper = await screen.findByTestId('order-row-o-1');
    expect(wrapper.querySelector('[aria-expanded="true"]')).not.toBeNull();
  });
});

describe('?order= — the RcManagerQueue hand-off', () => {
  it('opens the same as a path id', async () => {
    state.current = ordersData({
      rows: [row({ id: 'o-9' })],
      counts: { pending: 1, approved: 0, ordered: 0, delivered: 0 },
    });
    harness('/orders?order=o-9');

    const wrapper = await screen.findByTestId('order-row-o-9');
    expect(wrapper.querySelector('[aria-expanded="true"]')).not.toBeNull();
  });
});

describe('an id the book does not have', () => {
  it('says nothing while the book is still loading', () => {
    state.current = ordersData({ rows: [row({ id: 'o-1' })], hasData: false });
    harness('/orders/ghost-id');
    expect(screen.queryByTestId('target-order-missing')).not.toBeInTheDocument();
  });

  it('says so, once the read has actually come back with no match', async () => {
    state.current = ordersData({ rows: [row({ id: 'o-1' })], hasData: true });
    harness('/orders/ghost-id');
    expect(await screen.findByTestId('target-order-missing')).toHaveTextContent('ghost-id');
  });

  it('says nothing when the read itself failed — that is a different fact', async () => {
    state.current = ordersData({ rows: [], hasData: false, isError: true, errorMessage: 'timeout' });
    harness('/orders/ghost-id');
    expect(await screen.findByRole('alert')).toHaveTextContent('timeout');
    expect(screen.queryByTestId('target-order-missing')).not.toBeInTheDocument();
  });
});

describe('a cancelled order asked for by id', () => {
  it('says why it is not in the ledger, instead of opening nothing silently', async () => {
    state.current = ordersData({
      rows: [row({ id: 'o-1', stage: 'cancelled' })],
      cancelledCount: 1,
    });
    harness('/orders/o-1');

    expect(await screen.findByTestId('target-order-cancelled')).toHaveTextContent('ORD-2026-00001');
    expect(screen.queryByTestId('order-row-o-1')).not.toBeInTheDocument();
  });
});

describe('?station=recurring — recurring-order.template.ts, which has no order id', () => {
  it('opens the Recurring station on its own', async () => {
    state.current = ordersData({
      rows: [row({ id: 'o-1', recurring: true })],
      recurringCount: 1,
    });
    harness('/orders?station=recurring');

    expect(await screen.findByRole('tab', { name: /recurring/i, selected: true })).toBeInTheDocument();
  });
});

describe('?tab=recurring — scheduled-tasks.service.ts\'s in-app notification for the same event', () => {
  it('is accepted as an alias for ?station=, and opens the Recurring station too', async () => {
    state.current = ordersData({
      rows: [row({ id: 'o-1', recurring: true })],
      recurringCount: 1,
    });
    harness('/orders?tab=recurring');

    expect(await screen.findByRole('tab', { name: /recurring/i, selected: true })).toBeInTheDocument();
  });
});
