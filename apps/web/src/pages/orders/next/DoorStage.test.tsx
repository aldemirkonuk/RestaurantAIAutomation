/**
 * The /orders row at the door (wave 80, the integ10 orders walk).
 *
 * F-1126 — "Mark delivered" booked every ordered bottle in one tap: no count,
 *   no broken boxes, no refusal. It now opens the door count with the ordered
 *   figures filled in (`?count=ordered`), and nothing books until a person
 *   confirms there. The row calls no delivery mutation at all.
 * F-1127 — a short delivery with bottles still owed read "Delivered". The chip
 *   and the expansion now say "Part delivered" and how many are owed.
 * F-1133 — an APPROVED order had no way to the door from /orders. Sending the
 *   letter leaves it APPROVED and the gateway's door counts against it, so the
 *   approved row offers the same door.
 * F-1152 — "Mark delivered" was a plain <a href>, so it reloaded the whole app
 *   to reach the door. It is a router link now: the door opens in place.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const deliverMutate = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/orders', () => ({ mintOrderSeal: vi.fn(async () => 'seal') }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: deliverMutate, mutateAsync: deliverMutate, isPending: false }),
}));

import { LedgerRow } from './LedgerRow';
import { toRow } from './useOrdersNextData';

// A variable, not a literal: scripts/check_money_states_its_currency.py.
const FIXTURE_CURRENCY = 'USD';

function wire(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'i-1',
    providerId: 'p-1',
    quantity: 2,
    unitType: 'case',
    bottlesTotal: 24,
    finalPrice: 120,
    totalCost: 240,
    currency: FIXTURE_CURRENCY,
    status: 'IN_TRANSIT',
    requestedAt: '2026-09-01T10:00:00Z',
    deliveredAt: '2026-09-03T10:00:00Z',
    wineName: 'Barolo Riserva',
    ...over,
  } as never;
}

function DoorProbe() {
  const at = useLocation();
  return <p>door at {at.pathname + at.search}</p>;
}

function mount(over: Record<string, unknown> = {}) {
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <Routes>
        <Route
          path="/orders"
          element={
            <LedgerRow
              row={toRow(wire(over), new Map())}
              expanded
              onToggle={() => {}}
              selected={false}
              onSelectChange={() => {}}
              bulkRunning={false}
            />
          }
        />
        <Route path="/receiving/:orderId/door" element={<DoorProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const shelf = (over: Record<string, unknown> = {}) => ({
  readable: true,
  why: null,
  quantityInStockUom: 18,
  stockUom: 'bottle',
  packUnit: 'case',
  packSize: 12,
  packs: 1,
  looseInStockUom: 6,
  words: '1 case + 6 bottles',
  rejectedAtDoorBottles: 0,
  countedNotBookedBottles: 0,
  rejectedAtDeskBottles: null,
  invoicedBottles: null,
  orderedBottles: 24,
  backorderBottles: 6,
  ...over,
});

describe('F-1126 — "Mark delivered" opens the door count, it books nothing itself', () => {
  it('[REVERT-FAILS] is a way to the count, filled in with what was ordered', () => {
    mount();
    const door = screen.getByRole('link', { name: 'Mark delivered' });
    expect(door.getAttribute('href')).toBe('/receiving/o-1/door?count=ordered');
    expect(deliverMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing goes on the shelf until you confirm it/)).toBeTruthy();
  });
});

describe('F-1152 — the door opens inside the app, not by reloading it', () => {
  it('[REVERT-FAILS] is a router link: the tap moves the app to the door count', () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Mark delivered' }));
    expect(screen.getByText('door at /receiving/o-1/door?count=ordered')).toBeTruthy();
  });
});

describe('F-1133 — an approved order can be taken in at the door', () => {
  it('[REVERT-FAILS] offers the door on an approved row', () => {
    mount({ status: 'APPROVED', approvedAt: '2026-09-02T10:00:00Z' });
    expect(screen.getByText(/the house places it with/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mark delivered' }).getAttribute('href')).toBe(
      '/receiving/o-1/door?count=ordered',
    );
  });
});

describe('F-1127 — a short delivery says what is still owed', () => {
  it('[REVERT-FAILS] reads "Part delivered · 6 owed", not "Delivered"', () => {
    mount({ status: 'PARTIALLY_RECEIVED', received: shelf() });
    expect(screen.getByText('Part delivered · 6 owed')).toBeTruthy();
    expect(screen.getByText(/Part delivered .* — 6 bottles still owed\./)).toBeTruthy();
    expect(screen.queryByText('Delivered')).toBeNull();
  });

  it('takes the bottles sent back off what is owed', () => {
    mount({ status: 'PARTIALLY_RECEIVED', received: shelf({ rejectedAtDoorBottles: 6 }) });
    expect(screen.getByText('Delivered')).toBeTruthy();
    expect(screen.queryByText(/owed/)).toBeNull();
  });

  it('claims nothing owed when the ledger could not be read', () => {
    mount({ status: 'PARTIALLY_RECEIVED', received: shelf({ readable: false }) });
    expect(screen.getByText('Delivered')).toBeTruthy();
    expect(screen.queryByText(/owed/)).toBeNull();
  });
});
