/**
 * "Waiting on you": flagged first, then oldest — ADR 0256 (founder, 2026-10-01).
 *
 * The gateway decides the order and the flags; the card must neither re-sort
 * the rows nor invent a flag, and it must say a reason in WORDS — never a
 * figure — so the line holds for a role that does not see money (DASH-W22,
 * recorded on `origin/fix/review-dashboard`, not yet on main).
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/services/api/orders', () => ({ mintOrderSeal: vi.fn(async () => 'seal-token') }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false }),
}));

import { WaitingOnYou } from './WaitingOnYou';
import type { Order, PendingOrderPriority } from '@/services/api/types';

function order(id: string, wineName: string, over: Partial<Order> = {}): Order {
  return {
    id,
    orderNumber: `ORD-${id}`,
    restaurantId: 'r-1',
    inventoryId: `i-${id}`,
    providerId: 'p-1',
    quantity: 5,
    unitType: 'case',
    bottlesTotal: 60,
    finalPrice: 400,
    totalCost: 2000,
    status: 'PENDING',
    requestedAt: '2026-09-01T10:00:00Z',
    wineName,
    providerName: 'Vinifera Imports',
    ...over,
  } as Order;
}

const flagged = (...reasons: PendingOrderPriority['reasons']): PendingOrderPriority => ({
  flagged: true,
  reasons,
  unknown: [],
});
const plain: PendingOrderPriority = { flagged: false, reasons: [], unknown: [] };

function mount(pending: Order[]) {
  return render(
    <MemoryRouter>
      <WaitingOnYou pending={pending} onChanged={vi.fn()} />
    </MemoryRouter>,
  );
}

/** The row buttons, top to bottom, by the wine each one names. */
function rowOrder(names: string[]): string[] {
  return screen
    .getAllByRole('button', { expanded: false })
    .map((b) => names.find((n) => b.textContent?.includes(n)))
    .filter((n): n is string => Boolean(n));
}

describe('WaitingOnYou keeps the gateway order', () => {
  it('renders rows exactly as sent, flagged first then oldest, and does not re-sort', () => {
    // The gateway's answer: a flagged younger order above an unflagged older
    // one. A card that sorted by requestedAt (either way) would move them.
    mount([
      order('b', 'Barolo', { requestedAt: '2026-09-05T10:00:00Z', priority: flagged('running_out') }),
      order('a', 'Amarone', { requestedAt: '2026-09-01T10:00:00Z', priority: plain }),
      order('c', 'Chianti', { requestedAt: '2026-09-09T10:00:00Z', priority: plain }),
    ]);
    expect(rowOrder(['Amarone', 'Barolo', 'Chianti'])).toEqual(['Barolo', 'Amarone', 'Chianti']);
  });
});

describe('WaitingFlag on a row', () => {
  it('marks a flagged row and says each reason in words', () => {
    mount([
      order('a', 'Amarone', {
        priority: flagged('price_jump', 'needs_signature', 'manager_ceiling', 'running_out'),
      }),
    ]);
    const row = screen.getByRole('button', { name: /Amarone/ });
    expect(row).toHaveTextContent('Focus on this');
    expect(row).toHaveTextContent('price jumped · needs a signature · large order · running out');
  });

  it('puts no mark on an unflagged row, or on a row from a route that sends no flags', () => {
    mount([
      order('a', 'Amarone', { priority: plain }),
      order('b', 'Barolo'),
    ]);
    expect(screen.queryByText('Focus on this')).toBeNull();
    expect(screen.queryByText(/Couldn’t check/)).toBeNull();
  });

  it('shows a flagged row a reason or no mark, never the mark alone', () => {
    // Unreachable from the gateway (flagged means a reason was found), pinned
    // so a drift there cannot print "Focus on this" with nothing after it.
    mount([
      order('a', 'Amarone', { priority: { flagged: true, reasons: [], unknown: [] } }),
      order('b', 'Barolo', {
        priority: { flagged: true, reasons: ['toString' as never], unknown: [] },
      }),
      order('c', 'Chianti', {
        priority: { flagged: true, reasons: ['not_a_reason' as never, 'running_out'], unknown: [] },
      }),
    ]);
    expect(screen.getByRole('button', { name: /Amarone/ })).not.toHaveTextContent('Focus on this');
    expect(screen.getByRole('button', { name: /Barolo/ })).not.toHaveTextContent('Focus on this');
    const chianti = screen.getByRole('button', { name: /Chianti/ });
    expect(chianti).toHaveTextContent('Focus on this');
    expect(screen.getByText('running out').textContent).toBe('running out');
  });

  it('says what it could not check, and does not mark the row for it', () => {
    mount([
      order('a', 'Amarone', {
        priority: { flagged: false, reasons: [], unknown: ['price_jump', 'running_out'] },
      }),
    ]);
    const row = screen.getByRole('button', { name: /Amarone/ });
    expect(row).toHaveTextContent('Couldn’t check the price or the stock just now.');
    expect(row).not.toHaveTextContent('Focus on this');
  });

  it('carries no figure in the flag', () => {
    mount([
      order('a', 'Amarone', {
        totalCost: 98765,
        priority: {
          flagged: true,
          reasons: ['price_jump', 'running_out'],
          unknown: ['needs_signature', 'manager_ceiling'],
        },
      }),
    ]);
    const words = [
      screen.getByText('Focus on this').parentElement?.textContent ?? '',
      screen.getByText(/Couldn’t check/).textContent ?? '',
    ].join(' ');
    expect(words).not.toMatch(/\d/);
  });
});
