/**
 * /orders reads the newest 100 orders; the spine counts the whole book
 * (F-1368). A chosen station must not call itself empty, or "none repeats",
 * off the loaded rows while the spine counts more (F-1429, F-1438); "the
 * newest N" counts only the window, not a linked order read on its own
 * (F-1432); and a drafted letter on an order older than the window shows the
 * order's own money and keeps its answers (F-1439).
 *
 * Each case fails against the tree before this change.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ current: null as unknown, drafts: [] as unknown[] }));

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
// reduced motion (as DraftRail.test.tsx does).
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
    dataUpdatedAt: null,
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
  state.drafts = [];
});

const loadOlder = vi.fn();

describe('a station reads the whole book, not only the loaded rows (F-1429, F-1438)', () => {
  it('says the station\'s orders are older than the loaded ones, never that nothing sits there', async () => {
    state.current = ordersData({
      rows: [row({ id: 'n-1', stage: 'pending', status: 'pending' })],
      counts: { pending: 1, approved: 0, ordered: 3, delivered: 0 },
      totalInBook: 250,
      windowCount: 1,
      loadOlder,
    });
    harness('/orders?station=ordered');
    expect(await screen.findByTestId('station-older')).toHaveTextContent(
      '3 orders at ordered are older than the orders shown — load older orders to see them.',
    );
    expect(screen.queryByText(/Nothing sits at ordered/)).toBeNull();
  });

  it('counts what is still older when some of the station is loaded', async () => {
    state.current = ordersData({
      rows: [row({ id: 'n-1', stage: 'ordered', status: 'ordered' })],
      counts: { pending: 0, approved: 0, ordered: 3, delivered: 0 },
      totalInBook: 250,
      windowCount: 1,
      loadOlder,
    });
    harness('/orders?station=ordered');
    expect(await screen.findByTestId('order-row-n-1')).toBeInTheDocument();
    expect(screen.getByTestId('station-older')).toHaveTextContent('2 orders at ordered are older than the orders shown');
  });

  it('never says no order repeats while the spine counts repeating orders', async () => {
    state.current = ordersData({
      rows: [row({ id: 'n-1' })],
      recurringCount: 4,
      recurrenceReadCount: 1,
      totalInBook: 250,
      windowCount: 1,
      loadOlder,
    });
    harness('/orders?station=recurring');
    expect(await screen.findByTestId('station-older')).toHaveTextContent(
      '4 repeating orders are older than the orders shown',
    );
    expect(screen.queryByText(/None of the/)).toBeNull();
  });

  it('says none repeats of the whole book when the whole book has none', async () => {
    state.current = ordersData({
      rows: [row({ id: 'n-1' })],
      recurringCount: 0,
      recurrenceReadCount: 1,
      totalInBook: 250,
      windowCount: 1,
      loadOlder,
    });
    harness('/orders?station=recurring');
    expect(await screen.findByText('None of the 250 orders in this book repeats.')).toBeInTheDocument();
    expect(screen.queryByTestId('station-older')).toBeNull();
  });
});

describe('"the newest N" counts the window only (F-1432)', () => {
  it('leaves out an older order a link read on its own', async () => {
    state.current = ordersData({
      rows: [row({ id: 'n-1' }), row({ id: 'n-2' }), row({ id: 'old-7', stage: 'delivered', status: 'delivered' })],
      totalInBook: 250,
      windowCount: 2,
      loadOlder,
    });
    harness('/orders');
    expect(await screen.findByText('Showing the newest 2 of 250 orders.')).toBeInTheDocument();
  });
});

describe('a letter on an order older than the window (F-1439)', () => {
  // Variables, not literals: scripts/check_money_states_its_currency.py.
  const ORDER_CURRENCY = 'EUR';
  const HOUSE_CURRENCY = 'TRY';
  const letter = {
    id: 'c-9',
    orderId: 'old-9',
    wineName: 'Chablis',
    providerName: 'Anadolu',
    draftContent: 'Six cases.',
    createdAt: '2026-09-01T10:00:00Z',
    quantity: 6,
    quotedPrice: 20,
    sendRequest: null,
  };

  it('shows the order\'s own money and keeps its answers', async () => {
    state.current = ordersData({
      rows: [row({ id: 'n-1' })],
      houseCurrency: HOUSE_CURRENCY,
      draftRows: [row({ id: 'old-9', currency: ORDER_CURRENCY })],
    });
    state.drafts = [letter];
    harness('/orders');
    const card = await screen.findByTestId('draft-card-old-9');
    expect(card.querySelector('[data-testid="draft-figure"]')!.textContent).toContain('€20.00');
    fireEvent.click(card.querySelector('button[aria-expanded]')!);
    expect(await screen.findByTestId('draft-open-responses')).toBeInTheDocument();
  });

  it('says the currency is not recorded, never the house\'s, before the order is read', async () => {
    state.current = ordersData({ rows: [row({ id: 'n-1' })], houseCurrency: HOUSE_CURRENCY });
    state.drafts = [letter];
    harness('/orders');
    const card = await screen.findByTestId('draft-card-old-9');
    const figure = card.querySelector('[data-testid="draft-figure"]')!.textContent ?? '';
    expect(figure).toContain('currency not recorded');
    expect(figure).not.toContain('₺');
  });
});
