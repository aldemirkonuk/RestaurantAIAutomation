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
    e?.response?.data?.message ?? 'timeout of 30000ms exceeded',
  getErrorStatus: (e: { response?: { status?: number } }) => e?.response?.status ?? null,
  // As the real one: a 5xx, or a request that went out and got no answer.
  isUnconfirmedWrite: (e: { request?: unknown; response?: { status?: number } }) =>
    e?.response?.status != null ? e.response.status >= 500 : Boolean(e?.request && !e?.response),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r-1', user: { restaurantId: 'r-1', role: 'staff' } }),
}));
vi.mock('@/hooks/queries/useInventoryQueries', () => ({
  useInventory: () => ({
    data: [
      { id: 'i-1', wineName: 'Barolo Riserva' },
      { id: 'i-2', wineName: 'Barolo', wineProducer: 'Vietti', wineVintage: 2018 },
      { id: 'i-3', wineName: 'Barolo', wineProducer: 'Vietti', wineVintage: 2019, bottleSizeMl: 1500 },
    ],
    isLoading: false,
    isError: false,
  }),
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

import { NoOrderOnFileSheet, doorWineLabel, phoneToday } from './NoOrderOnFileSheet';
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
    localStorage.clear();
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

  // F-1500: closing the sheet after "added but not counted" lost the id, so
  // the order sat DELIVERED with no stock and re-entry booked a second one.
  it('closed after "added but not counted", it reopens on the same truck and finishes it under the same id', async () => {
    logAtDoor
      .mockRejectedValueOnce({
        response: { status: 503, data: { orderId: 'o-1', reason: 'logged_but_not_counted', message: 'Added, not counted.' } },
      })
      .mockResolvedValueOnce({ orderId: 'o-1', orderNumber: null, loggedAtDoor: true, placedOnStated: null, orderAlreadyWritten: true });
    const { rerender, unmount } = render(<NoOrderOnFileSheet open onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-failure')).toBeInTheDocument());
    expect(localStorage.getItem('mudavym:door:no-order-pending:r-1')).not.toBeNull();
    rerender(<NoOrderOnFileSheet open={false} onClose={() => {}} />);
    unmount();

    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    expect(screen.getByLabelText('How many came')).toHaveValue('2');
    expect(screen.getByLabelText('How many came')).toBeDisabled();
    expect(screen.getByTestId('logged-at-door-failure').textContent).toMatch(/started here and not finished/);
    expect(screen.getByTestId('logged-at-door-add').textContent).toBe('Add to the books again');
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-done')).toBeInTheDocument());
    expect(logAtDoor.mock.calls[1][0].key).toBe(logAtDoor.mock.calls[0][0].key);
    expect(logAtDoor.mock.calls[1][0]).toMatchObject({ providerId: 'p-1', inventoryId: 'i-1', quantity: 2, bottlesPerCase: 6 });
    // Finished: the next opening is a new truck.
    expect(localStorage.getItem('mudavym:door:no-order-pending:r-1')).toBeNull();
  });

  // F-1501: a dropped answer left the fields open under the spent id.
  it('after a dropped answer, holds the fields, says it may be on the books, and retries the same id', async () => {
    logAtDoor
      .mockRejectedValueOnce({ request: {}, message: 'timeout of 30000ms exceeded' })
      .mockResolvedValueOnce({ orderId: 'o-1', orderNumber: null, loggedAtDoor: true, placedOnStated: null, orderAlreadyWritten: true });
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-failure')).toBeInTheDocument());
    const said = screen.getByTestId('logged-at-door-failure').textContent ?? '';
    expect(said).toMatch(/may already be on the books/);
    expect(said).not.toMatch(/timeout/);
    expect(screen.getByLabelText('What came?')).toBeDisabled();
    expect(screen.getByLabelText('How many came')).toBeDisabled();
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-done')).toBeInTheDocument());
    expect(logAtDoor.mock.calls[1][0].key).toBe(logAtDoor.mock.calls[0][0].key);
  });

  it('after a refusal that wrote nothing, an edit sends a new id bound to the new answers', async () => {
    logAtDoor
      .mockRejectedValueOnce({ response: { status: 400, data: { reason: 'phone_day_unreadable', message: 'Nothing was booked.' } } })
      .mockResolvedValueOnce({ orderId: 'o-2', orderNumber: null, loggedAtDoor: true, placedOnStated: null, orderAlreadyWritten: false });
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-failure')).toBeInTheDocument());
    expect(screen.getByLabelText('How many came')).not.toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Don’t know' }));
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-done')).toBeInTheDocument());
    expect(logAtDoor.mock.calls[1][0].key).not.toBe(logAtDoor.mock.calls[0][0].key);
  });

  it('a 409 says what it is, and offers no tap that would only repeat it', async () => {
    logAtDoor.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          reason: 'logged_count_differs',
          orderId: 'o-1',
          message: 'This delivery was already added to the books and counted into stock with a different count, so nothing new was added.',
        },
      },
    });
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByTestId('logged-at-door-add'));
    await waitFor(() => expect(screen.getByTestId('logged-at-door-failure')).toBeInTheDocument());
    expect(screen.getByTestId('logged-at-door-failure').textContent).toMatch(/already added.*different count/);
    expect(screen.getByTestId('logged-at-door-failure').textContent).not.toMatch(/did not reach stock/);
    expect(screen.queryByTestId('logged-at-door-add')).toBeNull();
    expect(localStorage.getItem('mudavym:door:no-order-pending:r-1')).toBeNull();
  });

  // F-1528: the door takes every drink, not only wine.
  it('asks for the drink, not the wine', () => {
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    const picker = screen.getByLabelText('What came?') as HTMLSelectElement;
    expect(picker.options[0].textContent).toBe('Choose a drink');
    fireEvent.change(screen.getByLabelText('Who brought it?'), { target: { value: 'p-1' } });
    expect(screen.getByText('Choose the drink.')).toBeInTheDocument();
    expect(screen.queryByText(/wine/i)).toBeNull();
  });

  // F-1502: two vintages of one wine read as two identical options.
  it('tells two vintages of the same wine apart in the picker, with the size when it is not a standard bottle', () => {
    render(<NoOrderOnFileSheet open onClose={() => {}} />);
    const labels = Array.from((screen.getByLabelText('What came?') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toContain('Barolo · Vietti · 2018');
    expect(labels).toContain('Barolo · Vietti · 2019 · 1500 ml');
    expect(doorWineLabel({ wineName: 'Barolo 2018', wineVintage: 2018 })).toBe('Barolo 2018');
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
