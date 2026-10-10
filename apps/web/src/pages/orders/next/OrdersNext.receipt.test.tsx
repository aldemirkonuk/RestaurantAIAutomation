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
const postMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, post: postMock } };
});

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
import { CLOSE_SHORT_DONE, NO_RECEIPT_SENTENCE } from './ReceiptSheet';
import { RECURRENCE_UNREAD } from './recurrence';
import { closeShortOwed, type OrderRowVM, type OrdersNextData } from './useOrdersNextData';

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
    dataUpdatedAt: null,
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

/**
 * F-104 — a partly received order can be closed short from its receipt, with a
 * reason. REVERT-FAILS: before this there was no such control anywhere.
 */
describe('a partly received order can be closed short', () => {
  it('offers no close on an order that fully arrived', async () => {
    state.current = ordersData([row()]);
    receiptForOrder.mockResolvedValue({ state: 'none' });
    openReceipt();
    const sheet = await screen.findByTestId('receipt-sheet');
    await within(sheet).findByText(NO_RECEIPT_SENTENCE);
    expect(within(sheet).queryByTestId('close-short')).toBeNull();
  });

  /**
   * F-826 — a door count leaves every order partly received, full ones too,
   * and closing one shut out its invoice check for good. REVERT-FAILS: the
   * sheet offered the close on any partly received order.
   */
  it('offers no close on a partly received order with nothing still owed', async () => {
    state.current = ordersData([row({ status: 'partially_received', closeShortOwedBottles: null })]);
    receiptForOrder.mockResolvedValue({ state: 'none' });
    openReceipt();
    const sheet = await screen.findByTestId('receipt-sheet');
    await within(sheet).findByText(NO_RECEIPT_SENTENCE);
    expect(within(sheet).queryByTestId('close-short')).toBeNull();
  });

  it('says how many bottles are still to come', async () => {
    state.current = ordersData([row({ status: 'partially_received', closeShortOwedBottles: 2 })]);
    receiptForOrder.mockResolvedValue({ state: 'none' });
    openReceipt();
    const box = await screen.findByTestId('close-short');
    expect(box).toHaveTextContent('2 bottles are still to come on this order.');
  });

  it('asks for a reason first, then closes with it', async () => {
    state.current = ordersData([row({ status: 'partially_received', closeShortOwedBottles: 2 })]);
    receiptForOrder.mockResolvedValue({ state: 'none' });
    postMock.mockResolvedValue({ data: { id: 'o-1' } });
    openReceipt();
    const box = await screen.findByTestId('close-short');

    fireEvent.click(within(box).getByRole('button', { name: 'Close short' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent(/Say why/);
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.change(within(box).getByLabelText(/Why is the rest not coming/), {
      target: { value: 'Vendor is out of the 2010' },
    });
    fireEvent.click(within(box).getByRole('button', { name: 'Close short' }));
    expect(await within(box).findByText(CLOSE_SHORT_DONE)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/procurement/orders/o-1/close-short', {
      reason: 'Vendor is out of the 2010',
    });
  });

  it('shows the server refusal in its own words', async () => {
    state.current = ordersData([row({ status: 'partially_received', closeShortOwedBottles: 2 })]);
    receiptForOrder.mockResolvedValue({ state: 'none' });
    postMock.mockRejectedValue(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 403, data: { message: 'Only a manager or an owner of this restaurant can close an order short.' } },
      }),
    );
    openReceipt();
    const box = await screen.findByTestId('close-short');
    fireEvent.change(within(box).getByLabelText(/Why is the rest not coming/), {
      target: { value: 'short shipped' },
    });
    fireEvent.click(within(box).getByRole('button', { name: 'Close short' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent(/Only a manager or an owner/);
  });
});

/** F-826 — when the close is offered at all, read off the order's shelf. */
describe('closeShortOwed', () => {
  const shelf = {
    readable: true,
    why: null,
    quantityInStockUom: 4,
    stockUom: 'bottle',
    packUnit: null,
    packSize: null,
    packs: null,
    looseInStockUom: null,
    words: '4 bottles',
    rejectedAtDoorBottles: 0,
    countedNotBookedBottles: 0,
    rejectedAtDeskBottles: 0,
    invoicedBottles: 4,
    verifiedAt: '2026-10-01T12:00:00Z',
    orderedBottles: 6,
    backorderBottles: 2,
  };

  it('offers the bottles still owed once the invoice is checked', () => {
    expect(closeShortOwed('partially_received', shelf)).toBe(2);
  });

  it('offers nothing when everything came', () => {
    expect(closeShortOwed('partially_received', { ...shelf, backorderBottles: 0 })).toBeNull();
  });

  it('counts bottles sent back as delivered, not owed', () => {
    expect(closeShortOwed('partially_received', { ...shelf, rejectedAtDoorBottles: 2 })).toBeNull();
    expect(closeShortOwed('partially_received', { ...shelf, rejectedAtDeskBottles: 1 })).toBe(1);
  });

  it('offers nothing before the invoice check, which closing would shut out', () => {
    expect(closeShortOwed('partially_received', { ...shelf, invoicedBottles: null })).toBeNull();
  });

  it('offers nothing on a reading that does not say, or another state', () => {
    expect(closeShortOwed('partially_received', undefined)).toBeNull();
    expect(closeShortOwed('partially_received', { ...shelf, readable: false })).toBeNull();
    expect(closeShortOwed('partially_received', { ...shelf, backorderBottles: undefined })).toBeNull();
    expect(closeShortOwed('delivered', shelf)).toBeNull();
  });
});
