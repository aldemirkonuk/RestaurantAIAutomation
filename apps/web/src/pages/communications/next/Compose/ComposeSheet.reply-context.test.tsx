/**
 * A reply shows the letter it answers and opens with the cursor in the letter (r109 mail-gap g3).
 * The title names whom it answers, the eyebrow the day of their letter, a 44 px row opens to that
 * letter's words (taken from the thread page already read: no request), and a new letter opens in To.
 * On a desktop, from Mail only, the sheet sits beside the thread.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
import { fmtDay } from './compose-format';
import { MAIL_THREAD_PAGE_CSS } from '../MailThread';
import { ANSWERED_LETTER_CLIP, answerFor, composerLayout, type MailMessage } from '../mail-format';

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


const ANSWERED = { name: 'Bodega Álvaro', at: '2026-11-06T09:00:00Z', text: 'Can you move Friday to Saturday?\nThe truck is late.' };
const REPLY = { providerId: 'p1', subject: 'Re: Standing order', answers: 'm6', answerContext: ANSWERED };

function open(prefill?: React.ComponentProps<typeof ComposeSheet>['prefill'], layout?: 'overlay' | 'compress') {
  return render(
    <MemoryRouter initialEntries={['/communications']}>
      <div className="mudavym">
        <ComposeSheet open onClose={() => {}} prefill={prefill} layout={layout} />
      </div>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockData.current = { ...base };
  mockPost.mockReset();
});

describe('a reply says whom and which letter it answers', () => {
  it('is titled Reply to the person, with the day of their letter as the eyebrow', () => {
    open(REPLY);
    expect(screen.getByRole('heading', { name: 'Reply to Bodega Álvaro' })).toBeInTheDocument();
    expect(screen.getByText(`Answers the letter of ${fmtDay(ANSWERED.at)}`)).toBeInTheDocument();
    expect(screen.queryByText('A letter from the house')).toBeNull();
  });

  it('a held reply that kept no letter still says it is a reply', () => {
    open({ providerId: 'p1', subject: 'Re: Standing order', answers: 'm6' });
    expect(screen.getByRole('heading', { name: 'A reply' })).toBeInTheDocument();
    expect(screen.queryByTestId('answered-letter')).toBeNull();
  });

  it('a new letter keeps its own title and shows no letter row', () => {
    open();
    expect(screen.getByRole('heading', { name: 'A letter from the house' })).toBeInTheDocument();
    expect(screen.queryByTestId('answered-letter')).toBeNull();
  });
});

describe('the letter you are answering', () => {
  it('is a collapsed 44 px row that opens to the letter and closes again, with no request', () => {
    open(REPLY);
    const row = screen.getByRole('button', { name: /The letter you are answering/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row.style.minHeight).toBe('44px');
    expect(screen.queryByTestId('answered-letter-text')).toBeNull();
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('answered-letter-text').textContent).toBe(ANSWERED.text);
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('answered-letter-text')).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('says so when the words of the letter are no longer kept', () => {
    open({ ...REPLY, answerContext: { ...ANSWERED, text: '' } });
    fireEvent.click(screen.getByRole('button', { name: /The letter you are answering/ }));
    expect(screen.getByTestId('answered-letter-text')).toHaveTextContent('The words of this letter are no longer kept.');
  });
});

describe('the words come from the thread page already read', () => {
  const letter = (over: Partial<MailMessage>): MailMessage => ({
    id: 'm6',
    direction: 'inbound',
    channel: 'email',
    text: 'Short.',
    aiGenerated: false,
    status: 'RECEIVED',
    sentAt: null,
    receivedAt: '2026-11-07T09:00:00Z',
    createdAt: '2026-11-07T09:00:00Z',
    rawDeletedAt: null,
    door: 'house_mailbox',
    ...over,
  });
  const head = { subject: 'Standing order', person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Bodega Álvaro' } };

  it('carries the answered letter, clipped at 2,000 characters', () => {
    const long = 'x'.repeat(ANSWERED_LETTER_CLIP + 500);
    const a = answerFor(head as never, [letter({ text: long })]);
    expect(ANSWERED_LETTER_CLIP).toBe(2000);
    expect(a?.context?.text).toHaveLength(2000);
    expect(a?.context).toMatchObject({ name: 'Bodega Álvaro', at: '2026-11-07T09:00:00Z' });
  });

  it('carries no words from a letter whose raw copy was removed', () => {
    const a = answerFor(head as never, [letter({ text: 'secret', rawDeletedAt: '2026-11-08T00:00:00Z' })]);
    expect(a?.context?.text).toBe('');
  });
});

describe('where the cursor lands', () => {
  it('a reply opens with the cursor in the letter', () => {
    open(REPLY);
    expect(document.activeElement).toBe(screen.getByLabelText('The letter'));
  });

  it('a new letter opens with the cursor in To', () => {
    open();
    expect(document.activeElement).toBe(document.getElementById('cmp-to'));
  });
});

describe('beside the thread, from Mail only', () => {
  it('compress sets the page to give up the sheet width, and overlay does not', () => {
    open(REPLY, 'compress');
    expect(document.querySelector('.mudavym')?.getAttribute('data-sheet-open')).toBe('compress');
  });

  it('the page rule pads the thread by the sheet width, with no transition', () => {
    expect(MAIL_THREAD_PAGE_CSS).toBe('.mudavym[data-sheet-open=compress] .mail-thread { padding-right: var(--sheet-width) }');
    expect(MAIL_THREAD_PAGE_CSS).not.toMatch(/transition|animation/);
  });

  it('only a reply written from Mail is laid beside the thread', () => {
    const a = { providerId: 'p1', answers: 'm6', subject: 'Re: x' };
    expect(composerLayout('mail', null, a)).toBe('compress');
    expect(composerLayout('mail', { answers: 'm6' }, null)).toBe('compress');
    expect(composerLayout('mail', null, null)).toBe('overlay');
    expect(composerLayout('mail', {}, a)).toBe('overlay');
    expect(composerLayout('letters', null, a)).toBe('overlay');
    expect(composerLayout('letters', { answers: 'm6' }, null)).toBe('overlay');
  });
});
