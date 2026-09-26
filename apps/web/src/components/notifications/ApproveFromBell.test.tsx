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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn() }));
const bell = vi.hoisted(() => ({ items: [] as unknown[] }));

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

vi.mock('../../lib/mudavym/useBellBook', () => ({
  BELL_PAGE: 25,
  useBellBook: () => ({
    register: { state: 'ready' },
    unread: bell.items.length,
    unreadNote: null,
    foldedCount: 0,
    foldedById: {},
    folds: {},
    items: bell.items,
    hasMore: false,
    actionNote: null,
    markAllRead: () => {},
    refresh: () => {},
  }),
}));

import {
  AWAITING_APPROVAL,
  ApproveFromBellPanel,
  approvableOrderIdOf,
  orderIdOf,
  settledWords,
} from './ApproveFromBellPanel';
import { HouseBell } from '../mudavym/HouseBell';

const ORDER = {
  id: 'ord-118',
  orderNumber: 'PO-118',
  quantity: 5,
  unitType: 'case',
  wineName: 'Öküzgözü 2022',
  providerName: 'Kavaklıdere',
  finalPrice: 2400,
  totalCost: 12000,
  status: 'PENDING',
  currency: 'TRY',
  requestedAt: '2026-09-01T09:00:00.000Z',
  expectedDeliveryDate: '2026-09-11T00:00:00.000Z',
};

/**
 * What `formatMoney` prints for this amount and code in this runtime.
 *
 * `toHaveTextContent` normalizes the DOM side's whitespace (NBSP included) but
 * NOT the string you hand it (`jest-dom`'s `checkWith` is compared as-is) — so
 * without this replace, `Intl.NumberFormat`'s NBSP between "TRY" and the digits
 * survives in the expectation, the rendered NBSP does not, and a byte-identical
 * value fails the match.
 */
const tryMoney = (v: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v).replace(/\u00a0/g, ' ');

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
    expect(figures).toHaveTextContent(`${tryMoney(2400)} per case`);
    expect(figures).toHaveTextContent(`${tryMoney(12000)} in all`);
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
    api.get.mockResolvedValue({ data: { ...ORDER, status: 'APPROVED' } });
    draw();
    expect(await screen.findByTestId('bell-approve-settled')).toHaveTextContent(
      /already been approved\. Only an order waiting for approval can be sealed/,
    );
    expect(screen.queryByTestId('bell-approve-seal')).toBeNull();
  });

  it('offers NO hold on a part-received order — the case the old list missed', async () => {
    api.get.mockResolvedValue({ data: { ...ORDER, status: 'PARTIALLY_RECEIVED' } });
    draw();
    expect(await screen.findByTestId('bell-approve-settled')).toHaveTextContent(
      /Part of this order has already been received/,
    );
    expect(screen.queryByTestId('bell-approve-seal')).toBeNull();
  });

  it('offers the hold, with the money in its own currency on its face', async () => {
    draw();
    expect(await screen.findByTestId('bell-approve-seal')).toBeInTheDocument();
    expect(screen.getByTestId('sealed-die')).toHaveTextContent(`Hold to approve · ${tryMoney(12000)}`);
  });

  it('says the currency is not recorded rather than printing a bare number', async () => {
    api.get.mockResolvedValue({ data: { ...ORDER, currency: null } });
    draw();
    expect(await screen.findByTestId('sealed-die')).toHaveTextContent(
      /Hold to approve · 12,000\.00 \(currency not recorded\)/,
    );
  });
});

describe('settledWords — a hold only where the gateway approves', () => {
  it('offers a hold for exactly the gateway’s two waiting states, in either case', () => {
    expect([...AWAITING_APPROVAL].sort()).toEqual(['APPROVAL_NEEDED', 'PENDING']);
    expect(settledWords({ id: 'x', status: 'PENDING' })).toBeNull();
    expect(settledWords({ id: 'x', status: 'pending' })).toBeNull();
    expect(settledWords({ id: 'x', status: 'APPROVAL_NEEDED' })).toBeNull();
  });

  it('refuses every other ProcurementOrderStatus, each with its own sentence', () => {
    // procurement.dto.ts `ProcurementOrderStatus`, minus the two above.
    const others = [
      'NEGOTIATING',
      'APPROVED',
      'CONFIRMED',
      'IN_TRANSIT',
      'DELIVERED',
      'PARTIALLY_RECEIVED',
      'COMPLETED',
      'CANCELLED',
      'REJECTED',
      'FAILED',
    ];
    const sentences = others.map((status) => settledWords({ id: 'x', status }));
    for (const s of sentences) expect(s).toEqual(expect.any(String));
    expect(new Set(sentences).size).toBe(others.length);
  });

  it('refuses a state nobody listed, and a missing state, rather than offering a hold', () => {
    expect(settledWords({ id: 'x', status: 'ordered' })).toMatch(/is ordered, which is not a state waiting/);
    expect(settledWords({ id: 'x' })).toMatch(/without a state/);
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

describe('approvableOrderIdOf — only an approval hands off', () => {
  it('reads the order off an approval line', () => {
    expect(approvableOrderIdOf({ type: 'order_pending', metadata: { orderId: 'ord-118' } })).toBe('ord-118');
  });

  it('gives nothing for lines that name an order and are not approvals', () => {
    // The metadata the real producers write: `order_delivered`
    // (notifications.service.ts) and `invoice_received` receipt verification
    // and delivery discrepancy lines (procurement.service.ts).
    expect(
      approvableOrderIdOf({ type: 'order_delivered', metadata: { orderId: 'ord-1', wineName: 'x', quantity: 6 } }),
    ).toBeNull();
    expect(approvableOrderIdOf({ type: 'invoice_received', metadata: { orderId: 'ord-1' } })).toBeNull();
    expect(approvableOrderIdOf({ type: 'draft_ready', metadata: { order_id: 'ord-1' } })).toBeNull();
  });

  it('gives nothing for the one real order_pending producer, which writes only a count', () => {
    // communications/scheduled-tasks.service.ts, recurring orders due.
    expect(approvableOrderIdOf({ type: 'order_pending', metadata: { count: 2 } })).toBeNull();
  });
});

describe('the bell offers "Approve it" only on approval lines', () => {
  const line = (id: string, type: string, metadata: Record<string, unknown>) => ({
    id,
    userId: 'u',
    restaurantId: 'r',
    type,
    title: `${type} line`,
    message: '',
    status: 'unread',
    priority: 'medium',
    metadata,
    timestamp: '2026-09-17T09:00:00.000Z',
    createdAt: '2026-09-17T09:00:00.000Z',
  });

  it('shows the hand-off on the approval and not on the delivery or the invoice', async () => {
    bell.items = [
      line('n1', 'order_delivered', { orderId: 'ord-1' }),
      line('n2', 'invoice_received', { orderId: 'ord-2' }),
      line('n3', 'order_pending', { orderId: 'ord-118' }),
    ];
    render(
      <MemoryRouter>
        <HouseBell />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Notifications \(3 unread\)/ }));
    const offers = await screen.findAllByTestId('bell-approve-open');
    expect(offers).toHaveLength(1);
    fireEvent.click(offers[0]);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/procurement/orders/ord-118'));
  });
});
