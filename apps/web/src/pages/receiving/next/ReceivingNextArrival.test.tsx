/**
 * The receiving page asks "Did it arrive?" only on the manager and owner
 * renderings (ADR 0207, round 3) — a staff rendering never requests the asks.
 * The gateway refuses anyone it does not ask independently; this is the page's
 * half. The rail itself is `RcArrivalAsks.test.tsx`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api/client', () => ({ apiClient: { get, post: vi.fn() } }));
const who = vi.hoisted(() => ({ role: 'manager' }));
vi.mock('../../../contexts/AuthContext', async () => {
  // Keep the real module's other exports (main's DayLine reads `AuthContext`
  // with useContext); only `useAuth` is this suite's.
  const actual = await vi.importActual<typeof import('../../../contexts/AuthContext')>('../../../contexts/AuthContext');
  return {
    ...actual,
    useAuth: () => ({ activeRestaurantId: 'rest-A', user: { userId: 'u1', restaurantId: 'rest-A', role: who.role } }),
  };
});
vi.mock('../../../lib/offline-storage', () => ({
  offlineStorage: {
    getPendingMutationsByType: vi.fn().mockResolvedValue([]),
    removePendingMutation: vi.fn(),
    updatePendingMutation: vi.fn(),
  },
}));

import ReceivingNext from './ReceivingNext';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReceivingNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) =>
    url === '/procurement/arrival-asks'
      ? { data: { forYou: true, sentence: null, asks: [] } }
      : { data: { orders: [], total: 0, page: 1, limit: 25, hasMore: false, items: [], unverified: [], totalAtRisk: 0 } },
  );
});

describe('the receiving page and "Did it arrive?"', () => {
  it('asks on the manager rendering', async () => {
    who.role = 'manager';
    mount();
    expect(await screen.findByTestId('arrival-asks')).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/procurement/arrival-asks'));
  });

  it('never asks on a staff rendering', async () => {
    who.role = 'staff';
    mount();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId('arrival-asks')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith('/procurement/arrival-asks');
  });
});
