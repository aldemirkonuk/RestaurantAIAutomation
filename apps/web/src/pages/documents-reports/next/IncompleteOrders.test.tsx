/**
 * The Incomplete orders register under Documents & Reports (ADR 0207, round 3).
 * `apiClient` is mocked; the rule is the gateway's (`arrival-asks.spec.ts`).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: 'r1' }) }));

import { IncompleteOrders } from './IncompleteOrders';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <IncompleteOrders />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
});

describe('Incomplete orders', () => {
  it('lists each order 30 days past with its vendor, days, whether anyone answered, and its acts', async () => {
    api.get.mockResolvedValue({
      data: {
        forYou: true,
        sentence: null,
        afterDays: 30,
        orders: [
          { orderId: 'o1', orderNumber: 'PO-2201', providerId: 'p', providerName: 'Kestrel Wine Co.', expectedDate: '2026-08-10', daysPast: 42, confirmed: false, choices: [{ key: 'receive', route: '/receiving/o1/door' }, { key: 'cancel' }] },
        ],
      },
    });
    mount();
    const [row] = await screen.findAllByTestId('incomplete-order');
    expect(row).toHaveTextContent('PO-2201');
    expect(row).toHaveTextContent('Kestrel Wine Co. · expected 2026-08-10 · 42 days · never answered');
    expect(within(row).getByRole('link', { name: 'Receive it' })).toHaveAttribute('href', '/receiving/o1/door');
    expect(screen.getByText(/Out of the vendor scorecard until received/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/procurement/incomplete-orders');
  });

  it('says what an empty register means, and a failed read is unknown, not empty', async () => {
    api.get.mockResolvedValue({ data: { forYou: true, sentence: null, afterDays: 30, orders: [] } });
    mount();
    expect(await screen.findByTestId('incomplete-empty')).toHaveTextContent('No order is more than 30 days past');
  });

  it('says a failed read in words', async () => {
    api.get.mockRejectedValue({ response: { data: { message: 'The orders book did not answer (timeout).' } } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('This register is unknown, not empty.');
  });

  it('prints the gateway’s rule for someone it does not ask', async () => {
    api.get.mockResolvedValue({ data: { forYou: false, sentence: 'Asked of owners and managers.', afterDays: 30, orders: [] } });
    mount();
    expect(await screen.findByText('Asked of owners and managers.')).toBeInTheDocument();
  });
});
