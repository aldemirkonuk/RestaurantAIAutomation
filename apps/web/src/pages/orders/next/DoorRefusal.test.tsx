/**
 * A truck refused at the door is never "Cancelled" (F-669, founder S198).
 *
 * The gateway closes an order whose truck was turned away as FAILED, and the
 * web's canonical status reads FAILED as `cancelled` so the order stays off
 * the figures. Before this fix the ledger then printed "Cancelled" on it,
 * and an order refused while still IN_TRANSIT said nothing at all. The label
 * now comes from the door (`doorRefusal`), with its reason and credit
 * standing.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/services/api/orders', () => ({ mintOrderSeal: vi.fn(async () => 'seal') }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { LedgerRow } from './LedgerRow';
import { refusedAtDoorLabel, toRow } from './useOrdersNextData';

// A variable, not a literal: scripts/check_money_states_its_currency.py.
const FIXTURE_CURRENCY = 'USD';
const NO_PROVIDERS = new Map<string, string>();
const LABEL = 'Refused at door — broken case · credit requested';

function wire(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'i-1',
    providerId: 'p-1',
    quantity: 12,
    unitType: 'bottle',
    bottlesTotal: 12,
    finalPrice: 20,
    totalCost: 240,
    currency: FIXTURE_CURRENCY,
    status: 'FAILED',
    requestedAt: '2026-10-01T10:00:00Z',
    wineName: 'Barolo Riserva',
    ...over,
  } as never;
}

function mount(over: Record<string, unknown> = {}) {
  const row = toRow(wire(over), NO_PROVIDERS);
  render(
    <MemoryRouter>
      <LedgerRow
        row={row}
        expanded
        onToggle={() => {}}
        selected={false}
        onSelectChange={() => {}}
        bulkRunning={false}
      />
    </MemoryRouter>,
  );
  return row;
}

describe('a truck refused at the door', () => {
  it('reads the door’s words, with the reason and the credit standing', () => {
    const row = mount({ doorRefusal: { reason: 'broken case', credit: 'requested', label: LABEL } });
    expect(row.stage).toBe('cancelled');
    expect(row.refusedAtDoor).toBe(LABEL);
    expect(screen.getByTestId('refused-at-door').textContent).toBe(
      `${LABEL}. Kept in the book, off the figures.`,
    );
    expect(screen.getByText('Refused at door')).toBeInTheDocument();
    expect(screen.queryByText(/cancelled/i)).toBeNull();
  });

  it('says "Refused at door" on a FAILED order even when the route sent no door reading', () => {
    expect(refusedAtDoorLabel({ status: 'FAILED' } as never)).toBe('Refused at door');
    mount({ doorRefusal: undefined });
    expect(screen.queryByText(/cancelled/i)).toBeNull();
  });

  it('marks an order still in transit whose truck was turned away', () => {
    const label = 'Refused at door — wrong temperature · no credit asked';
    const row = mount({ status: 'IN_TRANSIT', doorRefusal: { reason: 'wrong temperature', credit: 'none', label } });
    expect(row.stage).toBe('ordered');
    expect(screen.getByText('Refused at door')).toBeInTheDocument();
    expect(screen.getByTestId('refused-at-door').textContent).toBe(`${label}.`);
  });

  it('leaves a cancelled order and an unrefused order as they were', () => {
    expect(refusedAtDoorLabel({ status: 'CANCELLED', doorRefusal: null } as never)).toBeNull();
    expect(refusedAtDoorLabel({ status: 'IN_TRANSIT', doorRefusal: null } as never)).toBeNull();
    mount({ status: 'CANCELLED', doorRefusal: null });
    expect(screen.queryByTestId('refused-at-door')).toBeNull();
    expect(screen.getByText('Cancelled — kept in the book, off the figures.')).toBeInTheDocument();
  });
});
