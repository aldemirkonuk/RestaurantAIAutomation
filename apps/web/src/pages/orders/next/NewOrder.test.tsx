/**
 * "A new order" and "Add a vendor first" — the two owed acts on `/orders`.
 *
 * THE REGRESSION. Every assertion under "the act" fails against a copy of the
 * pre-packet `OrdersNext.tsx`, because the page had no manual create path at
 * all: `AgreementSheet` writes ONE line and `DraftRail` shows what the engine
 * drafted. What the legacy desk could do and the rebuilt page could not is the
 * CART — several lines placed together — and the honest account of which of
 * them landed, which is the ordinary case when one line is one POST.
 *
 * The four states are asserted as four: an unreadable shelf and an unreadable
 * vendor list each say they are unreadable rather than empty; a refused line
 * keeps its words and says nothing was written; and the permission/refusal
 * state — the gateway's 403 `no_vendors` — hands the page the guard panel
 * instead of a toast.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const shelf = vi.hoisted(() => ({ value: { data: [] as unknown[], isLoading: false, isError: false, error: null as unknown } }));
const vendorList = vi.hoisted(() => ({ value: { data: [] as unknown[], isLoading: false, isError: false, error: null as unknown } }));

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    post: (...args: unknown[]) => api.post(...args),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', user: { restaurantId: 'rest-A' } }),
}));

vi.mock('@/hooks/queries/useInventoryQueries', () => ({
  useInventory: () => shelf.value,
}));

vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => vendorList.value,
}));

import { NewOrderSheet, lineRefusal } from './NewOrderSheet';
import { VendorFirstPanel } from './VendorFirstPanel';

const ITEM = { id: 'inv-1', wineName: 'Öküzgözü 2022', producer: 'Kavaklıdere' };
const ITEM2 = { id: 'inv-2', wineName: 'Chianti Classico 2021', producer: 'Banfi' };
const VENDOR = { id: 'prov-1', name: 'Kavaklıdere' };

function draw(props: Partial<React.ComponentProps<typeof NewOrderSheet>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NewOrderSheet open onClose={() => {}} onNoVendors={() => {}} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Add one line for `item` and fill in the vendor and a quantity. */
async function addLine(item = ITEM, qty = '5') {
  fireEvent.change(screen.getByTestId('new-order-search'), {
    target: { value: item.wineName.slice(0, 5) },
  });
  fireEvent.click(await screen.findByText(new RegExp(item.wineName)));
  const lines = screen.getAllByTestId('new-order-line');
  const line = within(lines[lines.length - 1]);
  fireEvent.change(line.getByTestId('new-order-vendor'), { target: { value: VENDOR.id } });
  fireEvent.change(line.getByTestId('new-order-qty'), { target: { value: qty } });
  return line;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockResolvedValue({ data: { state: 'none', sentence: 'No agreed price with Kavaklıdere is on file for this item.' } });
  api.post.mockResolvedValue({ data: { id: 'ord-1', orderNumber: 'PO-118' } });
  shelf.value = { data: [ITEM, ITEM2], isLoading: false, isError: false, error: null };
  vendorList.value = { data: [VENDOR], isLoading: false, isError: false, error: null };
});

describe('the shape and the primitive', () => {
  it('is a sheet, named by its contract, closing in words', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'sheet');
    expect(dialog).toHaveAttribute('data-motion', 'tuck');
    expect(screen.getByRole('button', { name: 'Put it down' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /A new order/ })).toBeInTheDocument();
  });

  it('the guard is a panel, not a sheet', () => {
    render(
      <MemoryRouter>
        <VendorFirstPanel open reason="before" onClose={() => {}} />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'panel');
    expect(dialog).toHaveAttribute('data-motion', 'settle');
  });
});

