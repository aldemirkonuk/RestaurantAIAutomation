/**
 * "Approve from the bell" — the owed act on `/notifications`, and the ruling
 * *"a one-click approval from the bell opens the panel first"* proved.
 *
 * THE REGRESSION. Nothing existed: the bell could open a notification and
 * navigate, and no path from a bell line to a sealed approval was built at all.
 * Every assertion here fails against the pre-packet tree.
 *
 * The two rules the act must not break:
 *   - the seal is NEVER in the popover — the bell closes and a Panel opens;
 *   - the figures are read from the ORDER at the moment they are shown, not
 *     carried over from a notice somebody wrote weeks ago.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => api.get(...a) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

vi.mock('@/components/orders/SealedApproveDie', () => ({
  SealedApproveDie: ({ label }: { label: string }) => (
    <button type="button" data-testid="sealed-die">
      {label}
    </button>
  ),
}));

import { ApproveFromBellPanel, orderIdOf, settledWords } from './ApproveFromBellPanel';

const ORDER = {
  id: 'ord-118',
  orderNumber: 'PO-118',
  quantity: 5,
  unitType: 'case',
  wineName: 'Öküzgözü 2022',
  providerName: 'Kavaklıdere',
  finalPrice: 2400,
  totalCost: 12000,
  status: 'pending',
  requestedAt: '2026-09-01T09:00:00.000Z',
  expectedDeliveryDate: '2026-09-11T00:00:00.000Z',
};

function draw(over: Partial<React.ComponentProps<typeof ApproveFromBellPanel>> = {}) {
  render(
    <MemoryRouter>
      <ApproveFromBellPanel open orderId="ord-118" onClose={() => {}} {...over} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: ORDER });
});

describe('the shape', () => {
  it('is a panel, never a popover — the seal is rationed', async () => {
    draw();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'panel');
    expect(dialog.closest('.mdv-ovl')).not.toHaveAttribute('data-shape', 'popover');
    expect(dialog).toHaveAttribute('data-motion', 'settle');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });
});

describe('the figures are the order’s, read now', () => {
  it('reads the order when it opens and shows its lines, price and delivery', async () => {
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/procurement/orders/ord-118'));
    const figures = await screen.findByTestId('bell-approve-figures');
    expect(figures).toHaveTextContent('5 case Öküzgözü 2022');
    expect(figures).toHaveTextContent('2,400 per case');
    expect(figures).toHaveTextContent('12,000 in all');
    expect(figures).toHaveTextContent('Kavaklıdere');
    expect(screen.getByTestId('bell-approve-provenance')).toHaveTextContent(
      /Read from the order itself just now/,
    );
  });

  it('shows an absent price as a dash and says no price is recorded', async () => {
    api.get.mockResolvedValue({ data: { ...ORDER, finalPrice: undefined, totalCost: undefined } });
    draw();
    expect(await screen.findByTestId('bell-approve-figures')).toHaveTextContent(
      /— no price is recorded on this order/,
    );
  });

  it('shows an absent delivery date as a dash, never as today', async () => {
    api.get.mockResolvedValue({ data: { ...ORDER, expectedDeliveryDate: undefined } });
    draw();
    expect(await screen.findByTestId('bell-approve-figures')).toHaveTextContent(
      /— no date is recorded/,
    );
  });
});

describe('four states', () => {
  it('says it is reading before it claims anything', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    draw();
    expect(screen.getByTestId('bell-approve-reading')).toBeInTheDocument();
    expect(screen.queryByTestId('bell-approve-seal')).toBeNull();
  });

  it('tells an unreadable order from a missing one', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('timeout'), { response: { status: 500 } }));
    draw();
    expect(await screen.findByTestId('bell-approve-unreadable')).toHaveTextContent(
      /this is not a missing order/,
    );
    expect(screen.queryByTestId('bell-approve-seal')).toBeNull();
  });

  it('names a refusal as a refusal', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 403 } }));
    draw();
    expect(await screen.findByTestId('bell-approve-unreadable')).toHaveTextContent(
      /may not read this order/,
    );
  });

  it('offers NO hold on an order that is already settled, and says which', async () => {
    api.get.mockResolvedValue({ data: { ...ORDER, status: 'approved' } });
    draw();
    expect(await screen.findByTestId('bell-approve-settled')).toHaveTextContent(
      /already been approved\. There is nothing to seal/,
    );
    expect(screen.queryByTestId('bell-approve-seal')).toBeNull();
  });

  it('offers the hold, with the money on its face, when there is something to seal', async () => {
    draw();
    expect(await screen.findByTestId('bell-approve-seal')).toBeInTheDocument();
    expect(screen.getByTestId('sealed-die')).toHaveTextContent('Hold to approve · 12,000');
  });
});

describe('settledWords', () => {
  it('gives each settled state its own sentence, and a pending one none', () => {
    expect(settledWords({ id: 'x', status: 'pending' })).toBeNull();
    expect(settledWords({ id: 'x', status: 'delivered' })).toMatch(/already been delivered/);
    expect(settledWords({ id: 'x', status: 'cancelled' })).toMatch(/was cancelled/);
    // An approvedAt with an unrecognised status is still an approved order.
    expect(settledWords({ id: 'x', status: 'weird', approvedAt: 'x' })).toMatch(/already been approved/);
  });
});

describe('orderIdOf', () => {
  it('reads both spellings the gateway writes, and nothing else', () => {
    expect(orderIdOf({ orderId: 'a' })).toBe('a');
    expect(orderIdOf({ order_id: 'b' })).toBe('b');
    expect(orderIdOf({ orderId: '  c  ' })).toBe('c');
    expect(orderIdOf({ orderId: '' })).toBeNull();
    expect(orderIdOf({ count: 3 })).toBeNull();
    expect(orderIdOf(null)).toBeNull();
    expect(orderIdOf('nonsense')).toBeNull();
  });
});
