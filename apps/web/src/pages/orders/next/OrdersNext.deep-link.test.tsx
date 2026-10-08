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
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ current: null as unknown, drafts: [] as unknown[], reducedMotion: true }));

vi.mock('./useOrdersNextData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useOrdersNextData')>();
  return { ...actual, useOrdersNextData: () => state.current };
});

vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/queries/useDraftEmailQueries', () => ({
  useActiveConversations: () => ({ data: state.drafts, isError: false }),
  useDraftStanding: () => ({ data: undefined, isPending: true, isError: false }),
  useEditDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useOrderConversations: () => ({ data: [], isError: false }),
  useApproveDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCancelScheduledSend: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

// jsdom has no Element.animate; the draft card's reveal is skipped under
// reduced motion (as DraftRail.test.tsx does). One month-figure case turns
// motion on, with no drafts on the page, to watch the Tally.
vi.mock('@/lib/mudavym/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mudavym/motion')>()),
  useReducedMotion: () => state.reducedMotion,
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
    month: { thisMonth: [], lastMonth: null, unpricedThisMonth: 0 },
    hasData: true,
    isLoading: false,
    isError: false,
    errorMessage: null,
    refetch: vi.fn(),
    approvalByOrder: new Map(),
    approvalGateError: null,
    approvalPolicyNote: null,
    dataUpdatedAt: null,
    ...over,
  };
}

