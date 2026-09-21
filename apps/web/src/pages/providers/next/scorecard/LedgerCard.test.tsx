/**
 * The ledger card in the vendor sheet, and the Docket it opens — ADR 0207.
 *
 * `apiClient` is mocked, so these assert what the card does with the gateway's
 * answers, never that the gateway gives them: the arithmetic and the sentences
 * are pinned in the gateway's own `vendor-scorecard.spec.ts`, and are printed
 * here verbatim rather than re-derived.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { card, entry } from './scorecard-fixtures';

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'house-1' }),
}));

import { LedgerCard } from './LedgerCard';

function renderIt() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LedgerCard providerId="p1" providerName="Skurnik" />
    </QueryClientProvider>,
  );
}

const docket = {
  card: card(),
  measure: null,
  entries: [
    entry({ id: 'onTime:o1', measure: 'onTime', title: 'PO-2231' }),
    entry({
      id: 'onTime:o2',
      measure: 'onTime',
      title: 'PO-2229',
      hit: false,
      daysLate: 3,
      detail: 'Landed 3 days after the expected date (6 Sep 2026).',
      at: '2026-09-09T10:00:00Z',
    }),
    entry({
      id: 'onTime:o3',
      measure: 'onTime',
      title: 'PO-2283',
      counted: false,
      hit: null,
      excludedBecause: 'no expected date',
      detail: 'Landed with no expected date on the order, so it cannot be early or late.',
      at: '2026-09-08T10:00:00Z',
    }),
    entry({
      id: 'credits:c1',
      measure: 'credits',
      title: 'Claim C-81',
      detail: 'Credited $103.50 of $118.00 asked.',
      at: '2026-07-27T10:00:00Z',
    }),
  ],
};

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url.endsWith('/docket') ? docket : card() }),
  );
});

describe('the ledger card', () => {
  it('prints each answered line as a count over its denominator, with the prior window and its rows', async () => {
    renderIt();
    const onTime = await screen.findByTestId('ledger-line-onTime');
    expect(within(onTime).getByTestId('ledger-figure-onTime')).toHaveTextContent('12of 14');
    expect(onTime).toHaveTextContent('12 of 14 landed by the expected date.');
    expect(onTime).toHaveTextContent('prior 90 d · 9 of 13');
    expect(within(onTime).getByRole('button', { name: '14 orders ›' })).toBeInTheDocument();
    expect(screen.getByTestId('ledger-figure-replyTime')).toHaveTextContent('5 h 40median · 9');
    expect(screen.getByTestId('ledger-figure-credits')).toHaveTextContent('$286.00of $412.50');
    expect(api.get).toHaveBeenCalledWith('/vendor-scorecard/p1', {
      params: { window: 90 },
    });
  });

  it('prints a refusal in words with its count — never a figure, never a zero', async () => {
    renderIt();
    const lines = await screen.findByTestId('ledger-line-linesAsOrdered');
    const fig = within(lines).getByTestId('ledger-figure-linesAsOrdered');
    expect(fig).toHaveTextContent('too few2 of 5');
    expect(fig).toHaveStyle({ fontStyle: 'italic' });
    expect(lines).toHaveTextContent('too few to score; 5 are needed.');
  });

  it('writes a register that did not answer on its own line and leaves the other four standing', async () => {
    renderIt();
    const price = await screen.findByTestId('ledger-line-priceAsAgreed');
    expect(within(price).getByTestId('ledger-figure-priceAsAgreed')).toHaveTextContent('did not answer');
    expect(price).toHaveTextContent('502 upstream');
    expect(within(price).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('ledger-figure-onTime')).toHaveTextContent('12');
  });

  it('keeps tone to a minor line in no figure, and says no alert is built', async () => {
    renderIt();
    expect(await screen.findByTestId('ledger-tone')).toHaveTextContent(
      'Tone · minor, not scored — A model read the tone of 1 of 9 vendor messages',
    );
    expect(screen.getByTestId('ledger-alerting')).toHaveTextContent('neither is built yet');
  });

  it('draws the labels and no figures while the read is out', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    renderIt();
    const loading = screen.getByTestId('ledger-loading');
    expect(loading).toHaveTextContent('On time');
    expect(loading).not.toHaveTextContent(/\d/);
  });

  it('says a failed read in words, with the gateway’s reason, and claims no line', async () => {
    api.get.mockRejectedValue({
      response: {
        data: { message: 'The vendor book could not be read (timeout).' },
      },
    });
    renderIt();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The vendor book could not be read (timeout). That is a failed read, not a clean record',
    );
    expect(screen.queryByTestId('ledger-line-onTime')).not.toBeInTheDocument();
  });

  it('gives a vendor with nothing in the window one sentence, not five empty lines', async () => {
    api.get.mockResolvedValue({ data: card({ quiet: true }) });
    renderIt();
    expect(await screen.findByTestId('ledger-quiet')).toHaveTextContent('An empty record is not a clean one');
    expect(screen.queryByTestId('ledger-line-onTime')).not.toBeInTheDocument();
  });

  it('prints claim money whose currency is not recorded as a bare amount, never as dollars', async () => {
    const c = card();
    c.measures[4] = {
      ...c.measures[4],
      money: [{ currency: null, allowed: 40, asked: 50 }],
    };
    api.get.mockResolvedValue({ data: c });
    renderIt();
    const fig = await screen.findByTestId('ledger-figure-credits');
    expect(fig).toHaveTextContent('40.00of 50.00');
    expect(fig).not.toHaveTextContent('$');
  });

  it('asks again for the chosen window', async () => {
    renderIt();
    await screen.findByTestId('ledger-line-onTime');
    fireEvent.click(screen.getByRole('button', { name: '30 d' }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/vendor-scorecard/p1', {
        params: { window: 30 },
      }),
    );
    expect(screen.getByRole('button', { name: '30 d' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the Docket, opened from a line', () => {
  it('opens on that line’s rows, with the tallies above as filters', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: '14 orders ›' }));
    const sheet = await screen.findByTestId('docket');
    expect(api.get).toHaveBeenCalledWith('/vendor-scorecard/p1/docket', {
      params: { window: 90 },
    });
    const rows = await within(sheet).findAllByTestId('docket-entry');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('+3 d late');
    expect(rows[2]).toHaveTextContent('listed · not counted');
    expect(rows[2]).toHaveTextContent('Not counted: no expected date.');
    expect(within(sheet).getByTestId('docket-tally-onTime')).toHaveAttribute('aria-pressed', 'true');

    // Pressing the pressed tally lifts the filter: every entry, one list.
    fireEvent.click(within(sheet).getByTestId('docket-tally-onTime'));
    expect(within(sheet).getAllByTestId('docket-entry')).toHaveLength(4);

    // Another tally is another filter over the SAME answer — no second read.
    const calls = api.get.mock.calls.length;
    fireEvent.click(within(sheet).getByTestId('docket-tally-credits'));
    expect(within(sheet).getAllByTestId('docket-entry')).toHaveLength(1);
    expect(within(sheet).getByTestId('docket-entry')).toHaveTextContent('Credited $103.50 of $118.00 asked.');
    expect(api.get.mock.calls.length).toBe(calls);
  });

  it('labels a promised claim as asked and not recovered, and an unanswered message as not counted', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/docket')
          ? {
              ...docket,
              entries: [
                entry({
                  id: 'credits:c2',
                  measure: 'credits',
                  title: 'Claim C-88',
                  hit: false,
                  open: true,
                  detail: 'Promised, 39 days ago, not recovered — promised is not recovered.',
                }),
                entry({
                  id: 'replyTime:m1',
                  measure: 'replyTime',
                  title: 'Our message',
                  counted: false,
                  hit: null,
                  open: true,
                  excludedBecause: 'no reply yet — open, not counted',
                  detail: 'No reply in this thread yet.',
                }),
              ],
            }
          : card(),
      }),
    );
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: '14 orders ›' }));
    const sheet = await screen.findByTestId('docket');
    // Pressing the pressed tally lifts the filter: both entries, one list.
    fireEvent.click(await within(sheet).findByTestId('docket-tally-onTime'));
    const rows = await within(sheet).findAllByTestId('docket-entry');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('open · asked, not recovered');
    expect(rows[0]).not.toHaveTextContent('not counted');
    expect(rows[1]).toHaveTextContent('open · not counted');
  });

  it('says a measure whose register failed is missing from the list, not absent from the record', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: '14 orders ›' }));
    const sheet = await screen.findByTestId('docket');
    await within(sheet).findAllByTestId('docket-entry');
    fireEvent.click(within(sheet).getByTestId('docket-tally-priceAsAgreed'));
    expect(within(sheet).getByTestId('docket-refusal')).toHaveTextContent(
      'Its entries are missing from this list, not absent from the record.',
    );
    expect(within(sheet).getByTestId('docket-empty')).toHaveTextContent('an empty docket is not a clean one');
  });
});
