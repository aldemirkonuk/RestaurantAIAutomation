/**
 * The agreement line names its money — ADR 0117 Q31, founder 2026-09-05:
 * *"A currency column on the agreement line, defaulted from the vendor's terms
 * or the house, stated on the sheet"*.
 *
 * WHY EACH ASSERTION IS LOAD-BEARING
 *   1. The default comes from the GATEWAY's chain, not from a second copy in the
 *      browser — the sheet shows the gateway's own sentence, so a person sees
 *      the evidence ("your last invoice from them was in TRY") and not just the
 *      suggestion.
 *   2. A failed or empty resolution offers NOTHING. It must never fall back to
 *      USD: after ADR 0117 Q30 cleared every unattributable `USD` to NULL there
 *      are live houses with no currency at all, and a fallback here would
 *      quietly refill exactly what that pass emptied.
 *   3. "Not stated" is a real answer that sends no `currency` key, so the column
 *      keeps NULL. A defaulted currency is a claim about a vendor nobody made.
 *
 * PRE-FIX PROOF, measured on this tree 2026-09-05:
 *
 *     git show HEAD:apps/web/src/pages/orders/next/AgreementSheet.tsx \
 *       | grep -c currency
 *     0
 *
 * The sheet had no currency control, and `procurement_order_items` had no
 * currency column, so seven money columns on that line named no denomination
 * at all.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Typed as a two-argument post so `postMock.mock.calls[0][1]` — the body — is
// reachable. `vi.fn(async () => …)` infers a zero-length tuple and TS2493s on
// the index, which is the same trap `AgreementFees.test.tsx` is sitting in.
const postMock = vi.hoisted(() =>
  vi.fn(async (_url: string, _body?: unknown) => ({ data: { id: 'new-order' } })),
);
const getMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{
    data: { code: string | null; basis: string | null; sentence: string };
  }> => ({
    data: {
      code: 'TRY',
      basis: 'vendor_paper',
      sentence:
        'Defaulted to TRY: that is what Anadolu Şarap last billed this house in. Change it if this order is priced differently.',
    },
  })),
);

vi.mock('@/services/api/client', () => ({
  apiClient: { post: postMock, get: getMock },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'error',
  getActiveRestaurantId: () => 'rest-1',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-1', user: { restaurantId: 'rest-1' } }),
}));

const inventoryState = vi.hoisted(() => ({
  data: [{ id: 'inv-1', wineName: 'Ancyra Kalecik Karası', wineVintage: 2021 }] as unknown[],
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

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgreementSheet open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function fillBottleOrder() {
  fireEvent.change(screen.getByLabelText('Wine'), { target: { value: 'inv-1' } });
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'prov-1' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('Order unit'), { target: { value: 'bottle' } });
  fireEvent.change(screen.getByLabelText('Agreed price'), { target: { value: '36' } });
  fireEvent.change(screen.getByLabelText('Price unit'), { target: { value: 'bottle' } });
}

beforeEach(() => {
  postMock.mockClear();
  postMock.mockResolvedValue({ data: { id: 'new-order' } });
  getMock.mockClear();
  getMock.mockResolvedValue({
    data: {
      code: 'TRY',
      basis: 'vendor_paper',
      sentence:
        'Defaulted to TRY: that is what Anadolu Şarap last billed this house in. Change it if this order is priced differently.',
    },
  });
});

describe('the agreement currency field', () => {
  it('offers the gateway’s default and prints the gateway’s own reason', async () => {
    mount();
    const field = (await screen.findByLabelText('Currency')) as HTMLSelectElement;
    await waitFor(() => expect(field.value).toBe('TRY'));
    // The EVIDENCE, not just the answer. A person can check "our last invoice
    // from them was in lira"; nobody can check "we suggest TRY".
    expect(screen.getByText(/last billed this house in/)).toBeTruthy();
  });

  it('asks the gateway once the vendor is known, so the answer is vendor-specific', async () => {
    mount();
    await screen.findByLabelText('Currency');
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'prov-1' } });
    await waitFor(() =>
      expect(
        getMock.mock.calls.some(
          (c: unknown[]) =>
            (c[1] as { params?: { providerId?: string } } | undefined)?.params
              ?.providerId === 'prov-1',
        ),
      ).toBe(true),
    );
  });

  it('offers NOTHING — never USD — when neither the vendor nor the house states one', async () => {
    getMock.mockResolvedValue({
      data: {
        code: null,
        basis: null,
        sentence:
          'No currency can be worked out: no invoice from this vendor states one and this house has not recorded the money it reports in.',
      },
    });
    mount();
    const field = (await screen.findByLabelText('Currency')) as HTMLSelectElement;
    await waitFor(() => expect(field.value).toBe(''));
    expect(field.value).not.toBe('USD');
    expect(screen.getByText(/No currency can be worked out/)).toBeTruthy();
  });

  it('offers nothing when the lookup FAILS, rather than a guess', async () => {
    // A failed read is never reported as an answer (ADR 0051).
    getMock.mockRejectedValue(new Error('gateway down'));
    mount();
    const field = (await screen.findByLabelText('Currency')) as HTMLSelectElement;
    await waitFor(() => expect(field.value).toBe(''));
    expect(screen.getByText(/currency not recorded/)).toBeTruthy();
  });

  it('sends the confirmed default with the order', async () => {
    mount();
    await screen.findByLabelText('Currency');
    fillBottleOrder();
    await waitFor(() =>
      expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('TRY'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Write it down|Save|Record/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1]).toMatchObject({ currency: 'TRY' });
  });

  it('sends the person’s change instead of the default', async () => {
    mount();
    await screen.findByLabelText('Currency');
    fillBottleOrder();
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByRole('button', { name: /Write it down|Save|Record/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][1]).toMatchObject({ currency: 'EUR' });
  });

  it('sends NO currency key at all when the person chooses "not stated"', async () => {
    mount();
    await screen.findByLabelText('Currency');
    fillBottleOrder();
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Write it down|Save|Record/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    // `undefined` never reaches the wire, so the column keeps NULL. A `'USD'`
    // here would be the whole defect coming back one layer up.
    expect(postMock.mock.calls[0][1]).toMatchObject({ currency: undefined });
  });
});
