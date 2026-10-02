/**
 * The composer's render contract — the four founder decisions, each provable.
 *
 *   1. no sending identity  ⇒ Send is DISABLED and carries the reason
 *   2. a failed sender read ⇒ said as a failure, never as "no mailbox"
 *   3. the recipient comes from the book; an unknown address offers to CREATE
 *      the vendor contact and does not address a string
 *   4. Send costs what the sender is worth: the seal on the Mudavym subdomain,
 *      a plain button and an undo window on the house's own mailbox
 *
 * Plus the two things the composer may never do: claim a send it did not make,
 * and offer a figure without provenance.
 *
 * Every one of these would pass on an empty scaffold ONLY if the scaffold
 * happened to render the exact sentences the gateway returns — which is why the
 * assertions are on the server's own words and on the disabled attribute, not
 * on a heading.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
  useLetterSenderStanding: () => ({
    restaurantId: 'r1',
    canRelease: false,
    noMailbox: true,
    basis: 'owner',
    checking: false,
    checkedAt: 0,
    recheck: () => {},
  }),
}));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { post: mockPost, get: vi.fn() },
}));

import { ComposeSheet } from './ComposeSheet';

const NO_SENDER = {
  kind: 'none' as const,
  address: null,
  sendable: false,
  ceremony: 'none' as const,
  undoMs: null,
  words:
    'No house sender. This house has not connected a mailbox of its own, and a Mudavym address is a paid-tier option that is not provisioned yet. Connect a mailbox on /connections; nothing is sent until one exists.',
  missing: ['No connected Google account for this house has granted gmail.send.'],
  deployment: {
    address: 'notifications@mudavym.com',
    refusedBecause: 'This mailbox belongs to the deployment, not to this house.',
  },
  subdomain: {
    provisioned: false,
    tier: 'paid' as const,
    words:
      'A Mudavym address on our own sending domain is a paid-tier option and is not provisioned for any house yet.',
  },
  categories: ['price_query'],
  dispatcher: null,
};

/** An owner or a manager: their hold sends (ADR 0175 D10, 2026-09-21). */
const MAY_SEND = {
  readable: true,
  maySend: true,
  mode: 'send' as const,
  basis: 'manager' as const,
  grant: null,
  sentence: null,
};

const HOUSE_MAILBOX = {
  ...NO_SENDER,
  sendOrAsk: MAY_SEND,
  kind: 'house_mailbox' as const,
  address: 'siparis@lokantamudavim.com',
  sendable: true,
  ceremony: 'undo' as const,
  undoMs: 120000,
  words: 'Sends as siparis@lokantamudavim.com, this house’s own connected mailbox.',
  missing: [],
};

const SUBDOMAIN = {
  ...NO_SENDER,
  sendOrAsk: MAY_SEND,
  kind: 'mudavym_subdomain' as const,
  address: 'siparis@mail.mudavym.com',
  sendable: true,
  ceremony: 'seal' as const,
  undoMs: null,
  words: 'Sends as siparis@mail.mudavym.com, the house’s own line on Mudavym’s sending domain.',
  missing: [],
};

const BOOK = [
  {
    providerId: 'p1',
    providerName: 'Fikri Tarım Gıda',
    contactName: 'Fikri',
    email: 'fikri@fikritarim.com',
    source: 'provider' as const,
  },
];

const base = {
  restaurantId: 'r1',
  sender: NO_SENDER,
  senderFailed: false,
  senderError: null,
  book: BOOK,
  bookFailed: false,
  bookError: null,
  byProvider: new Map(),
  templates: [],
  templatesFailed: false,
  templatesError: null,
  insights: [],
  insightsFailed: false,
  insightsError: null,
  queued: [],
  queuedFailed: false,
  refetchQueued: vi.fn(),
};

function open() {
  return render(
    <MemoryRouter initialEntries={['/communications']}>
      <ComposeSheet open onClose={() => {}} />
    </MemoryRouter>,
  );
}

/** Choose the one book entry, so the send control's other precondition is met. */
function pickRecipient() {
  fireEvent.click(screen.getByText('Fikri Tarım Gıda'));
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Standing order' } });
  fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
}

beforeEach(() => {
  mockData.current = { ...base };
  mockPost.mockReset();
});