describe('the act — the cart the rebuilt page could not build', () => {
  it('places one order per line and names the order each became', async () => {
    api.post
      .mockResolvedValueOnce({ data: { orderNumber: 'PO-118' } })
      .mockResolvedValueOnce({ data: { orderNumber: 'PO-119' } });
    draw();
    await addLine(ITEM, '5');
    await addLine(ITEM2, '2');
    fireEvent.click(screen.getByTestId('new-order-place'));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/procurement/orders',
      expect.objectContaining({ inventoryId: 'inv-1', providerId: 'prov-1', quantity: 5 }),
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/procurement/orders',
      expect.objectContaining({ inventoryId: 'inv-2', quantity: 2 }),
    );
    const outcomes = await screen.findAllByTestId('new-order-line-outcome');
    expect(outcomes.map((o) => o.textContent)).toEqual([
      expect.stringContaining('PO-118'),
      expect.stringContaining('PO-119'),
    ]);
    expect(screen.getByTestId('new-order-tally')).toHaveTextContent(/All 2 lines were placed/);
  });

  it('reports a partial placement as a partial one, keeping the refused line', async () => {
    api.post
      .mockResolvedValueOnce({ data: { orderNumber: 'PO-118' } })
      .mockRejectedValueOnce(
        Object.assign(new Error('an order in cases needs a pack size'), {
          response: { status: 400 },
        }),
      );
    draw();
    await addLine(ITEM, '5');
    await addLine(ITEM2, '2');
    fireEvent.click(screen.getByTestId('new-order-place'));

    await waitFor(() => expect(screen.getByTestId('new-order-tally')).toBeInTheDocument());
    expect(screen.getByTestId('new-order-tally')).toHaveTextContent(/1 of 2 were placed/);
    const bad = screen.getAllByTestId('new-order-line-outcome')[1];
    expect(bad).toHaveAttribute('data-ok', 'false');
    expect(bad).toHaveTextContent('an order in cases needs a pack size');
    expect(bad).toHaveTextContent('Nothing was written for this line');
    // The line survives with its words. A cart that cleared itself would lose them.
    expect(screen.getAllByTestId('new-order-line')).toHaveLength(2);
  });

  it('refuses a case order with no pack size BEFORE the round trip', async () => {
    draw();
    const line = await addLine(ITEM, '5');
    fireEvent.change(line.getByTestId('new-order-unit'), { target: { value: 'case' } });
    expect(screen.getByTestId('new-order-line-refusal')).toHaveTextContent(/needs a pack size/);
    expect(screen.getByTestId('new-order-place')).toBeDisabled();
    fireEvent.change(line.getByTestId('new-order-pack'), { target: { value: '12' } });
    await waitFor(() => expect(screen.getByTestId('new-order-place')).not.toBeDisabled());
  });

  it('sends no price at all when none was stated — never a zero', async () => {
    draw();
    await addLine(ITEM, '3');
    fireEvent.click(screen.getByTestId('new-order-place'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.quotedPrice).toBeUndefined();
    expect(body).not.toHaveProperty('restaurantId');
  });
});

describe('the agreement is offered, never applied', () => {
  it('asks the new route for the pair and shows what it answered', async () => {
    api.get.mockResolvedValue({
      data: {
        state: 'found',
        price: 2400,
        priceUom: 'case',
        pricePackSize: 12,
        currency: 'TRY',
        sentence: 'Last agreed with Kavaklıdere on 2026-09-01: TRY 2400 per case of 12.',
      },
    });
    draw();
    await addLine(ITEM, '5');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/procurement/last-agreement', {
        params: { providerId: 'prov-1', inventoryId: 'inv-1' },
      }),
    );
    const offer = await screen.findByTestId('new-order-offer');
    expect(offer).toHaveAttribute('data-state', 'found');
    // Offered, not applied: the price field is still empty until it is taken.
    expect(screen.getByTestId('new-order-price')).toHaveValue('');
    fireEvent.click(screen.getByTestId('new-order-take-offer'));
    expect(screen.getByTestId('new-order-price')).toHaveValue('2400');
  });

  it('tells "no agreement on file" from "we could not look"', async () => {
    api.get.mockResolvedValue({
      data: { state: 'unreadable', sentence: 'The last agreement could not be read.' },
    });
    draw();
    await addLine(ITEM, '5');
    const offer = await screen.findByTestId('new-order-offer');
    expect(offer).toHaveAttribute('data-state', 'unreadable');
    // No "Take it": there is nothing to take, and offering one would be a figure
    // invented by a failed read.
    expect(screen.queryByTestId('new-order-take-offer')).toBeNull();
  });

  it('turns a thrown request into "unreadable", not into silence', async () => {
    api.get.mockRejectedValue(new Error('no route'));
    draw();
    await addLine(ITEM, '5');
    const offer = await screen.findByTestId('new-order-offer');
    expect(offer).toHaveAttribute('data-state', 'unreadable');
    expect(offer).toHaveTextContent(/not an empty book/);
  });
});

