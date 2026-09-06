/**
 * The agreed price states its unit, on the page — ADR 0119 phase 1.
 *
 * Each case below is a way `/orders` could go back to lying about a price:
 *
 *  1. the picker offers the order's own seven words and NOTHING is preselected
 *     — a preselected `bottle` is the assumption the schema change removes,
 *     put back by the UI;
 *  2. the pack field appears only for a unit that holds more than one, and the
 *     price label reads "per case" rather than a bare number;
 *  3. the header total is drawn from the PAIR — five cases of twelve at $420
 *     per case is $2,100, and the pre-fix arithmetic (`finalPrice × bottles`,
 *     `procurement.service.ts:529` at 129fbfc6) gives $25,200, which is
 *     asserted here as the number the page must NOT show;
 *  4. a per-bottle price on a case order totals by the bottle and says the two
 *     units differing is ordinary;
 *  5. an agreement with no stated unit shows the REGISTER's refusal before it
 *     is saved — never a silent save (ADR 0083);
 *  6. half a statement blocks the save with the sentence the gateway answers;
 *  7. a price unit the order cannot be counted in shows the refusal and blocks;
 *  8. the POST body actually carries the pair;
 *  9. a gateway refusal is printed verbatim, and nothing is claimed to be saved;
 * 10. a shelf that could not be read says so, rather than looking empty.
 *
 * None of these passes against the page as it stood at `129fbfc6`: there was no
 * composer on the rebuilt `/orders` at all, so every assertion here is about a
 * control that did not exist and a total that could not be computed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const postMock = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'new-order' } })));

vi.mock('@/services/api/client', () => ({
  apiClient: { post: postMock },
  getErrorMessage: (e: unknown) =>
    (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data
      ?.message ??
    (e as { message?: string })?.message ??
    'An unexpected error occurred',
  getActiveRestaurantId: () => 'rest-1',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-1', user: { restaurantId: 'rest-1' } }),
}));

const inventoryState = vi.hoisted(() => ({
  data: [
    { id: 'inv-1', wineName: 'Barolo Riserva', wineVintage: 2016 },
    { id: 'inv-2', wineName: 'Chablis 1er Cru', wineVintage: 2021 },
  ] as unknown[],
  isLoading: false,
  isError: false,
  error: null as unknown,
}));

const providerState = vi.hoisted(() => ({
  data: [{ id: 'prov-1', name: 'Anadolu Şarap' }] as unknown[],
  isLoading: false,
  isError: false,
  error: null as unknown,
}));

vi.mock('@/hooks/queries/useInventoryQueries', () => ({
  useInventory: () => inventoryState,
}));
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => providerState,
}));

import { AgreementSheet } from './AgreementSheet';
import { agreementTotal, describeStatedPrice } from './price-unit';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgreementSheet open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** Fill everything except the price unit. */
function fillCaseOrder(opts: { price?: string } = {}) {
  fireEvent.change(screen.getByLabelText('Wine'), { target: { value: 'inv-1' } });
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'prov-1' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Order unit'), { target: { value: 'case' } });
  fireEvent.change(screen.getByLabelText('Bottles in one order unit'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Agreed price'), {
    target: { value: opts.price ?? '420' },
  });
}

beforeEach(() => {
  postMock.mockClear();
  postMock.mockResolvedValue({ data: { id: 'new-order' } });
  inventoryState.isError = false;
  inventoryState.isLoading = false;
  inventoryState.error = null;
  providerState.isError = false;
});

describe('the price-unit picker', () => {
  it('offers the order’s own seven words and preselects none of them', () => {
    mount();
    const picker = screen.getByTestId('price-uom') as HTMLSelectElement;
    expect(picker.value).toBe('');
    const words = Array.from(picker.options).map((o) => o.value);
    expect(words).toEqual([
      '',
      'bottle',
      'case',
      'keg',
      'pack',
      'split_case',
      'each',
      'liter',
    ]);
    expect(screen.getByRole('option', { name: 'per case' })).toBeTruthy();
  });

  it('shows the pack field only for a unit that holds more than one', () => {
    mount();
    expect(screen.queryByTestId('price-pack')).toBeNull();
    fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'bottle' } });
    expect(screen.queryByTestId('price-pack')).toBeNull();
    fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'case' } });
    expect(screen.getByTestId('price-pack')).toBeTruthy();
  });
});