describe('the house composer', () => {
  it('disables Send with the reason when this house has no sending identity', () => {
    open();
    pickRecipient();
    const send = screen.getByTestId('letter-send');
    expect(send).toBeDisabled();
    expect(
      screen.getByText('Send is disabled until this house has a mailbox to send from.'),
    ).toBeInTheDocument();
  });

  it("with no mailbox, says it in the house's words with the same checklist and chooser as a waiting letter (COMMS-W20)", () => {
    open();
    const ready = screen.getByTestId('sender-readiness');
    expect(ready).toHaveTextContent('Before it can leave');
    expect(ready).toHaveTextContent('This house has no mailbox to send from.');
    expect(screen.getByRole('button', { name: 'Connect a mailbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    // no internal address, DNS record, permission URL, route or tier
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/notifications@mudavym\.com|DKIM|DMARC|gmail\.send|\/connections|paid-tier|deployment/);
    expect(text).not.toMatch(/[$€£₺]\s?\d/);
  });

  it('a failed sender read is a failure, not "no mailbox"', () => {
    mockData.current = { ...base, sender: null, senderFailed: true, senderError: 'ECONNREFUSED' };
    open();
    expect(screen.getByText(/could not be read \(ECONNREFUSED\)/)).toBeInTheDocument();
    expect(screen.getByText(/No letter may be queued until it can be\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/failed read/)).toBeNull();
    expect(screen.getByTestId('letter-send')).toBeDisabled();
  });

  it('holds Send under the seal on the Mudavym subdomain', () => {
    mockData.current = { ...base, sender: SUBDOMAIN };
    open();
    expect(screen.queryByTestId('letter-send')).toBeNull();
    expect(screen.getByText(/Hold to send/)).toBeInTheDocument();
    expect(screen.getByText(/affects every other house/)).toBeInTheDocument();
  });

  it('gives the house’s own mailbox a plain button and states the window', () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    open();
    pickRecipient();
    expect(screen.getByTestId('letter-send')).toBeEnabled();
    expect(screen.queryByText(/Hold to send/)).toBeNull();
    expect(screen.getByText(/Sends after 2 minutes/)).toBeInTheDocument();
  });

  it('a queued letter is never reported as sent, and can be pulled back', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/communications/letters/seal-challenge'
          ? { data: { challenge: 'seal-1' } }
          : {
              data: {
                id: 'L1',
                dispatchAt: new Date(Date.now() + 120000).toISOString(),
                says: 'Queued to leave from siparis@lokantamudavim.com. It has not been sent.',
                undoMs: 120000,
                notices: [],
                insightsRecorded: 0,
              },
            },
      ),
    );
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(screen.getByTestId('letter-queued')).toBeInTheDocument());
    expect(screen.getByTestId('letter-queued')).toHaveTextContent('has not been sent');
    expect(screen.getByText(/Pull it back/)).toBeInTheDocument();
  });

  it('renders a refused letter as words, and says nothing was queued', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockResolvedValueOnce({ data: { challenge: 'seal-1' } });
    mockPost.mockRejectedValueOnce({
      response: {
        data: {
          message:
            'This letter contains language that can form a binding purchase commitment — "we accept".',
          guardrails: [
            { rule: 'commitment_language', says: 'This letter contains language…', blocking: true },
          ],
        },
      },
    });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(screen.getByTestId('letter-refused')).toBeInTheDocument());
    expect(screen.getByTestId('letter-refused')).toHaveTextContent('binding purchase commitment');
    expect(screen.getByTestId('letter-refused')).toHaveTextContent('Nothing was queued');
  });

  it('a failed cancel never looks like a successful one', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockResolvedValueOnce({ data: { challenge: 'seal-1' } });
    mockPost.mockResolvedValueOnce({
      data: {
        id: 'L1',
        dispatchAt: new Date(Date.now() + 120000).toISOString(),
        says: 'Queued.',
        undoMs: 120000,
        notices: [],
        insightsRecorded: 0,
      },
    });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(screen.getByText(/Pull it back/)).toBeInTheDocument());

    mockPost.mockRejectedValueOnce(new Error('gateway down'));
    fireEvent.click(screen.getByText(/Pull it back/));
    await waitFor(() => expect(screen.getByTestId('letter-refused')).toBeInTheDocument());
    expect(screen.getByTestId('letter-refused')).toHaveTextContent('was NOT pulled back');
  });

  it('inserts a whole engine sentence with its provenance, and offers no bare figure field', () => {
    mockData.current = {
      ...base,
      sender: HOUSE_MAILBOX,
      insights: [
        {
          candidateKey: 'weekday.baseline.wednesday',
          category: 'sales',
          sentence: 'Wednesday came in 38% under its own average.',
          periodStart: '2026-08-01',
          periodEnd: '2026-08-28',
          computedAt: '2026-09-01T06:00:00Z',
        },
      ],
    };
    open();
    fireEvent.click(screen.getByText('Wednesday came in 38% under its own average.'));
    const chip = screen.getByTestId('provenance-chip');
    // COMMS-W27: where the sentence came from, in words; never its internal key.
    expect(chip).toHaveTextContent(/^Noticed/);
    expect(chip).not.toHaveTextContent('weekday.baseline.wednesday');
    expect(chip.getAttribute('title') ?? '').not.toMatch(/weekday|Rule/);
    // `Sep`/`Sept` differ by ICU build; the assertion is on the DATE, not on
    // which abbreviation this Node ships.
    expect(chip).toHaveTextContent(/worked out 1 Sept? 2026/);
    expect((screen.getByLabelText('The letter') as HTMLTextAreaElement).value).toContain(
      'Wednesday came in 38% under its own average.',
    );
    // The one control this composer deliberately does not have.
    expect(screen.queryByLabelText(/insert a figure/i)).toBeNull();
  });

  it("says an empty insight list in the house's words, with no field to type one in (COMMS-W21)", () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX, insights: [] };
    open();
    expect(screen.getByText('Nothing the house noticed is waiting to be written about.')).toBeInTheDocument();
    expect(screen.queryByText(/engine/i)).toBeNull();
    expect(screen.queryByLabelText(/insert a figure/i)).toBeNull();
  });

  it('an unreadable book refuses every recipient in words', () => {
    mockData.current = {
      ...base,
      book: null,
      bookFailed: true,
      // The gateway's own sentence, relayed verbatim.
      bookError: 'The vendor book could not be read (ECONNREFUSED).',
    };
    open();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('vendor book could not be read');
    expect(alert).toHaveTextContent('not empty — it is unknown');
    expect((alert.textContent ?? '').match(/could not be read/g)).toHaveLength(1);
  });

  it('offers to add an unknown address to the book rather than writing to it', () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    open();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'yeni@baskatedarik.com' } });
    expect(screen.getByText(/Add yeni@baskatedarik\.com to the book/)).toBeInTheDocument();
    // and Send is still not reachable, because no recipient RECORD is chosen
    expect(screen.getByTestId('letter-send')).toBeDisabled();
  });

  it('creates the vendor contact before the letter can address it', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockResolvedValue({ data: { id: 'c9' } });
    open();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'yeni@fikritarim.com' } });
    fireEvent.click(screen.getByText(/Add yeni@fikritarim\.com to the book/));
    fireEvent.change(screen.getByLabelText('Which vendor'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByText('Add to the book'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/providers/p1/contacts',
        expect.objectContaining({ email: 'yeni@fikritarim.com' }),
      ),
    );
  });
});

