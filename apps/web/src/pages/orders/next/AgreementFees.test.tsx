/**
 * The money outside the price of the wine, on the page — ADR 0119 phase 2, Q3.
 *
 * The founder's decision of 2026-09-05: *allowance, deposit, freight as their
 * own columns on the agreement line, mirroring the invoice; the total prints
 * its working.* This file is the page's half of that, and each case is a way
 * `/orders` could go back to hiding a charge inside a price:
 *
 *  1. the sheet asks for all three, and nothing is preselected or defaulted;
 *  2. a deposit changes the total AND shows up in the working, so the desk
 *     never sees a figure move without being told why;
 *  3. an empty field is not a zero — the POST body omits the key entirely, so
 *     the column stays NULL and nobody has claimed the vendor charges nothing;
 *  4. a typed zero IS a claim and does travel;
 *  5. the ledger row prints the fees an agreement names, and the goods figure
 *     beside them, so a deposit can never be read as the wine costing more;
 *  6. a row whose route never read the fee columns says so, rather than
 *     printing the absence of a read as "no deposit";
 *  7. `agreementTotal` with no fees returns byte for byte what it returned
 *     before this pass — no existing figure moves.
 *
 * None of these passes against the page at `611f7682`: `AgreementSheet` had no
 * fee fields, `agreementTotal` had no `fees` argument and returned no `goods`,
 * and `LedgerRow` had nothing to print.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const postMock = vi.hoisted(() =>
  vi.fn(async (_url: string, _body: unknown) => ({ data: { id: 'new-order' } })),
);

vi.mock('@/services/api/client', () => ({
  apiClient: { post: postMock },
  getErrorMessage: (e: unknown) =>
    (e as { message?: string })?.message ?? 'An unexpected error occurred',
  getActiveRestaurantId: () => 'rest-1',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-1', user: { restaurantId: 'rest-1' } }),
}));

const inventoryState = vi.hoisted(() => ({
  data: [{ id: 'inv-1', wineName: 'Barolo Riserva', wineVintage: 2016 }] as unknown[],
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
vi.mock('@/services/api/orders', () => ({ mintOrderSeal: vi.fn(async () => 'seal') }));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMarkOrderDelivered: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

import { AgreementSheet } from './AgreementSheet';
import { LedgerRow } from './LedgerRow';
import { toRow } from './useOrdersNextData';
import {
  ROW_FEES_NOT_READ,
  agreementTotal,
  describeFees,
  readFeesFromWire,
} from './price-unit';

const NO_PROVIDERS = new Map<string, string>();

function mountSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgreementSheet open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** Five cases of twelve at $420 per case — $2,100 of goods. */
function fillCaseAgreement() {
  fireEvent.change(screen.getByLabelText('Wine'), { target: { value: 'inv-1' } });
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'prov-1' } });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Order unit'), { target: { value: 'case' } });
  fireEvent.change(screen.getByLabelText('Bottles in one order unit'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Agreed price'), { target: { value: '420' } });
  fireEvent.change(screen.getByTestId('price-uom'), { target: { value: 'case' } });
  fireEvent.change(screen.getByTestId('price-pack'), { target: { value: '12' } });
}

function wire(over: Record<string, unknown> = {}) {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'i-1',
    providerId: 'p-1',
    quantity: 5,
    unitType: 'case',
    bottlesTotal: 60,
    finalPrice: 420,
    totalCost: 2100,
    status: 'PENDING',
    requestedAt: '2026-09-01T10:00:00Z',
    wineName: 'Barolo Riserva',
    priceUom: 'case',
    pricePackSize: 12,
    allowance: null,
    deposit: null,
    freight: null,
    ...over,
  } as never;
}

function mountRow(over: Record<string, unknown> = {}) {
  const row = toRow(wire(over), NO_PROVIDERS);
  render(
    <LedgerRow
      row={row}
      expanded
      onToggle={() => {}}
      selected={false}
      onSelectChange={() => {}}
      bulkRunning={false}
    />,
  );
  return row;
}

beforeEach(() => {
  postMock.mockClear();
  postMock.mockResolvedValue({ data: { id: 'new-order' } });
});

