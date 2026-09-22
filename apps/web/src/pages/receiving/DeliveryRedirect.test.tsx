/**
 * `/deliveries/:id` — before this pass there was no route at all, so every
 * `actionUrl` a notification built (`delivery-clock.service.ts`,
 * `delivery.service.ts`) landed on the SPA catch-all and silently redirected
 * to `/`. This pins the three things that could go wrong once the route
 * exists: it hands off to the RIGHT page once resolved, and a failed read
 * says why in words rather than doing the same silent redirect it replaced.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const event = vi.hoisted(() => vi.fn());
vi.mock('../../services/api/deliveries', () => ({
  deliveriesApi: { event },
}));

import DeliveryRedirect from './DeliveryRedirect';

/**
 * Prints the actual location it landed on — not just that SOME receiving
 * stub rendered — so dropping `?order=` from `DeliveryRedirect.tsx`, the
 * whole point of the hand-off, fails this test instead of passing it.
 */
function ReceivingStub() {
  const location = useLocation();
  return <div>THE RECEIVING PAGE{location.search}</div>;
}

function harness(id = 'd-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/deliveries/${id}`]}>
        <Routes>
          <Route path="/deliveries/:id" element={<DeliveryRedirect />} />
          <Route path="/receiving" element={<ReceivingStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  event.mockReset();
});

describe('a delivery that resolves to an order', () => {
  it('hands off to the receiving queue with that order named', async () => {
    event.mockResolvedValue({
      id: 'd-1',
      orderId: 'ord-9',
      providerId: null,
      state: 'AGREED',
      provenance: 'ORDERED',
      jurisdiction: null,
      deliveredAt: null,
      agreedAt: null,
      agreedRule: null,
      verifiedAt: null,
      verifiedBy: null,
      lapsedAt: null,
      lapseDeemed: null,
      amendedAt: null,
    });
    harness('d-1');
    const stub = await screen.findByText(/THE RECEIVING PAGE/);
    expect(stub).toHaveTextContent('order=ord-9');
  });
});

describe('a delivery that reads fine but carries no order id', () => {
  it('says so by name, instead of a silent redirect to a bare /receiving', async () => {
    // ADR 0103's UNORDERED provenance: a real delivery, really read, with
    // no order behind it. `DeliveryEvent.orderId` is `string | null`.
    event.mockResolvedValue({
      id: 'd-2',
      orderId: null,
      providerId: null,
      state: 'UNORDERED',
      provenance: 'UNORDERED',
      jurisdiction: null,
      deliveredAt: null,
      agreedAt: null,
      agreedRule: null,
      verifiedAt: null,
      verifiedBy: null,
      lapsedAt: null,
      lapseDeemed: null,
      amendedAt: null,
    });
    harness('d-2');
    const msg = await screen.findByTestId('delivery-no-order');
    expect(msg).toHaveTextContent('d-2');
    expect(msg).toHaveTextContent('no order to open');
    expect(screen.queryByText(/THE RECEIVING PAGE/)).not.toBeInTheDocument();
  });
});

describe('a delivery id the gateway does not have', () => {
  it('says so on a 404 — indistinguishable from another house\'s delivery, and says that too', async () => {
    event.mockRejectedValue({ response: { status: 404 } });
    harness('ghost');
    const msg = await screen.findByTestId('delivery-not-found');
    expect(msg).toHaveTextContent('does not exist, or it does not belong to this house');
  });

  it('says so on a 403, the same sentence as a 404', async () => {
    event.mockRejectedValue({ response: { status: 403 } });
    harness('d-1');
    const msg = await screen.findByTestId('delivery-not-found');
    expect(msg).toHaveTextContent('does not exist, or it does not belong to this house');
  });
});

describe('a read that failed for another reason', () => {
  it('shows the failure in words, not the not-found sentence', async () => {
    event.mockRejectedValue(new Error('network blip'));
    harness('d-1');
    const msg = await screen.findByTestId('delivery-not-found');
    expect(msg).toHaveTextContent('network blip');
    expect(msg).not.toHaveTextContent('does not exist');
  });
});