describe('the composer is a vendor send: sealed, and only for those who may send (ADR 0175 D9/D10, 2026-09-21)', () => {
  it('mints a seal over the exact letter and queues it carrying that seal', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/communications/letters/seal-challenge'
          ? { data: { challenge: 'seal-1' } }
          : { data: { id: 'L1', dispatchAt: new Date(Date.now() + 120000).toISOString(), says: 'Queued.', undoMs: 120000, notices: [], insightsRecorded: 0 } },
      ),
    );
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    const [mintPath, mintBody] = mockPost.mock.calls[0];
    const [queuePath, queueBody, config] = mockPost.mock.calls[1];
    expect(mintPath).toBe('/communications/letters/seal-challenge');
    expect(queuePath).toBe('/communications/letters');
    expect(queueBody).toEqual(mintBody);
    expect(config?.headers?.['X-Seal-Challenge']).toBe('seal-1');
  });

  it('queues nothing when the seal is refused', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockRejectedValueOnce({ response: { data: { message: 'Nothing was sent. Only an owner, a manager, or someone an owner has named may send this letter with one hold.' } } });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(screen.getByTestId('letter-refused')).toBeInTheDocument());
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('/communications/letters/seal-challenge');
  });

  it("a staff member is offered no send, and their click ASKS a manager, keeping the exact letter (founder answer 3)", async () => {
    const refetchRequests = vi.fn();
    mockData.current = {
      ...base,
      refetchRequests,
      sender: {
        ...HOUSE_MAILBOX,
        sendOrAsk: {
          readable: true,
          maySend: false,
          mode: 'ask',
          basis: null,
          grant: null,
          sentence: 'Your hold will ask a manager to send it; your version is kept exactly as you wrote it.',
        },
      },
    };
    mockPost.mockResolvedValue({ data: { says: 'Asked. Your letter is saved exactly as you wrote it.', requestId: 'req-1' } });
    open();
    expect(screen.queryByTestId('letter-send')).toBeNull();
    const ask = screen.getByTestId('letter-ask');
    expect(ask).toBeDisabled();
    pickRecipient();
    expect(screen.getByText(/your version is kept exactly as you wrote it/)).toBeInTheDocument();
    fireEvent.click(ask);
    await waitFor(() => expect(screen.getByTestId('letter-asked')).toHaveTextContent(/Asked\. Your letter is saved exactly/));
    // One call: the request. No seal is minted and nothing is queued.
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('/communications/letters/requests');
    expect(mockPost.mock.calls[0][1]).toMatchObject({ subject: 'Standing order', body: 'Merhaba,' });
    expect(refetchRequests).toHaveBeenCalled();
  });

  it('a grantee sees who granted them', () => {
    mockData.current = {
      ...base,
      sender: {
        ...HOUSE_MAILBOX,
        sendOrAsk: {
          ...MAY_SEND,
          basis: 'grant' as const,
          grant: { id: 'g1', grantedBy: { userId: 'u-o', name: 'Olcay' }, expiresAt: null, limitAmount: null, limitCurrency: null },
        },
      },
    };
    open();
    expect(screen.getByText(/You send under a grant from Olcay/)).toBeInTheDocument();
  });
});