describe('the sheet asks for the money outside the price', () => {
  it('1. offers all three, empty, with no default', () => {
    mountSheet();
    for (const id of ['fee-allowance', 'fee-deposit', 'fee-freight']) {
      expect((screen.getByTestId(id) as HTMLInputElement).value).toBe('');
    }
    // And no split-case fee field, ever: Q6 says a split case is its own line.
    expect(screen.queryByTestId('fee-split-case')).toBeNull();
  });

  it('2. moves the total and prints the working when a fee is stated', () => {
    mountSheet();
    fillCaseAgreement();
    expect(screen.getByTestId('agreement-total').textContent).toContain('2,100');

    fireEvent.change(screen.getByTestId('fee-deposit'), { target: { value: '30' } });
    fireEvent.change(screen.getByTestId('fee-freight'), { target: { value: '48' } });
    fireEvent.change(screen.getByTestId('fee-allowance'), { target: { value: '100' } });

    expect(screen.getByTestId('agreement-total').textContent).toContain('2,078');
    const working = screen.getByTestId('agreement-working').textContent ?? '';
    expect(working).toContain('Goods $2100.00');
    expect(working).toContain('less allowance $100.00');
    expect(working).toContain('plus deposit $30.00');
    expect(working).toContain('plus freight $48.00');
    // The figure is printed once, above; the sentence does not repeat it.
    expect(working).not.toContain('= $2078.00');
  });

  it('3. sends NO key for a field left empty, so the column stays NULL', async () => {
    mountSheet();
    fillCaseAgreement();
    fireEvent.click(screen.getByTestId('agreement-save'));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const body = postMock.mock.calls[0][1] as Record<string, unknown>;
    expect(body.allowance).toBeUndefined();
    expect(body.deposit).toBeUndefined();
    expect(body.freight).toBeUndefined();
    // The pair still travels, so this is not a body that lost everything.
    expect(body.priceUom).toBe('case');
  });

  it('4. sends a typed zero, because a stated zero is a claim about a vendor', async () => {
    mountSheet();
    fillCaseAgreement();
    fireEvent.change(screen.getByTestId('fee-deposit'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('agreement-save'));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const body = postMock.mock.calls[0][1] as Record<string, unknown>;
    expect(body.deposit).toBe(0);
    expect(body.allowance).toBeUndefined();
  });
});

describe('the ledger row prints what the agreement charges beyond the wine', () => {
  it('5. names the fees inside the working, with the goods stated separately', () => {
    mountRow({ allowance: null, deposit: 30, freight: 48 });
    const working = screen.getByTestId('row-working').textContent ?? '';
    expect(working).toContain('Goods $2100.00');
    expect(working).toContain('plus deposit $30.00');
    expect(working).toContain('plus freight $48.00');
    // The goods figure stands on its own, so the $2,178 total can never be
    // read as the wine having gone up. And the fees are NOT printed a second
    // time on their own line — the first capture of this pass did that.
    expect(screen.queryByTestId('row-fees')).toBeNull();
  });

  it('5b. prints the fees on their own line when there is no working to hold them', () => {
    // An agreement with fees but no stated price unit shows no arithmetic at
    // all, so without this line its deposit is invisible on the row a manager
    // approves money from.
    mountRow({ priceUom: null, pricePackSize: null, deposit: 30, freight: 48 });
    const line = screen.getByTestId('row-fees').textContent ?? '';
    expect(line).toContain('a deposit of $30.00');
    expect(line).toContain('freight of $48.00');
  });

  it('5c. prints nothing at all when the agreement names none', () => {
    mountRow();
    expect(screen.queryByTestId('row-fees')).toBeNull();
    expect(screen.queryByTestId('fees-unread')).toBeNull();
  });

  it('6. says so when the route never read the fee columns', () => {
    const row = toRow(
      {
        id: 'o-1',
        orderNumber: 'ORD-1',
        restaurantId: 'r-1',
        inventoryId: 'i-1',
        providerId: 'p-1',
        quantity: 5,
        unitType: 'case',
        bottlesTotal: 60,
        finalPrice: 420,
        totalCost: 2100,
        status: 'PENDING',
        wineName: 'Barolo',
        priceUom: 'case',
        pricePackSize: 12,
      } as never,
      NO_PROVIDERS,
    );
    expect(row.fees.read).toBe(false);
    render(
      <LedgerRow
        row={row}
        expanded
        onToggle={() => {}}
        selected={false}
        onSelectChange={() => {}}
        bulkRunning={false}
      />,
    );
    expect(screen.getByTestId('fees-unread').textContent).toBe(ROW_FEES_NOT_READ);
    expect(screen.queryByTestId('row-fees')).toBeNull();
  });
});

describe('the arithmetic', () => {
  const fiveCasesOfTwelve = {
    price: 420,
    stated: { priceUom: 'case' as const, pricePackSize: 12 },
    quantity: 5,
    unitType: 'case' as const,
    bottlesPerUnit: 12,
  };

  it('7. is unchanged when no fee is stated — same number AND same sentence', () => {
    const before = agreementTotal(fiveCasesOfTwelve);
    const after = agreementTotal({
      ...fiveCasesOfTwelve,
      fees: { allowance: null, deposit: null, freight: null },
    });
    expect(before?.ok && before.total).toBe(2100);
    expect(after?.ok && after.total).toBe(2100);
    expect(after?.ok && after.working).toBe(before?.ok ? before.working : null);
    // And the goods figure is the total, not a second number to reconcile.
    expect(after?.ok && after.goods).toBe(2100);
  });

  it('tells an unstated fee from a stated zero, and a typo from both', () => {
    expect(readFeesFromWire({}).read).toBe(false);
    expect(readFeesFromWire({ deposit: null }).read).toBe(true);
    expect(readFeesFromWire({ deposit: null }).fees.deposit).toBeNull();
    expect(readFeesFromWire({ deposit: 0 }).fees.deposit).toBe(0);
    // A negative is refused by the database CHECK, so the page reads it as
    // unstated rather than showing a total the save would 400 on.
    expect(readFeesFromWire({ freight: -5 as number }).fees.freight).toBeNull();
  });

  it('says nothing when there is nothing to say', () => {
    expect(
      describeFees({ allowance: null, deposit: null, freight: null }),
    ).toBeNull();
    expect(describeFees({ allowance: 25, deposit: null, freight: null })).toBe(
      'an allowance of $25.00',
    );
  });
});
