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
import { card, entry, measure, statedDollars } from './scorecard-fixtures';

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
  it('prints each answered line as a percent with its count, the prior window and its rows (question 3)', async () => {
    renderIt();
    const onTime = await screen.findByTestId('ledger-line-onTime');
    expect(within(onTime).getByTestId('ledger-figure-onTime')).toHaveTextContent('86%12 of 14');
    expect(onTime).toHaveTextContent('86% on time — 12 of 14 by the expected date.');
    expect(onTime).toHaveTextContent('prior 90 d · 69% · 9 of 13');
    expect(within(onTime).getByRole('button', { name: '14 orders ›' })).toBeInTheDocument();
    expect(screen.getByTestId('ledger-figure-replyTime')).toHaveTextContent('5 h 40median · 9');
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

  it('carries no tone line — how their mail reads is its own section — and says no alert is built', async () => {
    renderIt();
    await screen.findByTestId('ledger-line-onTime');
    expect(screen.queryByTestId('ledger-tone')).not.toBeInTheDocument();
    expect(screen.getByTestId('ledger-card')).not.toHaveTextContent(/tone of/i);
    expect(screen.getByTestId('ledger-alerting')).toHaveTextContent('neither is built yet');
  });

  // The founder, 2026-09-21: "The font size are a little big". One step down
  // the page's own scale: the percent 18 -> 16 px, its count 10.5 -> 10 px, the
  // label left at 12.5 px so the figure still leads its line.
  it('prints the figure one step smaller — 16 px, its count 10 px — and still larger than its label', async () => {
    renderIt();
    const fig = await screen.findByTestId('ledger-figure-onTime');
    expect(fig).toHaveStyle({ fontSize: '16px' });
    expect(fig.querySelector('small')).toHaveStyle({ fontSize: '10px' });
    const label = within(screen.getByTestId('ledger-line-onTime')).getByText('On time');
    expect(parseFloat(label.style.fontSize)).toBeLessThan(16);
  });

  it('says an order past its date is unconfirmed and not counted, late once someone said not yet, or in Incomplete orders', async () => {
    const overdue = (id: string, standing: 'unconfirmed' | 'confirmed' | 'incomplete') =>
      entry({
        id: `onTime:${id}`,
        measure: 'onTime',
        title: id,
        open: true,
        counted: standing === 'confirmed',
        hit: standing === 'confirmed' ? false : null,
        overdue: standing,
        detail: `Expected by 2026-09-10 (${standing}).`,
      });
    api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/docket')
          ? {
              ...docket,
              entries: [
                overdue('PO-SILENT', 'unconfirmed'),
                overdue('PO-SAID', 'confirmed'),
                overdue('PO-OLD', 'incomplete'),
              ],
            }
          : card(),
      }),
    );
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: /14 orders/ }));
    const rows = await within(await screen.findByTestId('docket')).findAllByTestId('docket-entry');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('unconfirmed · not counted');
    expect(rows[1]).toHaveTextContent('late · not landed');
    expect(rows[2]).toHaveTextContent('in Incomplete orders · not counted');
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

  it('under five claims prints no percent and lists the claims themselves (question 2)', async () => {
    renderIt();
    const credits = await screen.findByTestId('ledger-line-credits');
    expect(within(credits).getByTestId('ledger-figure-credits')).toHaveTextContent('too few3 of 5');
    expect(within(credits).getByTestId('ledger-figure-credits')).not.toHaveTextContent('%');
    const claims = within(credits).getAllByTestId('ledger-listed-claim');
    expect(claims).toHaveLength(3);
    expect(claims[0]).toHaveTextContent('Claim c3 · qty short — Promised, 39 days ago');
    expect(claims[1]).toHaveTextContent('Credited $103.50 of $118.00 asked.');
    // No list under any other refusal: only claims are listed on the card.
    expect(
      within(screen.getByTestId('ledger-line-linesAsOrdered')).queryByTestId('ledger-listed-claims'),
    ).not.toBeInTheDocument();
  });

  it('at five claims prints the percent recovered with the money beside it', async () => {
    const c = card();
    c.measures[4] = measure({
      key: 'credits',
      label: 'Credits',
      sample: 5,
      hits: 3,
      value: 326 / 482.5,
      percent: '68%',
      money: [statedDollars(326, 482.5, '68%')],
      sentence: '68% recovered — $326.00 by credit memo of $482.50 asked, on 5 claims; 3 credited.',
    });
    api.get.mockResolvedValue({ data: c });
    renderIt();
    const fig = await screen.findByTestId('ledger-figure-credits');
    expect(fig).toHaveTextContent('68%$326.00 of $482.50');
    expect(screen.queryByTestId('ledger-listed-claims')).not.toBeInTheDocument();
  });

  it('prints claim money whose currency is not recorded as a bare amount, never as dollars', async () => {
    const c = card();
    c.measures[4] = measure({
      key: 'credits',
      label: 'Credits',
      sample: 5,
      hits: 5,
      value: 0.8,
      percent: '80%',
      money: [{ currency: null, allowed: 40, asked: 50, share: 0.8, percent: '80%' }],
    });
    api.get.mockResolvedValue({ data: c });
    renderIt();
    const fig = await screen.findByTestId('ledger-figure-credits');
    expect(fig).toHaveTextContent('80%40.00 of 50.00');
    expect(fig).not.toHaveTextContent('$');
  });

  it('formats money and dates in the house’s locale from the gateway, never a pinned one (question 7)', async () => {
    const tr = { ...card().house, zone: 'Europe/Istanbul', locale: 'tr-TR', deadline: 'Istanbul midnight.' };
    // 22:30 UTC is already the next day in Istanbul: the label must be read on the house's clock.
    const c = card({
      house: tr,
      window: {
        days: 90,
        from: '2026-06-19T22:30:00.000Z',
        to: '2026-09-17T22:30:00.000Z',
        priorFrom: '2026-03-21T22:30:00.000Z',
      },
    });
    c.measures[4] = measure({
      key: 'credits',
      label: 'Credits',
      sample: 5,
      hits: 5,
      value: 1,
      percent: '%100',
      money: [{ currency: 'TRY', allowed: 1234.5, asked: 1234.5, share: 1, percent: '%100' }],
    });
    api.get.mockResolvedValue({ data: c });
    renderIt();
    const fig = await screen.findByTestId('ledger-figure-credits');
    const lira = new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.5);
    expect(fig).toHaveTextContent(`%100${lira} of ${lira}`);
    const day = (iso: string) =>
      new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Istanbul' }).format(
        new Date(iso),
      );
    expect(screen.getByTestId('ledger-card')).toHaveTextContent(
      `${day('2026-06-19T22:30:00.000Z')} – ${day('2026-09-17T22:30:00.000Z')}`,
    );
    fireEvent.click(screen.getByText('How this is scored'));
    expect(screen.getByTestId('ledger-deadline')).toHaveTextContent('Istanbul midnight.');
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
  it('marks an order past its date and not landed as late and still open (question 8)', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/docket')
          ? {
              ...docket,
              entries: [
                entry({
                  id: 'onTime:o9',
                  measure: 'onTime',
                  title: 'PO-OUT',
                  counted: true,
                  hit: false,
                  open: true,
                  daysLate: 4,
                  detail: 'Expected by 09/13/2026; 4 days past it and not landed — counted as late.',
                }),
              ],
            }
          : card(),
      }),
    );
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: '14 orders ›' }));
    const row = await within(await screen.findByTestId('docket')).findByTestId('docket-entry');
    expect(row).toHaveTextContent('late · not landed');
    expect(row).not.toHaveTextContent('not counted');
  });

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