describe('a drafted letter (ADR 0230)', () => {
  const DRAFT = {
    draftId: 'D1',
    providerId: 'p1',
    to: 'fikri@fikritarim.com',
    subject: 'Credit request — invoice INV-77',
    body: 'We are asking for a credit of 84.50 EUR.',
  };

  it('says it is a draft, not sent, and sends THAT draft when Send is pressed', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    // A draft is a vendor send like any other letter (#436 merging main,
    // 2026-09-27): the seal is minted over it first, then it is queued with it.
    mockPost.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/communications/letters/seal-challenge'
          ? { data: { challenge: 'seal-D1' } }
          : {
              data: {
                id: 'D1',
                dispatchAt: new Date(Date.now() + 120000).toISOString(),
                says: 'Queued to leave. It has not been sent.',
                undoMs: 120000,
                notices: [],
                insightsRecorded: 0,
              },
            },
      ),
    );
    render(<ComposeSheet open onClose={() => {}} prefill={DRAFT} />);
    expect(screen.getByTestId('letter-draft-note')).toHaveTextContent('it has not been sent');
    expect(screen.getByLabelText('Subject')).toHaveValue('Credit request — invoice INV-77');
    // The recipient is the booked entry the draft was written to.
    await waitFor(() => expect(screen.getByTestId('letter-send')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/communications/letters',
        expect.objectContaining({ draftId: 'D1', providerId: 'p1', to: 'fikri@fikritarim.com' }),
        { headers: { 'X-Seal-Challenge': 'seal-D1' } },
      ),
    );
    // The seal was minted over the same letter, draft id included.
    expect(mockPost.mock.calls[0][0]).toBe('/communications/letters/seal-challenge');
    expect(mockPost.mock.calls[0][1]).toEqual(mockPost.mock.calls[1][1]);
    await waitFor(() => expect(screen.getByTestId('letter-queued')).toBeInTheDocument());
    // Queued: it is not offered again, and cannot be discarded any more.
    expect(screen.getByTestId('letter-send')).toBeDisabled();
    expect(screen.queryByTestId('letter-discard')).toBeNull();
  });

  it('a draft with no booked address leaves the recipient unchosen and says so', () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    render(<ComposeSheet open onClose={() => {}} prefill={{ ...DRAFT, to: null }} />);
    expect(screen.getByTestId('letter-draft-note')).toHaveTextContent('no address in the book');
    expect(screen.getByTestId('letter-send')).toBeDisabled();
  });

  it('discards the draft on the gateway and says it was never sent', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockResolvedValue({
      data: { says: 'Discarded. It was never sent, and the book keeps it as cancelled rather than deleting it.' },
    });
    const onDiscarded = vi.fn();
    render(<ComposeSheet open onClose={() => {}} prefill={DRAFT} onDiscarded={onDiscarded} />);
    fireEvent.click(screen.getByTestId('letter-discard'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/communications/letters/D1/discard'));
    await waitFor(() => expect(screen.getByTestId('letter-draft-note')).toHaveTextContent('never sent'));
    expect(onDiscarded).toHaveBeenCalled();
    expect(screen.getByTestId('letter-send')).toBeDisabled();
  });

  it('a plain letter sends no draftId and offers no discard', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockResolvedValue({
      data: { id: 'L1', dispatchAt: new Date(Date.now() + 120000).toISOString(), says: 'Queued.', undoMs: 120000, notices: [], insightsRecorded: 0 },
    });
    open();
    expect(screen.queryByTestId('letter-discard')).toBeNull();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][1].draftId).toBeUndefined();
  });
});

