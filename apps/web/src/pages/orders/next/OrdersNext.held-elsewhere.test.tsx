/**
 * F-245 — a link to an order that another of the person's own houses holds.
 * The "not among the loaded orders" banner used to stop at a raw id and "may
 * belong to a different house", with no way to open it there. It now asks
 * the gateway which of the person's houses holds it and offers to switch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const HOUSE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOUSE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER = '0b0b0b0b-0000-4000-8000-000000000001';

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

const auth = vi.hoisted(() => ({ switchTo: vi.fn(), get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: HOUSE_A,
    user: { userId: 'u1', restaurantId: HOUSE_A, role: 'owner' },
    setActiveRestaurantId: auth.switchTo,
  }),
}));

// Only the holding lookup is answered here; every other read goes to the real
// client, as in OrdersNext.deep-link.test.tsx.
vi.mock('@/services/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/client')>();
  const real = actual.default;
  const client = new Proxy(real, {
    get: (target, prop, receiver) =>
      prop === 'get'
        ? (url: string, config?: unknown) =>
            url === '/auth/houses/holding'
              ? auth.get(url, config)
              : (real.get as (u: string, c?: unknown) => unknown)(url, config)
        : Reflect.get(target, prop, receiver),
  });
  return { ...actual, default: client };
});

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
  state.current = ordersData({ rows: [row({ id: 'o-1' })], hasData: true });
  state.drafts = [];
  auth.get.mockReset();
  auth.switchTo.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('an order another of your houses holds (F-245)', () => {
  it('names that house and opens it there', async () => {
    auth.get.mockResolvedValue({
      data: { success: true, house: { id: HOUSE_B, name: 'Kadikoy', city: 'Istanbul' } },
    });
    auth.switchTo.mockResolvedValue(true);
    harness(`/orders/${ORDER}`);

    const offer = await screen.findByTestId('order-held-elsewhere');
    expect(offer).toHaveTextContent('This order is in Kadikoy.');
    expect(auth.get).toHaveBeenCalledWith('/auth/houses/holding', { params: { order: ORDER } });

    fireEvent.click(screen.getByRole('button', { name: 'Open it there' }));
    await waitFor(() => expect(auth.switchTo).toHaveBeenCalledWith(HOUSE_B));
  });

  it('says so when the switch is refused, and stays', async () => {
    auth.get.mockResolvedValue({
      data: { success: true, house: { id: HOUSE_B, name: 'Kadikoy', city: null } },
    });
    auth.switchTo.mockResolvedValue(false);
    harness(`/orders/${ORDER}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Open it there' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Kadikoy could not be opened, so you are still in this house.',
    );
  });

  it('offers nothing when no house of yours holds it', async () => {
    auth.get.mockResolvedValue({ data: { success: true, house: null } });
    harness(`/orders/${ORDER}`);

    expect(await screen.findByTestId('target-order-missing')).toBeInTheDocument();
    await waitFor(() => expect(auth.get).toHaveBeenCalled());
    expect(screen.queryByTestId('order-held-elsewhere')).not.toBeInTheDocument();
  });

  it('offers nothing when this house holds it (it is only further back)', async () => {
    auth.get.mockResolvedValue({
      data: { success: true, house: { id: HOUSE_A, name: 'Moda', city: null } },
    });
    harness(`/orders/${ORDER}`);

    await waitFor(() => expect(auth.get).toHaveBeenCalled());
    expect(screen.queryByTestId('order-held-elsewhere')).not.toBeInTheDocument();
  });

  it('offers nothing when the lookup fails', async () => {
    auth.get.mockRejectedValue(new Error('503'));
    harness(`/orders/${ORDER}`);

    await waitFor(() => expect(auth.get).toHaveBeenCalled());
    expect(screen.queryByTestId('order-held-elsewhere')).not.toBeInTheDocument();
  });

  it('does not ask about an id that is not an order id', async () => {
    harness('/orders/ghost-id');
    expect(await screen.findByTestId('target-order-missing')).toBeInTheDocument();
    expect(auth.get).not.toHaveBeenCalled();
  });
});
