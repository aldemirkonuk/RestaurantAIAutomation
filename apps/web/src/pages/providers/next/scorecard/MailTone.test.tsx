/**
 * "How their mail reads" in the vendor sheet (ADR 0207, round 3 — the
 * founder's "A, Plus C's lines"). `apiClient` is mocked, so these assert what
 * the section does with the gateway's answers; the readings, the words and the
 * sentences are the gateway's (`vendor-mail-tone.spec.ts`) and are printed
 * here verbatim.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { card } from './scorecard-fixtures';
import type { MailMessage, MailToneSection } from './scorecard-types';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'house-1' }),
}));

import { MailTone } from './MailTone';

function msg(i: number, over: Partial<MailMessage> = {}): MailMessage {
  return {
    id: `m${i}`,
    at: `2026-09-${String(20 - i).padStart(2, '0')}T10:00:00Z`,
    subject: `Re: PO-${2290 - i}`,
    word: 'plain',
    notAssessed: null,
    quote: `Confirmed for Monday, message ${i}.`,
    quoteMissing: null,
    readBy: 'inbound_model',
    ...over,
  };
}

function section(over: Partial<MailToneSection> = {}): MailToneSection {
  return {
    providerId: 'p1',
    window: { days: 90, from: '2026-06-22T12:00:00Z', to: '2026-09-20T12:00:00Z', priorFrom: '2026-03-24T12:00:00Z' },
    state: 'answered',
    jev: 'off',
    standing: '90 d · 9 messages · a model read 7 · no person has checked one · in no figure above',
    messages: [
      msg(1, { word: 'terse', quote: 'That price was a one-off; we can’t repeat it.' }),
      msg(2, { word: null, notAssessed: 'not assessed — automated mail', quote: null }),
      msg(3, { quote: null, quoteMissing: 'the read kept no line for this one' }),
      ...[4, 5, 6, 7, 8, 9].map((i) => msg(i)),
    ],
    shown: 6,
    beyondCap: 0,
    comparison: null,
    note: 'Each word is one message’s reading, not a verdict on the vendor. The window before this one has too few readings to set beside it.',
    reason: null,
    ...over,
  };
}

function renderWith(answer: MailToneSection | Error | 'pending') {
  api.get.mockImplementation((url: string) => {
    if (url.endsWith('/mail')) {
      if (answer === 'pending') return new Promise(() => {});
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ data: answer });
    }
    return Promise.resolve({ data: card() });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MailTone providerId="p1" />
    </QueryClientProvider>,
  );
}

// A block body: a returned function would be run by vitest as a cleanup hook.
beforeEach(() => {
  api.get.mockReset();
});

describe('how their mail reads', () => {
  it('lists the last six messages newest first, each with one word and the vendor’s own line', async () => {
    renderWith(section());
    const rows = await screen.findAllByTestId('mail-message');
    expect(rows).toHaveLength(6);
    expect(within(rows[0]).getByTestId('mail-word')).toHaveTextContent('terse');
    expect(within(rows[0]).getByTestId('mail-quote')).toHaveTextContent('That price was a one-off');
    expect(rows[0]).toHaveTextContent('Re: PO-2289');
    expect(within(rows[1]).getByTestId('mail-word')).toHaveTextContent('not assessed');
    expect(rows[1]).toHaveTextContent('not assessed — automated mail');
    expect(rows[2]).toHaveTextContent('the read kept no line for this one');
    expect(screen.getByTestId('mail-standing')).toHaveTextContent('no person has checked one');
  });

  it('prints no figure — no percent, no score, no arrow', async () => {
    renderWith(section());
    const s = await screen.findByTestId('mail-tone');
    await screen.findAllByTestId('mail-message');
    expect(s).not.toHaveTextContent(/%|↑|↓|→|score|valence/i);
  });

  it('opens all their mail in place with its one act, and closes it again', async () => {
    renderWith(section());
    const act = await screen.findByRole('button', { name: 'All their mail (9) ›' });
    expect(screen.getByText('3 earlier in this window')).toBeInTheDocument();
    fireEvent.click(act);
    expect(screen.getAllByTestId('mail-message')).toHaveLength(9);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer ‹' }));
    expect(screen.getAllByTestId('mail-message')).toHaveLength(6);
  });

  it('writes C’s sentence at the foot only when the gateway sends one', async () => {
    const cmp =
      'Both windows have 5 or more read, so they are set side by side: 1 of 7 terse against 0 of 6, 1 of 7 warm against 2 of 6, and 5 of 7 plain against 4 of 6. Each is a count of messages, not a trend.';
    renderWith(section({ comparison: cmp }));
    expect(await screen.findByTestId('mail-note')).toHaveTextContent(cmp);
  });

  it('says no mail yet in a sentence, with no rows', async () => {
    renderWith(
      section({
        state: 'no_mail',
        messages: [],
        note: 'No mail from this vendor in 90 d, so there is nothing to read. An empty inbox is not a quiet vendor.',
      }),
    );
    expect(await screen.findByTestId('mail-note')).toHaveTextContent('An empty inbox is not a quiet vendor.');
    expect(screen.queryAllByTestId('mail-message')).toHaveLength(0);
  });

  it('lists the messages with no word when tone is not assessed', async () => {
    renderWith(
      section({
        state: 'not_assessed',
        messages: [1, 2, 3].map((i) =>
          msg(i, { word: null, notAssessed: 'not assessed — no reading was kept for this one', quote: null }),
        ),
        note: 'The messages are here and none of them carries a reading. Unread is not plain.',
      }),
    );
    const rows = await screen.findAllByTestId('mail-message');
    expect(rows.every((r) => within(r).getByTestId('mail-word').textContent === 'not assessed')).toBe(true);
    expect(screen.getByTestId('mail-note')).toHaveTextContent('Unread is not plain.');
  });

  it('says a failed read in words with Try again — never an empty list', async () => {
    renderWith(
      section({
        state: 'could_not_read',
        messages: [],
        standing: '90 d · the vendor mail did not answer · nothing below is claimed',
        note: 'The vendor mail could not be read (57014 timeout). This is missing, not quiet.',
        reason: '57014 timeout',
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This is missing, not quiet.');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says the gateway’s refusal when the read itself fails', async () => {
    renderWith(Object.assign(new Error('403'), { response: { data: { message: 'Only managers and owners can read how a vendor’s mail reads' } } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only managers and owners');
  });

  it('draws rows and no words while the read is out', () => {
    renderWith('pending');
    const loading = screen.getByTestId('mail-loading');
    expect(loading).toHaveTextContent('Reading their mail…');
    expect(screen.queryByTestId('mail-word')).not.toBeInTheDocument();
  });
});