describe('leaving with changed words keeps them (COMMS-W34)', () => {
  const DRAFT = {
    draftId: 'D1',
    providerId: 'p1',
    to: 'fikri@fikritarim.com',
    subject: 'Credit request — invoice INV-77',
    body: 'We are asking for a credit of 84.50 EUR.',
  };

  it('Escape on a typed letter hands its words to the page, then closes', async () => {
    const onHold = vi.fn();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ComposeSheet open onClose={onClose} onHold={onHold} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Standing order' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onHold).toHaveBeenCalledWith(
      expect.objectContaining({ to: null, subject: 'Standing order', body: '', insights: [], templateId: '' }),
    );
  });

  it('an untouched letter leaves with nothing held', async () => {
    const onHold = vi.fn();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ComposeSheet open onClose={onClose} onHold={onHold} />
      </MemoryRouter>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onHold).not.toHaveBeenCalled();
  });

  it('a drafted letter holds only changes made to it, measured against the draft', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    const onHold = vi.fn();
    const { unmount } = render(<ComposeSheet open onClose={() => {}} onHold={onHold} prefill={DRAFT} />);
    await waitFor(() => expect(screen.getByTestId('letter-send')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Close'));
    expect(onHold).not.toHaveBeenCalled();
    unmount();

    render(<ComposeSheet open onClose={() => {}} onHold={onHold} prefill={DRAFT} />);
    await waitFor(() => expect(screen.getByTestId('letter-send')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'We ask for 84.50 EUR back.' } });
    fireEvent.click(screen.getByText('Close'));
    expect(onHold).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'We ask for 84.50 EUR back.',
        subject: 'Credit request — invoice INV-77',
        to: expect.objectContaining({ providerId: 'p1', email: 'fikri@fikritarim.com' }),
      }),
    );
  });

  it('reopened with held words, it is still measured against the draft, not against them', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    const onHold = vi.fn();
    render(
      <ComposeSheet
        open
        onClose={() => {}}
        onHold={onHold}
        prefill={{ ...DRAFT, body: 'We ask for 84.50 EUR back.', baseline: { subject: DRAFT.subject, body: DRAFT.body, to: DRAFT.to } }}
      />,
    );
    expect(screen.getByLabelText('The letter')).toHaveValue('We ask for 84.50 EUR back.');
    fireEvent.click(screen.getByText('Close'));
    expect(onHold).toHaveBeenCalledWith(expect.objectContaining({ body: 'We ask for 84.50 EUR back.' }));
  });

  it('reopened from a hold, the chosen sentences and template come back and are held again', () => {
    const insight = {
      candidateKey: 'weekday.baseline.wednesday',
      category: 'sales',
      sentence: 'Wednesday came in 38% under its own average.',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-28',
      computedAt: '2026-09-01T06:00:00Z',
    };
    mockData.current = { ...base, sender: HOUSE_MAILBOX, insights: [insight] };
    const onHold = vi.fn();
    render(
      <MemoryRouter>
        <ComposeSheet
          open
          onClose={() => {}}
          onHold={onHold}
          prefill={{ subject: 'Standing order', body: 'Merhaba,', insights: [insight], templateId: 't1' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('provenance-chip')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close'));
    expect(onHold).toHaveBeenCalledWith(expect.objectContaining({ insights: [insight], templateId: 't1' }));
  });

  it('a discarded draft holds nothing when it is closed', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockResolvedValue({ data: { says: 'Discarded. It was never sent.' } });
    const onHold = vi.fn();
    render(<ComposeSheet open onClose={() => {}} onHold={onHold} prefill={DRAFT} />);
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Changed.' } });
    fireEvent.click(screen.getByTestId('letter-discard'));
    await waitFor(() => expect(screen.getByTestId('letter-draft-note')).toHaveTextContent('never sent'));
    fireEvent.click(screen.getByText('Close'));
    expect(onHold).not.toHaveBeenCalled();
  });
});