describe('the total is drawn from the pair and says so', () => {
  it('totals five cases of twelve at $420 per case as $2,100, not $25,200', () => {
    mount();
    fillCaseOrder();
    fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'case' } });
    fireEvent.change(screen.getByTestId('price-pack'), { target: { value: '12' } });

    expect(screen.getByTestId('agreement-total').textContent).toBe('$2,100.00');
    // The pre-fix arithmetic, asserted as the number the page must not show.
    expect(screen.getByTestId('agreement-total').textContent).not.toBe('$25,200.00');
    expect(screen.getByTestId('agreement-working').textContent).toContain(
      '60 bottles ÷ 12 = 5 cases',
    );
  });

  it('totals the same order priced per bottle by the bottle, and calls it ordinary', () => {
    mount();
    fillCaseOrder({ price: '35' });
    fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'bottle' } });

    expect(screen.getByTestId('agreement-total').textContent).toBe('$2,100.00');
    expect(screen.getByTestId('agreement-working').textContent).toContain(
      '60 × $35.00 per bottle',
    );
    expect(
      screen.getByText(/a bottle price and a case price are\s+posted separately/i),
    ).toBeTruthy();
  });

  it('leaves the total an em dash rather than a zero while a figure is missing', () => {
    mount();
    expect(screen.getByTestId('agreement-total').textContent).toBe('—');
  });
});

describe('the refusals are said on the page, before the save', () => {
  it('prints the register’s own refusal when no unit is stated', () => {
    mount();
    fillCaseOrder();
    expect(
      screen.getByText(/does not enter the price register/i, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText(/factor of the pack/i, { exact: false })).toBeTruthy();
    // Still savable: a NULL pair is an ordinary, legal row. What is forbidden is
    // saving one without being told.
    expect((screen.getByTestId('agreement-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks the save on half a statement and says why', () => {
    mount();
    fillCaseOrder();
    fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'case' } });
    expect(screen.getByTestId('half-stated').textContent).toContain(
      'how many bottles are in one',
    );
    expect((screen.getByTestId('agreement-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses a price unit the order cannot be counted in', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Wine'), { target: { value: 'inv-1' } });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'prov-1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Order unit'), { target: { value: 'keg' } });
    fireEvent.change(screen.getByLabelText('Agreed price'), { target: { value: '12' } });
    fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'bottle' } });

    expect(screen.getByTestId('agreement-uncountable').textContent).toContain(
      "the order's value cannot be worked out",
    );
    expect(screen.getByTestId('agreement-total').textContent).toBe('—');
    expect((screen.getByTestId('agreement-save') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('what actually leaves the page', () => {
  it('sends the pair with the order', async () => {
    mount();
    fillCaseOrder();
    fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'case' } });
    fireEvent.change(screen.getByTestId('price-pack'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('agreement-save'));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body] = postMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(path).toBe('/procurement/orders');
    expect(body).toMatchObject({
      inventoryId: 'inv-1',
      providerId: 'prov-1',
      quantity: 5,
      unitType: 'case',
      bottlesPerUnit: 12,
      finalPrice: 420,
      priceUom: 'case',
      pricePackSize: 12,
    });
  });

  it('sends no pair at all when none was stated — never a defaulted bottle', async () => {
    mount();
    fillCaseOrder();
    fireEvent.click(screen.getByTestId('agreement-save'));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [, body] = postMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body.priceUom).toBeUndefined();
    expect(body.pricePackSize).toBeUndefined();
  });

  it('prints a gateway refusal verbatim and says nothing was written down', async () => {
    postMock.mockRejectedValueOnce({
      response: {
        data: {
          message:
            'A price stated "per case" also has to say how many bottles are in one case.',
        },
      },
    });
    mount();
    fillCaseOrder();
    fireEvent.click(screen.getByTestId('agreement-save'));

    const said = await screen.findByTestId('agreement-failure');
    expect(said.textContent).toContain('Nothing was written down.');
    expect(said.textContent).toContain('how many bottles are in one case');
  });
});

describe('the lists are honest about not having been read', () => {
  it('says the shelf could not be read rather than showing an empty picker', () => {
    inventoryState.isError = true;
    inventoryState.error = { message: 'Network Error' };
    mount();
    expect(screen.getByText(/The shelf could not be read \(Network Error\)/)).toBeTruthy();
  });
});

describe('the page arithmetic agrees with the words it prints', () => {
  it('describes a case price with its pack and a bottle price without one', () => {
    expect(describeStatedPrice(420, { priceUom: 'case', pricePackSize: 12 })).toBe(
      '$420.00 per case (12 bottles)',
    );
    expect(describeStatedPrice(35, { priceUom: 'bottle', pricePackSize: 1 })).toBe(
      '$35.00 per bottle',
    );
  });

  it('never renders an absent price as $0.00', () => {
    expect(describeStatedPrice(null, null)).toBeNull();
    expect(
      agreementTotal({
        price: null,
        stated: null,
        quantity: 5,
        unitType: 'case',
        bottlesPerUnit: 12,
      }),
    ).toBeNull();
  });
});