function harness(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/orders/:id" element={<OrdersNext />} />
          <Route path="/orders" element={<OrdersNext />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  // Re-renders the same tree, so the page reads `state.current` again.
  return { ...view, again: () => view.rerender(tree()) };
}

beforeEach(() => {
  state.current = null;
  state.drafts = [];
  state.reducedMotion = true;
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

describe('a read that fails (ORD-W15)', () => {
  it('a first read that fails calls every figure unknown', async () => {
    state.current = ordersData({ rows: [], hasData: false, isError: true, errorMessage: 'timeout' });
    harness('/orders');
    const say = await screen.findByTestId('orders-read-error');
    expect(say).toHaveTextContent('The orders could not be read (timeout)');
    expect(say).toHaveTextContent('Every figure on this page is unknown');
  });

  it('a re-read that fails over kept rows says how old they are, not that they are unknown', async () => {
    const at = new Date();
    at.setHours(17, 58, 0, 0);
    state.current = ordersData({
      rows: [row({ id: 'o-1' })],
      hasData: true,
      isError: true,
      errorMessage: 'Network Error',
      dataUpdatedAt: at.getTime(),
    });
    harness('/orders');
    const say = await screen.findByTestId('orders-read-error');
    expect(say).toHaveTextContent('The orders could not be re-read (Network Error)');
    expect(say).toHaveTextContent('the last read, from 17:58');
    expect(say).not.toHaveTextContent('unknown');
    expect(screen.getByTestId('order-row-o-1')).toBeInTheDocument();
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

/*
 * ORD-W5, 2026-10-01: a station picked by hand is WRITTEN to the URL too, so a
 * reload or a shared link returns to it (ADR 0160). Before, the page only
 * read `?station=` on load and the address stayed `/orders`.
 */
function Probe() {
  const loc = useLocation();
  return <output data-testid="search">{loc.search}</output>;
}

describe('a station picked by hand is kept in the URL', () => {
  it('writes ?station=, and clears it when the station is toggled off', async () => {
    state.current = ordersData({ rows: [row({ id: 'o-1' })] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/orders?order=o-1']}>
          <Routes>
            <Route
              path="/orders"
              element={
                <>
                  <OrdersNext />
                  <Probe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: /delivered/i }));
    expect(screen.getByTestId('search').textContent).toBe('?station=delivered');

    fireEvent.click(screen.getByRole('tab', { name: /delivered/i }));
    expect(screen.getByTestId('search').textContent).toBe('');
  });
});

/*
 * ORD-W8, 2026-10-01: the order a link opens is handed to the drafts rail,
 * which opens and marks that order's letter.
 */
describe('the opened order focuses its letter on the rail', () => {
  it('marks the draft of the order a path id opened', async () => {
    state.current = ordersData({ rows: [row({ id: 'o-1' })] });
    state.drafts = [
      { id: 'c-1', orderId: 'o-1', wineName: 'Barolo Riserva', providerName: 'Anadolu', draftContent: 'Six cases.', createdAt: '2026-09-01T10:00:00Z', sendRequest: null },
    ];
    harness('/orders/o-1');
    expect(await screen.findByTestId('draft-card-o-1')).toHaveAttribute('data-focused', 'true');
  });
});

describe('the stage strip at phone width (ORD-W18)', () => {
  it('sits 3 + 2 under sm and one row from sm up, ruling the second row', async () => {
    state.current = ordersData({ rows: [row({ id: 'o-1' })] });
    harness('/orders');
    const strip = await screen.findByRole('tablist', { name: 'Order stages' });
    expect(strip.className).toMatch(/\bgrid-cols-3\b/);
    expect(strip.className).toMatch(/\bsm:flex\b/);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs[3].className).toMatch(/max-sm:border-l-0/);
    expect(tabs[3].className).toMatch(/max-sm:border-t/);
    expect(tabs[4].className).toMatch(/max-sm:border-t/);
    expect(tabs[0].className).not.toMatch(/\bborder-l\b/);
  });
});

/*
 * PROCURE-01, 2026-10-07. The month figure was one "$" sum of every order's
 * value, whatever its currency. It is now one line per currency, each in its
 * own money, and says so; nothing is added across them (ADR 0117 rule 3).
 */
describe('the month figure, per currency', () => {
  const flat = (t: string | null | undefined) => (t ?? '').replace(/\u00a0/g, ' ');

  it('prints one line per currency, each in its own money, and no sum of them', async () => {
    state.current = ordersData({
      month: {
        thisMonth: [
          { currency: 'EUR', amount: 1500 },
          { currency: 'TRY', amount: 12480 },
        ],
        lastMonth: [
          { currency: 'TRY', amount: 9000 },
          { currency: null, amount: 80 },
        ],
        unpricedThisMonth: 1,
      },
    });
    harness('/orders');

    const figure = flat((await screen.findByTestId('month-figure')).textContent);
    expect(figure).toContain('€1,500');
    expect(figure).toContain('TRY 12,480');
    expect(figure).not.toContain('$');
    // 1,500 + 12,480 — the old cross-currency figure — is nowhere on the page.
    expect(document.body.textContent).not.toContain('13,980');
    expect(screen.getByText(/2 currencies — each its own total, not added together/)).toBeInTheDocument();
    const lastMonth = flat(screen.getByText(/^last month/).textContent);
    expect(lastMonth).toContain('TRY 9,000 · 80 (currency not recorded)');
    expect(lastMonth).toContain('1 unpriced — excluded, not zeroed');
  });

  it('prints one currency at the full size, with no "not added" caption', async () => {
    state.current = ordersData({
      month: { thisMonth: [{ currency: 'TRY', amount: 12480 }], lastMonth: [], unpricedThisMonth: 0 },
    });
    harness('/orders');
    expect(flat((await screen.findByTestId('month-figure')).textContent)).toBe('TRY 12,480');
    expect(screen.queryByText(/not added together/)).not.toBeInTheDocument();
    expect(screen.getByText(/^last month/).textContent).toBe('last month 0');
  });

  it('prints 0 for a month with no priced order, and a dash for one it could not read', async () => {
    state.current = ordersData({
      month: { thisMonth: [], lastMonth: null, unpricedThisMonth: 0 },
    });
    const first = harness('/orders');
    expect((await screen.findByTestId('month-figure')).textContent).toBe('0');
    expect(screen.getByText(/^last month/).textContent).toBe('last month —');
    first.unmount();

    state.current = ordersData({
      month: { thisMonth: null, lastMonth: null, unpricedThisMonth: 0 },
    });
    harness('/orders');
    expect((await screen.findByTestId('month-figure')).textContent).toBe('—');
  });

  it('gives a new currency a new Tally, so the figure never runs one currency into another', async () => {
    // Motion is on here. A Tally handed a new value starts from its old one,
    // so a Tally kept across the change would first show the euro amount in
    // lira ("TRY 1,500"). Keyed by currency, the lira line mounts fresh, and
    // a Tally never animates on first paint.
    state.reducedMotion = false;
    state.current = ordersData({
      month: { thisMonth: [{ currency: 'EUR', amount: 1500 }], lastMonth: [], unpricedThisMonth: 0 },
    });
    const view = harness('/orders');
    expect(flat((await screen.findByTestId('month-figure')).textContent)).toBe('€1,500');

    state.current = ordersData({
      month: { thisMonth: [{ currency: 'TRY', amount: 12480 }], lastMonth: [], unpricedThisMonth: 0 },
    });
    view.again();
    expect(flat(screen.getByTestId('month-figure').textContent)).toBe('TRY 12,480');
  });
});
