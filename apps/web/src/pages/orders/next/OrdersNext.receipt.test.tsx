/**
 * An order's receipt, opened in a right sheet (founder, 2026-09-22).
 *
 *   1. clicking a delivered row mounts the canonical document
 *      (`/documents/:id`'s page) for the document the order's delivery
 *      carries — not a new layout;
 *   2. an order with no document on any delivery says so in one sentence;
 *   3. a read that failed is said as a failure, never as "no receipt".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  CanonicalDocumentPage: ({ documentId, embedded }: { documentId?: string; embedded?: boolean }) => (
    <div data-testid="canonical-document" data-document-id={documentId} data-embedded={String(embedded)} />
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

import OrdersNext from './OrdersNext';
import { NO_RECEIPT_SENTENCE } from './ReceiptSheet';
import { RECURRENCE_UNREAD } from './recurrence';
import type { OrderRowVM, OrdersNextData } from './useOrdersNextData';

function row(over: Partial<OrderRowVM> = {}): OrderRowVM {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00001',
    wineName: 'Carvalha do Brico 2010',
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
  return {
    rows,
    counts: { pending: 0, approved: 0, ordered: 0, delivered: rows.length },
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
  };
}

function openReceipt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route path="/orders" element={<OrdersNext />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // A delivered row's bare click opens the receipt (OD-152, founder
  // 2026-09-25) — no expansion step in between.
  fireEvent.click(screen.getByRole('button', { name: /Carvalha do Brico 2010.*open the receipt/ }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('an order line opens its receipt in a right sheet', () => {
  it('mounts the canonical document for the document on the order’s delivery', async () => {
    state.current = ordersData([row()]);
    receiptForOrder.mockResolvedValue({
      state: 'found',
      document: { documentId: 'doc-77', role: 'invoice', docNumber: 'INV-9', docDate: '2026-09-05' },
    });
    openReceipt();

    const sheet = await screen.findByTestId('receipt-sheet');
    const doc = await within(sheet).findByTestId('canonical-document');
    expect(doc.getAttribute('data-document-id')).toBe('doc-77');
    expect(doc.getAttribute('data-embedded')).toBe('true');
    expect(receiptForOrder).toHaveBeenCalledWith('o-1');
  });

  it('says in one sentence that an order has no receipt', async () => {
    state.current = ordersData([row()]);
    receiptForOrder.mockResolvedValue({ state: 'none' });
    openReceipt();

    const sheet = await screen.findByTestId('receipt-sheet');
    expect(await within(sheet).findByText(NO_RECEIPT_SENTENCE)).toBeInTheDocument();
    expect(within(sheet).queryByTestId('canonical-document')).toBeNull();
  });

  it('says a failed read failed, never that there is no receipt', async () => {
    state.current = ordersData([row()]);
    receiptForOrder.mockRejectedValue(new Error('503'));
    openReceipt();

    const sheet = await screen.findByTestId('receipt-sheet');
    expect(await within(sheet).findByText(/could not be read/)).toBeInTheDocument();
    expect(within(sheet).queryByText(NO_RECEIPT_SENTENCE)).toBeNull();
  });
});
