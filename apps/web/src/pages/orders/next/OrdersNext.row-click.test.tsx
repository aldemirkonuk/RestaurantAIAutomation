/**
 * OD-152 — the bare click on an /orders row depends on state (founder,
 * 2026-09-25):
 *
 *   1. a DELIVERED row opens its receipt in the right sheet — pointer, Enter
 *      and Space alike — and never expands on the way;
 *   2. its button says so to a screen reader (a dialog, "open the receipt")
 *      and claims no expanded state it does not have;
 *   3. its working is still reachable, through the chevron's own disclosure;
 *   4. a PENDING row expands, with the approve hold inside — and reads no
 *      receipt;
 *   5. an ORDERED row expands, with "Mark delivered" inside.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

import OrdersNext from './OrdersNext';
import { rowOpensReceipt } from './LedgerRow';
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

function mount(r: OrderRowVM) {
  state.current = ordersData([r]);
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
  return screen.getByTestId('row-click');
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('the rule', () => {
  it('opens the receipt at the delivered stage and at no other', () => {
    expect(rowOpensReceipt({ stage: 'delivered' })).toBe(true);
    for (const stage of ['pending', 'approved', 'ordered', 'cancelled'] as const) {
      expect(rowOpensReceipt({ stage })).toBe(false);
    }
  });
});

describe('a delivered row opens its receipt', () => {
  it('on a click, straight into the sheet, without expanding', async () => {
    receiptForOrder.mockResolvedValue({
      state: 'found',
      document: { documentId: 'doc-77', role: 'invoice', docNumber: 'INV-9', docDate: '2026-09-05' },
    });
    const btn = mount(row());
    fireEvent.click(btn);

    expect(await screen.findByTestId('receipt-sheet')).toBeInTheDocument();
    expect((await screen.findByTestId('canonical-document')).getAttribute('data-document-id')).toBe('doc-77');
    expect(receiptForOrder).toHaveBeenCalledWith('o-1');
    // Nothing expanded on the way: the disclosure beside it is still shut.
    expect(screen.getByTestId('row-disclose').getAttribute('aria-expanded')).toBe('false');
  });

  it('on Enter, the same as the click', async () => {
    receiptForOrder.mockResolvedValue({ state: 'none' });
    const user = userEvent.setup();
    const btn = mount(row());

    btn.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('receipt-sheet')).toBeInTheDocument();
    expect(receiptForOrder).toHaveBeenCalledTimes(1);
  });

  it('on Space, the same as the click', async () => {
    receiptForOrder.mockResolvedValue({ state: 'none' });
    const user = userEvent.setup();
    const btn = mount(row());

    btn.focus();
    await user.keyboard(' ');
    expect(await screen.findByTestId('receipt-sheet')).toBeInTheDocument();
  });

  it('tells a screen reader it opens a dialog, and claims no expanded state', () => {
    const btn = mount(row());
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.hasAttribute('aria-expanded')).toBe(false);
    expect(screen.getByRole('button', { name: /open the receipt/ })).toBe(btn);
  });

  it('keeps its working one disclosure away', () => {
    mount(row());
    const disclose = screen.getByRole('button', { name: `Show the working for ${WINE}` });
    fireEvent.click(disclose);
    expect(disclose.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('row-working')).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-sheet')).toBeNull();
    expect(receiptForOrder).not.toHaveBeenCalled();
  });
});

describe('a row still being worked expands', () => {
  it('pending: the click expands, the approve hold is there, and no receipt is read', () => {
    const btn = mount(row({ stage: 'pending', status: 'pending', deliveredAt: null }));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.hasAttribute('aria-haspopup')).toBe(false);
    expect(screen.queryByTestId('row-disclose')).toBeNull();

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Hold to approve/)).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-sheet')).toBeNull();
    expect(receiptForOrder).not.toHaveBeenCalled();
  });

  it('pending: Enter expands too', async () => {
    const user = userEvent.setup();
    const btn = mount(row({ stage: 'pending', status: 'pending', deliveredAt: null }));
    btn.focus();
    await user.keyboard('{Enter}');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('receipt-sheet')).toBeNull();
  });

  it('ordered: the click expands onto "Mark delivered"', () => {
    const btn = mount(row({ stage: 'ordered', status: 'ordered', deliveredAt: null }));
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Mark delivered' })).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-sheet')).toBeNull();
  });
});

describe('what the keyboard reaches is what the click shows', () => {
  it('a shut row is inert, an open one is not', () => {
    const btn = mount(row({ stage: 'ordered', status: 'ordered', deliveredAt: null }));
    const body = screen.getByTestId('row-body');
    expect(body.hasAttribute('inert')).toBe(true);
    fireEvent.click(btn);
    expect(body.hasAttribute('inert')).toBe(false);
  });
});
