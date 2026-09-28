/**
 * "Did it arrive?" on the receiving page (ADR 0207, round 3). `apiClient` is
 * mocked: these assert what the rail does with the gateway's answers; who is
 * asked and what counts is the gateway's (`arrival-asks.spec.ts`).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', user: { userId: 'u1', role: 'manager' } }),
}));

import { RcArrivalAsks } from './RcArrivalAsks';

const choices = (id: string, notYet = true) => [
  { key: 'receive', label: 'Yes — receive it', route: `/receiving/${id}/door` },
  ...(notYet ? [{ key: 'not_yet', label: 'Not yet', method: 'POST', endpoint: `/procurement/orders/${id}/arrival-answers` }] : []),
  { key: 'cancel', label: 'Cancel', sealEndpoint: `/procurement/orders/${id}/cancel-seal-challenge`, method: 'DELETE', endpoint: `/procurement/orders/${id}` },
];

const readout = {
  forYou: true,
  sentence: null,
  asks: [
    { kind: 'did_it_arrive', orderId: 'o1', orderNumber: 'PO-2291', providerId: 'p', providerName: 'Kestrel Wine Co.', expectedDate: '2026-09-18', daysPast: 3, standing: 'unconfirmed', answeredAt: null, choices: choices('o1') },
    { kind: 'did_it_arrive', orderId: 'o2', orderNumber: 'PO-2280', providerId: 'p', providerName: 'Kestrel Wine Co.', expectedDate: '2026-09-15', daysPast: 6, standing: 'confirmed_late', answeredAt: '2026-09-17T09:00:00Z', choices: choices('o2', false) },
  ],
};

function mount(enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RcArrivalAsks enabled={enabled} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('Did it arrive?', () => {
  it('asks about each order past its date with its three choices, and says a Not yet already given', async () => {
    api.get.mockResolvedValue({ data: readout });
    mount();
    const asks = await screen.findAllByTestId('arrival-ask');
    expect(asks).toHaveLength(2);
    expect(asks[0]).toHaveTextContent('PO-2291 · Kestrel Wine Co.');
    expect(asks[0]).toHaveTextContent('not counted against the vendor yet');
    expect(within(asks[0]).getByRole('link', { name: 'Yes — receive it' })).toHaveAttribute('href', '/receiving/o1/door');
    expect(within(asks[0]).getByRole('button', { name: 'Not yet' })).toBeInTheDocument();
    // ADR 0207 round 4 — the "Cancel on Orders ›" link is gone; the cancel
    // act is in place, reasonCode locked to never_arrived.
    expect(
      within(asks[0]).getByRole('button', { name: 'It never arrived — cancel' }),
    ).toBeInTheDocument();
    expect(asks[1]).toHaveTextContent('Someone here said not yet on 2026-09-17 — it counts as late.');
    expect(within(asks[1]).queryByRole('button', { name: 'Not yet' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/procurement/arrival-asks');
  });

  it('records Not yet through the gateway for that order', async () => {
    api.get.mockResolvedValue({ data: readout });
    api.post.mockResolvedValue({ data: { ...readout.asks[0], standing: 'confirmed_late' } });
    mount();
    const [first] = await screen.findAllByTestId('arrival-ask');
    fireEvent.click(within(first).getByRole('button', { name: 'Not yet' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/procurement/orders/o1/arrival-answers', { answer: 'not_yet' }),
    );
  });

  it('says the gateway’s refusal of the answer in words', async () => {
    api.get.mockResolvedValue({ data: readout });
    api.post.mockRejectedValue({ response: { data: { message: 'This order is not past its expected date.' } } });
    mount();
    const [first] = await screen.findAllByTestId('arrival-ask');
    fireEvent.click(within(first).getByRole('button', { name: 'Not yet' }));
    expect(await within(first).findByRole('alert')).toHaveTextContent('This order is not past its expected date.');
  });

  it('says what an empty list means, and a failed read is unknown, not empty', async () => {
    api.get.mockResolvedValue({ data: { forYou: true, sentence: null, asks: [] } });
    mount();
    expect(await screen.findByTestId('arrival-asks-empty')).toHaveTextContent('Incomplete orders under Documents & Reports');
  });

  it('says a failed read in words', async () => {
    api.get.mockRejectedValue({ response: { data: { message: 'The orders book did not answer (timeout).' } } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('this list is unknown, not empty');
  });

  it('asks nothing and draws nothing on a staff rendering', () => {
    mount(false);
    expect(screen.queryByTestId('arrival-asks')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