describe('four states, honestly', () => {
  it('says an unreadable shelf is unreadable, not empty', () => {
    shelf.value = { data: [], isLoading: false, isError: true, error: new Error('boom') };
    draw();
    expect(screen.getByTestId('new-order-shelf-error')).toHaveTextContent(
      /this is not an empty shelf/,
    );
  });

  it('says an unreadable vendor list is unreadable, not a house with no vendors', () => {
    vendorList.value = { data: [], isLoading: false, isError: true, error: new Error('boom') };
    draw();
    expect(screen.getByTestId('new-order-vendor-error')).toHaveTextContent(
      /not a house with no vendors/,
    );
  });

  it('hands the page the guard when the gateway refuses with no_vendors', async () => {
    const onNoVendors = vi.fn();
    api.post.mockRejectedValue(
      Object.assign(new Error('no active vendors'), {
        response: { status: 403, data: { reason: 'no_vendors' } },
      }),
    );
    draw({ onNoVendors });
    await addLine(ITEM, '5');
    fireEvent.click(screen.getByTestId('new-order-place'));
    await waitFor(() => expect(onNoVendors).toHaveBeenCalled());
    expect(screen.getByTestId('new-order-tally')).toHaveTextContent(/Nothing was placed/);
  });

  it('the empty list is said in words, never drawn as a blank panel', () => {
    draw();
    expect(screen.getByText(/No lines yet/)).toBeInTheDocument();
  });
});

describe('the guard says which way it was reached', () => {
  it('before the write: an order needs somebody to send it to', () => {
    render(
      <MemoryRouter>
        <VendorFirstPanel open reason="before" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('vendor-first-reason')).toHaveTextContent(
      /no vendor in the book yet/,
    );
  });

  it('after the refusal: the order was NOT placed, and it says so first', () => {
    render(
      <MemoryRouter>
        <VendorFirstPanel open reason="refused" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('vendor-first-reason')).toHaveTextContent(
      /The order was not placed/,
    );
    expect(screen.getByTestId('vendor-first-reason')).toHaveTextContent(/Nothing was written/);
  });
});

describe('lineRefusal, on its own', () => {
  const base = {
    key: 'k',
    inventoryId: 'i',
    wineName: 'w',
    providerId: 'p',
    quantity: '2',
    unitType: 'bottle' as const,
    bottlesPerUnit: '',
    price: '',
    notes: '',
    offer: null,
    asking: false,
    outcome: null,
  };

  it('names each refusal, and nothing when the line is placeable', () => {
    expect(lineRefusal(base)).toBeNull();
    expect(lineRefusal({ ...base, providerId: '' })).toMatch(/Name the vendor/);
    expect(lineRefusal({ ...base, quantity: '' })).toMatch(/State how many/);
    expect(lineRefusal({ ...base, quantity: '2.5' })).toMatch(/whole number/);
    expect(lineRefusal({ ...base, unitType: 'case' })).toMatch(/pack size/);
    expect(lineRefusal({ ...base, unitType: 'case', bottlesPerUnit: '12' })).toBeNull();
    expect(lineRefusal({ ...base, price: '0' })).toMatch(/above zero/);
  });
});
