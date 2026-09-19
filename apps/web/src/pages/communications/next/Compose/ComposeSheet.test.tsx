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

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
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
    address: 'notifications@wineops.ai',
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

const HOUSE_MAILBOX = {
  ...NO_SENDER,
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
  return render(<ComposeSheet open onClose={() => {}} />);
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
    expect(screen.getByText(/Send is disabled: No house sender/)).toBeInTheDocument();
    // and it names what it is REFUSING, not merely what it lacks
    expect(screen.getByText(/Not notifications@wineops\.ai/)).toBeInTheDocument();
  });

  it('says the paid tier in words and never a price', () => {
    open();
    // Said twice on purpose: once as the reason Send is disabled, once as the
    // subdomain row's own standing.
    expect(screen.getAllByText(/paid-tier option/).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? '').not.toMatch(/[$€£₺]\s?\d/);
  });

  it('a failed sender read is a failure, not "no mailbox"', () => {
    mockData.current = { ...base, sender: null, senderFailed: true, senderError: 'ECONNREFUSED' };
    open();
    expect(screen.getByText(/could not be read \(ECONNREFUSED\)/)).toBeInTheDocument();
    expect(screen.getByText(/failed read, not an empty answer/)).toBeInTheDocument();
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
    mockPost.mockResolvedValue({
      data: {
        id: 'L1',
        dispatchAt: new Date(Date.now() + 120000).toISOString(),
        says: 'Queued to leave from siparis@lokantamudavim.com. It has not been sent.',
        undoMs: 120000,
        notices: [],
        insightsRecorded: 0,
      },
    });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(screen.getByTestId('letter-queued')).toBeInTheDocument());
    expect(screen.getByTestId('letter-queued')).toHaveTextContent('has not been sent');
    expect(screen.getByText(/Pull it back/)).toBeInTheDocument();
  });

  it('renders a refused letter as words, and says nothing was queued', async () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
    mockPost.mockRejectedValue({
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
    expect(chip).toHaveTextContent('weekday.baseline.wednesday');
    // `Sep`/`Sept` differ by ICU build; the assertion is on the DATE, not on
    // which abbreviation this Node ships.
    expect(chip).toHaveTextContent(/computed 1 Sept? 2026/);
    expect((screen.getByLabelText('The letter') as HTMLTextAreaElement).value).toContain(
      'Wednesday came in 38% under its own average.',
    );
    // The one control this composer deliberately does not have.
    expect(screen.queryByLabelText(/insert a figure/i)).toBeNull();
  });

  it('says a withheld engine as an answer, not as a gap to fill by hand', () => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX, insights: [] };
    open();
    expect(screen.getByText(/holding no sentence for this house/)).toBeInTheDocument();
    expect(screen.getByText(/no field here for typing one in/)).toBeInTheDocument();
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
