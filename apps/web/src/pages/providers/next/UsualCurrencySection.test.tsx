/**
 * B1 — "This vendor usually invoices in", on the vendor's profile.
 *
 * THE FOUNDER, 2026-09-06, batch 65: *"Every vendor and their profile will show
 * their default currency, but we won't use that as the invoice"*.
 *
 * Four things have to be true and each is pinned here: nothing is pre-filled,
 * the sentence always says what the code is NOT for, a failed read never renders
 * as "this vendor has stated none", and staff see the control DISABLED with the
 * reason rather than not seeing it.
 *
 * `apiClient` is mocked, so these assert what this component does with the
 * gateway's answers, never that the gateway gives them.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const auth = vi.hoisted(() => ({ role: 'manager' as string | null }));

vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: auth.role, user: { role: auth.role } }),
}));

import { UsualCurrencySection } from './UsualCurrencySection';

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UsualCurrencySection providerId="p1" providerName="Bir Dagitim" />
    </QueryClientProvider>,
  );
}

const STATED = {
  providerId: 'p1',
  code: 'TRY',
  setAt: '2026-09-06T09:00:00.000Z',
  setByName: 'Aslı',
  sentence:
    'Bir Dagitim usually invoices in TRY. Stated by Aslı on 2026-09-06. This is offered as the starting currency when an order is placed with them, and it can be changed there. IT NEVER FILES AN INVOICE: an invoice takes the currency printed on it, then the currency of the order it is matched to.',
};

const UNSTATED = {
  providerId: 'p1',
  code: null,
  setAt: null,
  setByName: null,
  sentence:
    'Bir Dagitim has not stated a usual currency. Nothing is assumed in its place — not this house’s currency and not the currency of their last invoice — so an order to them starts with an empty currency field.',
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'manager';
});

describe('UsualCurrencySection', () => {
  it('prints the code, the person and the date, and the gateway’s own sentence', async () => {
    api.get.mockResolvedValue({ data: STATED });
    renderIt();

    expect(await screen.findByTestId('vendor-usual-currency-code')).toHaveTextContent(
      'TRY',
    );
    expect(screen.getByText(/stated by Aslı on 2026-09-06/)).toBeInTheDocument();
    // The load-bearing clause, rendered verbatim rather than paraphrased.
    expect(screen.getByText(/NEVER FILES AN INVOICE/)).toBeInTheDocument();
  });

  it('a vendor nobody has asked gets an em dash and a sentence, never an empty box', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    renderIt();

    expect(await screen.findByTestId('vendor-usual-currency-code')).toHaveTextContent(
      '—',
    );
    expect(screen.getByText(/has not stated a usual currency/)).toBeInTheDocument();
  });

  it('OFFERS NOTHING as a starting value: the select opens empty', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    renderIt();
    const select = (await screen.findByTestId(
      'vendor-usual-currency-select',
    )) as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('does NOT pre-select the stored code either — saving must be an act', async () => {
    api.get.mockResolvedValue({ data: STATED });
    renderIt();
    const select = (await screen.findByTestId(
      'vendor-usual-currency-select',
    )) as HTMLSelectElement;
    // A field pre-filled with the current value makes "I re-saved what was
    // there" indistinguishable from "I chose this", which is what the author
    // column exists to tell apart.
    expect(select.value).toBe('');
  });

  it('writes the chosen code and renders the server’s sentence', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    api.patch.mockResolvedValue({
      data: { sentence: 'Stated as EUR. It files no invoice.' },
    });
    renderIt();

    const select = await screen.findByTestId('vendor-usual-currency-select');
    fireEvent.change(select, { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('vendor-usual-currency-save'));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/providers/p1/usual-currency', {
        currency: 'EUR',
      }),
    );
    expect(await screen.findByText(/It files no invoice/)).toBeInTheDocument();
  });

  it('shows staff the control DISABLED with the reason, never hidden', async () => {
    auth.role = 'staff';
    api.get.mockResolvedValue({ data: UNSTATED });
    renderIt();

    expect(await screen.findByTestId('vendor-usual-currency-select')).toBeDisabled();
    expect(screen.getByTestId('vendor-usual-currency-save')).toBeDisabled();
    expect(screen.getByText(/signed in as staff/)).toBeInTheDocument();
    expect(screen.getByText(/Ask a manager or an owner/)).toBeInTheDocument();
  });

  it('A FAILED READ IS NEVER AN EMPTY ONE: it says so instead of “has not stated”', async () => {
    api.get.mockRejectedValue(
      Object.assign(new Error('boom'), {
        response: { data: { message: "This vendor's usual currency could not be read." } },
      }),
    );
    renderIt();

    expect(
      await screen.findByText(/could not be read/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/has not stated a usual currency/)).toBeNull();
    // And no control is offered over a fact we do not have.
    expect(screen.queryByTestId('vendor-usual-currency-select')).toBeNull();
  });

  it('renders a failed WRITE as itself and does not claim the code changed', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    api.patch.mockRejectedValue(
      Object.assign(new Error('boom'), {
        response: { data: { message: 'This vendor was NOT changed (write refused).' } },
      }),
    );
    renderIt();

    const select = await screen.findByTestId('vendor-usual-currency-select');
    fireEvent.change(select, { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('vendor-usual-currency-save'));

    expect(await screen.findByText(/NOT changed/)).toBeInTheDocument();
    expect(screen.getByTestId('vendor-usual-currency-code')).toHaveTextContent('—');
  });
});
