/**
 * /orders on a phone (r72 need 1): the ledger draws 20 rows and a 48 px
 * "Show 20 more" under them; a row is a 72 px two-line card; the page grid is
 * one `minmax(0,1fr)` column so a wide row can never widen the page past 375.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ current: null as unknown }));
const receiptForOrder = vi.hoisted(() => vi.fn());

vi.mock('./useOrdersNextData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useOrdersNextData')>();
  return { ...actual, useOrdersNextData: () => state.current };
});

vi.mock('@/services/api/deliveries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/deliveries')>();
  return { ...actual, deliveriesApi: { ...actual.deliveriesApi, receiptForOrder } };
});

vi.mock('../../documents/next/CanonicalDocumentPage', () => ({
  CanonicalDocumentPage: ({ documentId }: { documentId?: string }) => (
    <div data-testid="canonical-document" data-document-id={documentId} />
  ),
}));

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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import OrdersNext, { LEDGER_PAGE } from './OrdersNext';
import { RECURRENCE_UNREAD } from './recurrence';
import type { OrderRowVM, OrdersNextData, Stage } from './useOrdersNextData';

const WINE = 'Carvalha do Brico 2010';

function row(over: Partial<OrderRowVM> = {}): OrderRowVM {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00001',
    wineName: WINE,
    producer: 'Quinta',
    providerName: 'Anadolu',
    quantity: 6,
    unitPrice: 40,
    bottlesTotal: 6,
    unitType: 'bottle',
    priceUnit: { read: true, stated: { priceUom: 'bottle', pricePackSize: 1 } },
    fees: { read: true, fees: { allowance: null, deposit: null, freight: null } },
    agreement: { ok: true, goods: 240, total: 240, working: '6 × $40.00 per bottle.' },
    computedTotal: 240,
    listedTotal: 240,
    total: 240,
    stage: 'delivered',
    status: 'delivered',
    recurring: false,
    recurrence: RECURRENCE_UNREAD,
    recurrenceLabel: null,
    requestedAt: '2026-09-01T10:00:00Z',
    approvedAt: '2026-09-02T10:00:00Z',
    deliveredAt: '2026-09-05T10:00:00Z',
    notes: null,
    ...over,
  };
}

function ordersData(rows: OrderRowVM[]): OrdersNextData {
  const counts = { pending: 0, approved: 0, ordered: 0, delivered: 0 };
  for (const r of rows) if (r.stage !== 'cancelled') counts[r.stage as Stage] += 1;
  return {
    rows,
    counts,
    recurringCount: 0,
    recurrenceReadCount: 0,
    cancelledCount: 0,
    month: {
      thisMonth: 0,
      lastMonth: null,
      unpricedThisMonth: 0,
      thisCurrency: null,
      lastCurrency: null,
      thisWithheld: null,
      lastWithheld: null,
    },
    hasData: true,
    isLoading: false,
    isError: false,
    errorMessage: null,
    refetch: vi.fn(),
    approvalByOrder: new Map(),
    approvalGateError: null,
    approvalPolicyNote: null,
    dataUpdatedAt: null,
  };
}

function mountMany(n: number, initial = '/orders') {
  const rows = Array.from({ length: n }, (_, i) =>
    row({
      id: `o-${i + 1}`,
      wineName: `Wine ${i + 1}`,
      // newest first: the page sorts by requestedAt descending
      requestedAt: new Date(Date.UTC(2026, 8, 1) + (n - i) * 3_600_000).toISOString(),
    }),
  );
  state.current = ordersData(rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/orders" element={<OrdersNext />} />
          <Route path="/orders/:id" element={<OrdersNext />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const css = readFileSync(resolve(__dirname, 'orders-phone.css'), 'utf8').replace(/\s+/g, ' ');

afterEach(() => {
  state.current = null;
});

describe('the ledger on a phone', () => {
  it('draws 20 rows, then "Show 20 more" brings the next 20', async () => {
    mountMany(63);
    expect(LEDGER_PAGE).toBe(20);
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(20);
    const more = screen.getByTestId('ledger-show-more');
    expect(more.textContent).toContain('Show 20 more');
    expect(more.textContent).toContain('43 not shown');
    await userEvent.click(more);
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(40);
    await userEvent.click(screen.getByTestId('ledger-show-more'));
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(60);
    // the last page says how many are left, not a flat 20
    expect(screen.getByTestId('ledger-show-more').textContent).toContain('Show 3 more');
    await userEvent.click(screen.getByTestId('ledger-show-more'));
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(63);
    expect(screen.queryByTestId('ledger-show-more')).toBeNull();
  });

  it('shows no button when 20 or fewer rows exist', () => {
    mountMany(20);
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(20);
    expect(screen.queryByTestId('ledger-show-more')).toBeNull();
  });

  it('never cuts off a deep-linked order below the line', () => {
    mountMany(60, '/orders/o-45');
    expect(screen.getByTestId('order-row-o-45')).toBeTruthy();
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(45);
    expect(screen.getByTestId('ledger-show-more').textContent).toContain('15 not shown');
  });

  it('the page grid is one minmax(0,1fr) column so a row cannot widen the page', () => {
    mountMany(3);
    const grid = screen.getByLabelText('Order ledger').parentElement as HTMLElement;
    expect(grid.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(grid.className).toContain('min-w-0');
  });

  it('carries the classes the phone css names on every row', () => {
    mountMany(2);
    const open = screen.getAllByTestId('row-click')[0];
    expect(open.className).toContain('ord-row__open');
    expect(open.querySelector('.ord-row__name')).not.toBeNull();
    expect(open.querySelector('.ord-row__vendor')).not.toBeNull();
    expect(open.querySelector('.ord-row__stage')).not.toBeNull();
    expect(open.querySelector('.ord-row__money')).not.toBeNull();
  });

  it('css: a row is a two-line 72 px card and "Show more" is 48 px', () => {
    expect(css).toMatch(/\.ord-row__open \{[^}]*display: grid/);
    expect(css).toMatch(/\.ord-row__open \{[^}]*min-height: 72px/);
    expect(css).toMatch(/\.ord-row__open \.ord-row__name \{[^}]*-webkit-line-clamp: 1/);
    expect(css).toMatch(/\.ord-more \{[^}]*min-height: 48px/);
  });

  it('css: motion is limited to opacity/background and is off under reduced motion', () => {
    expect(css).not.toMatch(/transition: all/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.ord-more \{ transition: none/);
  });
});
