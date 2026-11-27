/**
 * r109 mail-gap g6: "See it as it leaves". A text button asks the gateway for the header block and body the send
 * would write and shows them read-only. It queues nothing; a refusal says the sentence the send would;
 * the block fades in over 160 ms (nothing under reduced motion) and has no exit animation.
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
import { MAIL_MOTION_CSS } from '../mail-motion';

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


const SHOWN = {
  from: { name: null, address: 'siparis@lokantamudavim.com' },
  to: 'fikri@fikritarim.com',
  replyTo: null,
  subject: 'Standing order',
  inReplyTo: '<v-1@fikritarim.com>',
  answersAt: '2026-11-20T09:30:00Z',
  body: 'Merhaba,',
};

describe('See it as it leaves', () => {
  beforeEach(() => {
    mockData.current = { ...base, sender: HOUSE_MAILBOX };
  });

  it('is a text button, off until the letter has a recipient, a subject and words', () => {
    open();
    expect(screen.getByRole('button', { name: 'See it as it leaves' })).toBeDisabled();
    pickRecipient();
    expect(screen.getByRole('button', { name: 'See it as it leaves' })).toBeEnabled();
  });

  it('shows From, To, Reply-To, Subject, the letter it answers and the body, read-only', async () => {
    mockPost.mockResolvedValue({ data: SHOWN });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-see'));
    const block = await screen.findByTestId('letter-as-it-leaves');
    expect(mockPost).toHaveBeenCalledWith(
      '/communications/letters/preview',
      expect.objectContaining({ to: 'fikri@fikritarim.com', subject: 'Standing order', body: 'Merhaba,' }),
    );
    expect(block).toHaveTextContent('Fromsiparis@lokantamudavim.com');
    expect(block).toHaveTextContent('Tofikri@fikritarim.com');
    expect(block).toHaveTextContent('Reply-To');
    expect(block).toHaveTextContent('SubjectStanding order');
    expect(block).toHaveTextContent('Answers their letter of 20 Nov 2026');
    expect(screen.getByTestId('letter-as-sent-body')).toHaveTextContent('Merhaba,');
    expect(block.querySelector('input, textarea, button')).toBeNull();
  });

  it('a new letter shows no threading line', async () => {
    mockPost.mockResolvedValue({ data: { ...SHOWN, inReplyTo: null, answersAt: null } });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-see'));
    const block = await screen.findByTestId('letter-as-it-leaves');
    expect(block).not.toHaveTextContent(/Answers their letter/);
  });

  it('does not queue, ask for a seal or send anything', async () => {
    mockPost.mockResolvedValue({ data: SHOWN });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-see'));
    await screen.findByTestId('letter-as-it-leaves');
    expect(mockPost.mock.calls.map((c) => c[0])).toEqual(['/communications/letters/preview']);
    expect(screen.queryByTestId('letter-queued')).toBeNull();
  });

  it('a header the builder refuses is said in the sentence the send would give', async () => {
    mockPost.mockRejectedValue({
      response: { data: { message: 'Refusing to write the From header: its value contains a line break or control character. Nothing was queued and nothing was sent.' } },
    });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-see'));
    const failed = await screen.findByTestId('letter-see-failed');
    expect(failed).toHaveTextContent('Refusing to write the From header: its value contains a line break or control character.');
    expect(screen.queryByTestId('letter-as-it-leaves')).toBeNull();
  });

  it('taking the preview down when the words change, so it never shows another letter', async () => {
    mockPost.mockResolvedValue({ data: SHOWN });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-see'));
    await screen.findByTestId('letter-as-it-leaves');
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba, Perşembe.' } });
    await waitFor(() => expect(screen.queryByTestId('letter-as-it-leaves')).toBeNull());
  });

  it('fades in over 160 ms, nothing under reduced motion, no exit animation', async () => {
    mockPost.mockResolvedValue({ data: SHOWN });
    open();
    pickRecipient();
    fireEvent.click(screen.getByTestId('letter-see'));
    const block = await screen.findByTestId('letter-as-it-leaves');
    expect(block.className).toContain('mail-fade-in');
    expect(block.className).not.toContain('mail-fade-out');
    expect(MAIL_MOTION_CSS).toMatch(/\.mail-fade-in \{ animation: mail-fade-in 160ms/);
    expect(MAIL_MOTION_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mail-fade-in[\s\S]*animation: none/);
    expect(document.body.innerHTML).toContain('@keyframes mail-fade-in');
  });
});
