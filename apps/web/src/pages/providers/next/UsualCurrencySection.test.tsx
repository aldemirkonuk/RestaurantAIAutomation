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

function renderIt(takeFocus?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsualCurrencySection
        providerId="p1"
        providerName="Bir Dagitim"
        takeFocus={takeFocus}
      />
    </QueryClientProvider>,
  );
}

const STATED = {
  providerId: 'p1',
  code: 'TRY',
  setAt: '2026-09-06T09:00:00.000Z',
  setByName: 'Aslı',
  houseZone: 'Europe/Istanbul',
  sentence:
    'Bir Dagitim usually invoices in TRY. Stated by Aslı on Sep 6, 2026. This is offered as the starting currency when an order is placed with them, and it can be changed there. IT NEVER FILES AN INVOICE: an invoice takes the currency printed on it, then the currency of the order it is matched to.',
};

const UNSTATED = {
  providerId: 'p1',
  code: null,
  setAt: null,
  setByName: null,
  sentence:
    'Bir Dagitim has not stated a usual currency. Nothing is assumed in its place — not this house’s currency and not the currency of their last invoice — so an order to them starts with an empty currency field.',
};

// jsdom implements no layout, so `scrollIntoView` does not exist on an element
// there. The component calls it optionally for exactly that reason; the spy
// both proves it was called and stands in for the missing implementation.
const scrolled = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'manager';
  scrolled.mockClear();
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
    scrolled;
});

/*
 * ARRIVING FROM THE CURRENCY PROMPT (Sonnet audit of 795d9c27, finding 9).
 *
 * The coverage panel on /providers and the empty currency field on the order
 * sheet both link HERE. Before these tests the sheet opened at its top, four
 * sections above this one, and both page notes claimed the link landed "at the
 * control" — a claim no code made true.
 */
