/**
 * The Incomplete orders register under Documents & Reports (ADR 0207, round 3).
 * `apiClient` is mocked; the rule is the gateway's (`arrival-asks.spec.ts`).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
const die = vi.hoisted(() => ({ claim: { id: 'c1', claimedAmount: 12400.5, currency: 'TRY' as string | null, state: 'open' } }));
vi.mock('@/components/orders/SealedRejectDie', () => ({
  SealedRejectDie: ({ onCreditClaimOpened }: { onCreditClaimOpened: (r: unknown) => void }) => (
    <button type="button" onClick={() => onCreditClaimOpened({ ok: true, result: { alreadyOpen: false, claim: die.claim } })}>
      Hold to cancel
    </button>
  ),
}));
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

  it('the credit-claim sentence prints the money grouped and with its sign, or says no currency was recorded (F-993)', async () => {
    const order = { orderId: 'o1', orderNumber: 'PO-2201', providerId: 'p', providerName: 'Kestrel Wine Co.', expectedDate: '2026-08-10', daysPast: 42, confirmed: false, choices: [{ key: 'cancel' }] };
    api.get.mockResolvedValue({ data: { forYou: true, sentence: null, afterDays: 30, orders: [order] } });
    die.claim = { ...die.claim, claimedAmount: 12400.5, currency: 'TRY' };
    mount();
    const [row] = await screen.findAllByTestId('incomplete-order');
    fireEvent.click(within(row).getByRole('button', { name: 'It never arrived — cancel' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Hold to cancel' }));
    const said = within(row).getByRole('status').textContent ?? '';
    expect(said).toContain('12,400.50');
    expect(said).not.toContain('12400.5');
    expect(said).not.toContain('currency not recorded');
  });

  it('a claim with no currency on record says so rather than printing a bare number (F-993)', async () => {
    const order = { orderId: 'o1', orderNumber: 'PO-2201', providerId: 'p', providerName: 'Kestrel Wine Co.', expectedDate: '2026-08-10', daysPast: 42, confirmed: false, choices: [{ key: 'cancel' }] };
    api.get.mockResolvedValue({ data: { forYou: true, sentence: null, afterDays: 30, orders: [order] } });
    die.claim = { ...die.claim, claimedAmount: 12400.5, currency: null };
    mount();
    const [row] = await screen.findAllByTestId('incomplete-order');
    fireEvent.click(within(row).getByRole('button', { name: 'It never arrived — cancel' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Hold to cancel' }));
    expect(within(row).getByRole('status')).toHaveTextContent('chasing the vendor for 12,400.50 (currency not recorded).');
  });

  it('prints the gateway’s rule for someone it does not ask', async () => {
    api.get.mockResolvedValue({ data: { forYou: false, sentence: 'Asked of owners and managers.', afterDays: 30, orders: [] } });
    mount();
    expect(await screen.findByText('Asked of owners and managers.')).toBeInTheDocument();
  });
});
