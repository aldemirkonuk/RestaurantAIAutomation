/**
 * `/orders?new=1` — a link that asks for a NEW order (F-477, F-478).
 *
 * Three doors send it: the command palette's "New order", a vendor offer's
 * "Write a new order" and a recommendation's "Draft the PO". Before the fix no
 * page read `new`, so each landed on the order list with nothing opened.
 *
 * The composer itself is stubbed here: what is asserted is that the page opens
 * it, keeps the add-a-vendor-first guard, and drops the param so a reload does
 * not reopen it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  vendors: { data: [] as unknown[], isLoading: false, isError: false },
}));

vi.mock('./useOrdersNextData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useOrdersNextData')>();
  return {
    ...actual,
    useOrdersNextData: () => ({
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
    }),
  };
});

vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => state.vendors,
}));

vi.mock('./NewOrderSheet', () => ({
  NewOrderSheet: (p: { open: boolean }) => (p.open ? <div data-testid="composer" /> : null),
}));

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

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.search}</div>;
}

function harness(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/orders"
            element={
              <>
                <OrdersNext />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.vendors = { data: [{ id: 'prov-1', name: 'Kavaklıdere' }], isLoading: false, isError: false };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/orders?new=1', () => {
  it('opens the composer, and drops the param so a reload does not reopen it', async () => {
    harness('/orders?new=1');
    expect(await screen.findByTestId('composer')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('');
  });

  it('a house with no vendors gets the add-a-vendor-first guard, not an empty composer', async () => {
    state.vendors = { data: [], isLoading: false, isError: false };
    harness('/orders?new=1');
    expect(await screen.findByTestId('vendor-first-reason')).toBeInTheDocument();
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
  });

  it('without the param the composer stays shut', () => {
    harness('/orders');
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
  });
});
