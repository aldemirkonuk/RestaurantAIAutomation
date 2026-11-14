/**
 * r37 walk w3 M-F2: a letter a person filed from Who is writing, after it
 * was held because the receiving server could not confirm its sender, says
 * so on the thread: why it was held, under whom it was filed, by whom and
 * when. A thread whose marks could not be read says that, never that none
 * of its letters carries one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailThread } from './MailThread';
import { fmtWhen } from './cm-format';
import { filedFromHeldWords, type MailMessage } from './mail-format';

const AT = '2026-11-13T15:00:00Z';
const MARK = { heldReason: 'sender_unconfirmed', byName: 'Deniz Kaya', byRecorded: true, at: AT };

const letter = (over: Partial<MailMessage>): MailMessage => ({
  id: 'm1',
  direction: 'inbound',
  channel: 'email',
  text: 'Our bank details changed.',
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: '2026-11-12T09:00:00Z',
  createdAt: '2026-11-12T09:00:00Z',
  rawDeletedAt: null,
  door: 'mudavym_mail',
  attachments: [],
  ...over,
});

let page: Record<string, unknown>;

beforeEach(() => {
  page = {
    key: 'gm:abc',
    subject: 'Bank details changed',
    person: { key: 'vendor:p1', kind: 'vendor', name: 'Anatolia Wines' },
    order: null,
    messages: [
      letter({ id: 'm1', filedFromHeld: MARK }),
      letter({ id: 'm2', text: 'Next delivery Tuesday.', filedFromHeld: null }),
    ],
    before: null,
    waiting: false,
    attachmentsRead: true,
    heldMarksRead: true,
  };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') return { data: page };
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MailThread
          threadKey="gm:abc"
          onBack={vi.fn()}
          backLabel="Back"
          onOpenPerson={vi.fn()}
          canReply={false}
          draftedOrderIds={new Set<string>()}
          onOpenReply={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('a letter filed from Who is writing says a person vouched for it', () => {
  it('says why it was held, under whom, by whom and when, on that letter only', async () => {
    mount();
    const [vouched, plain] = await screen.findAllByTestId('mail-letter');
    expect(within(vouched).getByTestId('letter-filed-from-held')).toHaveTextContent(
      `Held because the receiving mail server could not confirm the sender; filed under Anatolia Wines by Deniz Kaya, ${fmtWhen(AT)}.`,
    );
    expect(within(plain).queryByTestId('letter-filed-from-held')).toBeNull();
    expect(screen.queryByTestId('thread-held-marks-unread')).toBeNull();
  });

  it('a thread whose marks could not be read says so', async () => {
    page = { ...page, heldMarksRead: false, messages: [letter({ id: 'm2', filedFromHeld: null })] };
    mount();
    expect(await screen.findByTestId('thread-held-marks-unread')).toHaveTextContent(
      'Whether a person filed any of these letters after it was held could not be read just now.',
    );
  });

  it('an older gateway that sends no mark draws no line and no warning', async () => {
    page = { ...page, heldMarksRead: undefined, messages: [letter({ id: 'm2', filedFromHeld: undefined })] };
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('letter-filed-from-held')).toBeNull();
    expect(screen.queryByTestId('thread-held-marks-unread')).toBeNull();
  });
});

describe('filedFromHeldWords', () => {
  it('names a person with no name on record as recorded, and a missing day as nothing', () => {
    expect(filedFromHeldWords({ ...MARK, byName: null, at: null }, 'Anatolia Wines')).toBe(
      'Held because the receiving mail server could not confirm the sender; filed under Anatolia Wines by someone whose name is not on record.',
    );
    expect(filedFromHeldWords({ heldReason: 'other', byName: null, byRecorded: false, at: null }, 'X')).toBe(
      'Held before it was filed; filed under X by nobody recorded.',
    );
  });
});