describe('UsualCurrencySection, opened from the currency prompt', () => {
  it('scrolls itself into view and takes the control’s focus', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    renderIt(true);
    const select = await screen.findByTestId('vendor-usual-currency-select');
    await waitFor(() => expect(select).toHaveFocus());
    expect(scrolled).toHaveBeenCalled();
  });

  it('does neither when the sheet was opened by clicking the vendor’s card', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    renderIt();
    const select = await screen.findByTestId('vendor-usual-currency-select');
    expect(select).not.toHaveFocus();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('takes focus ONCE, so a refetch cannot yank the caret back', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    const { rerender } = renderIt(true);
    const select = await screen.findByTestId('vendor-usual-currency-select');
    await waitFor(() => expect(select).toHaveFocus());

    (select as HTMLSelectElement).blur();
    scrolled.mockClear();
    rerender(<div />);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('brings a staff member to the section even though the control refuses them', async () => {
    // A disabled control cannot hold focus. The scroll is what makes the link
    // honest for a person who may not use it: they land on the sentence that
    // says who can.
    auth.role = 'staff';
    api.get.mockResolvedValue({ data: UNSTATED });
    renderIt(true);
    await screen.findByTestId('vendor-usual-currency-select');
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
  });
});

describe('UsualCurrencySection', () => {
  it('prints the code, the person and the date, and the gateway’s own sentence', async () => {
    api.get.mockResolvedValue({ data: STATED });
    renderIt();

    expect(await screen.findByTestId('vendor-usual-currency-code')).toHaveTextContent(
      'TRY',
    );
    expect(screen.getByText(/stated by Aslı on Sep 6, 2026/)).toBeInTheDocument();
    // The load-bearing clause, rendered verbatim rather than paraphrased.
    expect(screen.getByText(/NEVER FILES AN INVOICE/)).toBeInTheDocument();
  });

  // VEN-W23 (founder, 2026-10-01): 9:20 pm on Oct 1 in Chicago is 02:20 UTC on
  // Oct 2. The chip used to slice the UTC timestamp and said "2026-10-02".
  it('reads “stated on” as the HOUSE’s calendar day, in words', async () => {
    api.get.mockResolvedValue({
      data: { ...STATED, code: 'USD', setAt: '2026-10-02T02:20:00.000Z', houseZone: 'America/Chicago' },
    });
    renderIt();
    expect(await screen.findByText(/stated by Aslı on Oct 1, 2026$/)).toBeInTheDocument();
    expect(screen.queryByText(/2026-10-02/)).toBeNull();
  });

  it('with no house zone reads UTC and says so, never the reader’s clock', async () => {
    api.get.mockResolvedValue({
      data: { ...STATED, code: 'USD', setAt: '2026-10-02T02:20:00.000Z', houseZone: null },
    });
    renderIt();
    expect(await screen.findByText(/stated by Aslı on Oct 2, 2026 \(UTC\)/)).toBeInTheDocument();
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

  it('a saved code marks the page’s coverage panel stale, so it stops saying none are on file', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    api.patch.mockResolvedValue({ data: { sentence: 'Stated as EUR.' } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <UsualCurrencySection providerId="p1" providerName="Bir Dagitim" />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByTestId('vendor-usual-currency-select'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('vendor-usual-currency-save'));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['vendor-usual-currency-coverage'] }),
    );
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
    // VEN-W29: a failed read offers a retry, and the retry reads again.
    const before = api.get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(before));
  });

  it('renders a failed WRITE as itself and does not claim the code changed', async () => {
    api.get.mockResolvedValue({ data: UNSTATED });
    api.patch.mockRejectedValue(
      Object.assign(new Error('boom'), {
        response: { status: 503, data: { message: 'This vendor was NOT changed (write refused).' } },
      }),
    );
    renderIt();

    const select = await screen.findByTestId('vendor-usual-currency-select');
    fireEvent.change(select, { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('vendor-usual-currency-save'));

    // A 5xx sentence is not passed on (VEN-W27): the page's own words stand.
    expect(await screen.findByText('The currency was not changed.')).toBeInTheDocument();
    expect(screen.queryByText(/NOT changed/)).not.toBeInTheDocument();
    expect(screen.getByTestId('vendor-usual-currency-code')).toHaveTextContent('—');
  });
});

/*
 * VEN-W13 (founder, 2026-10-01): "write auto ... 3 invoices", "Person's value
 * stays, sheet shows the clash", "Keep it, switch to the one-tap offer". The
 * five states of the approved sketch, each rendered from the gateway's answer.
 */
const EV = (
  state: 'A' | 'B' | 'C' | 'D' | 'E' | 'stated',
  counts: { code: string; invoices: number }[],
  clash: { code: string; lastInvoices: number } | null = null,
) => ({
  state,
  counts,
  clash,
  counted: counts.reduce((n, c) => n + c.invoices, 0),
  needed: 3,
});

describe('UsualCurrencySection — written from invoices (VEN-W13)', () => {
  it('A: names the invoices, never a person, and keeps the chooser', async () => {
    api.get.mockResolvedValue({
      data: {
        providerId: 'p1',
        code: 'USD',
        setAt: '2026-10-01T09:00:00.000Z',
        setByName: null,
        source: 'invoices',
        invoiceCount: 4,
        evidence: EV('A', [{ code: 'USD', invoices: 4 }]),
        sentence:
          'All 4 invoices from Bir Dagitim were printed in USD, so orders to them start in USD. You can change it on the order.',
      },
    });
    renderIt();
    expect(
      await screen.findByTestId('vendor-usual-currency-from-invoices'),
    ).toHaveTextContent('from 4 of their invoices · nobody has stated it');
    expect(screen.queryByText(/stated by/)).toBeNull();
    expect(screen.getByText(/All 4 invoices/)).toBeInTheDocument();
    expect(screen.getByTestId('vendor-usual-currency-save')).toHaveTextContent('Change it');
    expect(screen.queryByTestId('vendor-usual-currency-taps')).toBeNull();
  });

  it('B: one tap per printed code, and a tap is the person’s PATCH', async () => {
    api.get.mockResolvedValue({
      data: {
        ...UNSTATED,
        source: null,
        invoiceCount: null,
        evidence: EV('B', [
          { code: 'USD', invoices: 3 },
          { code: 'EUR', invoices: 1 },
        ]),
        sentence:
          'Their invoices disagree: 3 printed in USD, 1 in EUR. Choose the one they usually invoice in; your name goes on it.',
      },
    });
    api.patch.mockResolvedValue({ data: { sentence: 'Stated as EUR.' } });
    renderIt();
    expect(await screen.findByTestId('vendor-usual-currency-tap-USD')).toHaveTextContent(
      'USD · 3 invoices',
    );
    expect(screen.getByTestId('vendor-usual-currency-tap-EUR')).toHaveTextContent(
      'EUR · 1 invoice',
    );
    expect(screen.queryByTestId('vendor-usual-currency-select')).toBeNull();
    fireEvent.click(screen.getByTestId('vendor-usual-currency-tap-EUR'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/providers/p1/usual-currency', {
        currency: 'EUR',
      }),
    );
  });

  it('C: the person’s value stays, with one tap to switch', async () => {
    api.get.mockResolvedValue({
      data: {
        ...STATED,
        code: 'USD',
        source: 'person',
        invoiceCount: null,
        evidence: EV('C', [{ code: 'EUR', invoices: 3 }], { code: 'EUR', lastInvoices: 3 }),
        sentence: 'Their last 3 invoices were printed in EUR. USD stays until someone switches it.',
      },
    });
    renderIt();
    expect(await screen.findByTestId('vendor-usual-currency-code')).toHaveTextContent('USD');
    expect(screen.getByText(/stated by Aslı/)).toBeInTheDocument();
    expect(screen.getByTestId('vendor-usual-currency-tap-EUR')).toHaveTextContent(
      'Switch to EUR',
    );
  });

  it('D: an invoice-written value later contradicted offers keep or use', async () => {
    api.get.mockResolvedValue({
      data: {
        providerId: 'p1',
        code: 'USD',
        setAt: '2026-10-01T09:00:00.000Z',
        setByName: null,
        source: 'invoices',
        invoiceCount: 3,
        evidence: EV('D', [
          { code: 'USD', invoices: 3 },
          { code: 'EUR', invoices: 1 },
        ]),
        sentence:
          'A later invoice was printed in EUR. Orders still start in USD; choose which one they usually invoice in.',
      },
    });
    api.patch.mockResolvedValue({ data: { sentence: 'Stated as USD.' } });
    renderIt();
    expect(
      await screen.findByTestId('vendor-usual-currency-from-invoices'),
    ).toHaveTextContent('from 3 of their invoices');
    expect(
      screen.getByTestId('vendor-usual-currency-from-invoices'),
    ).not.toHaveTextContent('nobody has stated it');
    expect(screen.getByTestId('vendor-usual-currency-tap-USD')).toHaveTextContent('Keep USD');
    expect(screen.getByTestId('vendor-usual-currency-tap-EUR')).toHaveTextContent('Use EUR');
    fireEvent.click(screen.getByTestId('vendor-usual-currency-tap-USD'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/providers/p1/usual-currency', {
        currency: 'USD',
      }),
    );
  });

  it('E: the count and the existing chooser', async () => {
    api.get.mockResolvedValue({
      data: {
        ...UNSTATED,
        source: null,
        invoiceCount: null,
        evidence: EV('E', [{ code: 'USD', invoices: 1 }]),
        sentence:
          '1 invoice so far, printed in USD. After 2 more in the same currency it is filled in for you — or choose it now.',
      },
    });
    renderIt();
    expect(await screen.findByText(/After 2 more in the same currency/)).toBeInTheDocument();
    expect(screen.getByTestId('vendor-usual-currency-select')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-usual-currency-save')).toHaveTextContent('State it');
  });

  it('staff see the one-tap offers disabled, with the reason', async () => {
    auth.role = 'staff';
    api.get.mockResolvedValue({
      data: {
        ...UNSTATED,
        evidence: EV('B', [
          { code: 'USD', invoices: 2 },
          { code: 'EUR', invoices: 2 },
        ]),
      },
    });
    renderIt();
    expect(await screen.findByTestId('vendor-usual-currency-tap-USD')).toBeDisabled();
    expect(screen.getByText(/signed in as staff/)).toBeInTheDocument();
  });

  it('opened from the prompt with no chooser, the first one-tap takes focus', async () => {
    api.get.mockResolvedValue({
      data: {
        ...UNSTATED,
        evidence: EV('B', [
          { code: 'USD', invoices: 2 },
          { code: 'EUR', invoices: 1 },
        ]),
      },
    });
    renderIt(true);
    const tap = await screen.findByTestId('vendor-usual-currency-tap-USD');
    await waitFor(() => expect(tap).toHaveFocus());
  });

  it('invoices that could not be read are said, never shown as none', async () => {
    api.get.mockResolvedValue({
      data: { ...STATED, evidence: null, evidenceUnreadable: 'statement timeout' },
    });
    renderIt();
    expect(
      await screen.findByText(/What their invoices printed could not be read \(statement timeout\)/),
    ).toBeInTheDocument();
  });
});
