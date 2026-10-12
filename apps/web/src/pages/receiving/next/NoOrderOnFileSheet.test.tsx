/**
 * "New delivery → No order on file → When was this ordered? → Add to the
 * books" (F-669, founder S198).
 *
 * Before this, a truck that came with no order in the app had no way onto the
 * books from the door, and an order written for one read like any other on
 * /orders. These pin the sheet (Don't know preselected, one tap id, no
 * prices) and the "Logged at door" words on the order ledger.
 */

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const logAtDoor = vi.fn();

vi.mock('@/services/api/receiving', () => ({ receivingApi: { logAtDoor: (b: unknown) => logAtDoor(b) } }));
vi.mock('@/services/api/client', () => ({
  getErrorMessage: (e: { response?: { data?: { message?: string } } }) =>
    e?.response?.data?.message ?? 'failed',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r-1', user: { restaurantId: 'r-1', role: 'staff' } }),
}));
vi.mock('@/hooks/queries/useInventoryQueries', () => ({
  useInventory: () => ({ data: [{ id: 'i-1', wineName: 'Barolo Riserva' }], isLoading: false, isError: false }),
}));
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [{ id: 'p-1', name: 'Enoteca Rossi' }], isLoading: false, isError: false }),
}));
vi.mock('@tanstack/react-query', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/components/mudavym', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  Sheet: ({ open, title, footer, children }: { open: boolean; title: string; footer: ReactNode; children: ReactNode }) =>
    open ? (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock('@/services/api/orders', () => ({ mintOrderSeal: vi.fn(async () => 'seal') }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { NoOrderOnFileSheet, phoneToday } from './NoOrderOnFileSheet';
import { LedgerRow } from '../../orders/next/LedgerRow';
import { loggedAtDoorLabel, toRow } from '../../orders/next/useOrdersNextData';

function fill() {
  fireEvent.change(screen.getByLabelText('Who brought it?'), { target: { value: 'p-1' } });
  fireEvent.change(screen.getByLabelText('What came?'), { target: { value: 'i-1' } });
  fireEvent.change(screen.getByLabelText('How many came'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Bottles in each case'), { target: { value: '6' } });
}

describe('No order on file → Add to the books', () => {
  beforeEach(() => {
    logAtDoor.mockReset();
  });

  it('asks when it was ordered with Don’t know already chosen, and shows no price', () => {
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    expect(screen.getByText('When was this ordered?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Don’t know' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Today' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/\$|price:/i)).toBeNull();
    expect(screen.getByTestId('logged-at-door-add')).toBeDisabled();
  });

  it('sends one tap with the answer and the phone’s own day, then says it was logged', async () => {
    logAtDoor.mockResolvedValue({
      orderId: 'o-1',
      orderNumber: 'ORD-2026-00077',
      loggedAtDoor: true,
      placedOnStated: '2026-10-10',
      orderAlreadyWritten: false,
    });
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole('radio', { name: 'Yesterday' }));
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-done')).toBeInTheDocument());
    expect(logAtDoor).toHaveBeenCalledTimes(1);
    const body = logAtDoor.mock.calls[0][0];
    expect(body).toMatchObject({
      providerId: 'p-1',
      inventoryId: 'i-1',
      quantity: 2,
      unit: 'case',
      bottlesPerCase: 6,
      orderedOn: 'yesterday',
      phoneToday: phoneToday(),
    });
    expect(body.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty('finalPrice');
    expect(screen.getByTestId('logged-at-door-done').textContent).toBe(
      'Logged at door as order ORD-2026-00077: 2 cases counted into stock.',
    );
  });

  it('after the order was written but not counted, the next tap reuses the same key', async () => {
    logAtDoor
      .mockRejectedValueOnce({
        response: { data: { orderId: 'o-1', message: 'The delivery was added to the books, but the bottles did not reach stock.' } },
      })
      .mockResolvedValueOnce({
        orderId: 'o-1',
        orderNumber: null,
        loggedAtDoor: true,
        placedOnStated: null,
        orderAlreadyWritten: true,
      });
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-failure')).toBeInTheDocument());
    expect(screen.getByTestId('logged-at-door-add').textContent).toBe('Add to the books again');
    // The fields hold still, so the retry is the same truck.
    expect(screen.getByLabelText('How many came')).toBeDisabled();
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-done')).toBeInTheDocument());
    expect(logAtDoor.mock.calls[1][0].key).toBe(logAtDoor.mock.calls[0][0].key);
    expect(screen.getByTestId('logged-at-door-done').textContent).toMatch(/nothing was booked twice/);
  });
});

describe('an order logged at the door, on /orders', () => {
  const NO_PROVIDERS = new Map<string, string>();
  // A variable, not a literal: scripts/check_money_states_its_currency.py.
  const FIXTURE_CURRENCY = 'USD';
  const wire = (over: Record<string, unknown> = {}) =>
    ({
      id: 'o-1',
      orderNumber: 'ORD-2026-00077',
      restaurantId: 'r-1',
      inventoryId: 'i-1',
      providerId: 'p-1',
      quantity: 12,
      unitType: 'bottle',
      bottlesTotal: 12,
      finalPrice: 0,
      totalCost: 0,
      currency: FIXTURE_CURRENCY,
      status: 'DELIVERED',
      requestedAt: '2026-10-11T10:00:00Z',
      deliveredAt: '2026-10-11T10:00:00Z',
      wineName: 'Barolo Riserva',
      ...over,
    }) as never;

  it('says Logged at door, with the day it was ordered when the door knew it', () => {
    expect(loggedAtDoorLabel({ loggedAtDoor: true, placedOnStated: '2026-10-10' })).toBe(
      'Logged at door · ordered 10 Oct',
    );
    expect(loggedAtDoorLabel({ loggedAtDoor: true, placedOnStated: null })).toBe('Logged at door');
    expect(loggedAtDoorLabel({ loggedAtDoor: false, placedOnStated: null })).toBeNull();
    expect(loggedAtDoorLabel({} as never)).toBeNull();
  });

  it('shows the chip and why it is off the vendor’s timing figures', () => {
    const row = toRow(wire({ loggedAtDoor: true, placedOnStated: null }), NO_PROVIDERS);
    render(
      <MemoryRouter>
        <LedgerRow row={row} expanded onToggle={() => {}} selected={false} onSelectChange={() => {}} bulkRunning={false} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Logged at door').length).toBeGreaterThan(0);
    expect(screen.getByTestId('logged-at-door').textContent).toMatch(
      /counts in spend and stock but not in this vendor's on-time, lead-time or fill-rate figures/,
    );
  });

  it('says nothing of the door for an order the house placed', () => {
    const row = toRow(wire({ loggedAtDoor: false }), NO_PROVIDERS);
    expect(row.loggedAtDoor).toBeNull();
  });
});
