/**
 * "No reply needed" in a Mail thread (r28 mail audit, gap 4), rendered for
 * real against a stubbed gateway. A vendor's "Thanks!" used to keep the thread
 * waiting for good; now an owner or a manager can say it needs no answer, the
 * marked letter says so, and the mark can be taken back. What the mark settles
 * is proved in SQL (NR1-NR8) and the route in a-letter-can-need-no-reply.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import type { MailMessage } from './mail-format';

const letter = (over: Partial<MailMessage>): MailMessage => ({
  id: 'm1',
  direction: 'inbound',
  channel: 'email',
  text: 'A letter.',
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: '2026-11-06T09:00:00Z',
  createdAt: '2026-11-06T09:00:00Z',
  rawDeletedAt: null,
  door: 'house_mailbox',
  automatic: false,
  noReplyMarkedAt: null,
  ...over,
});

const ORDER_LETTER = letter({
  id: 'o1',
  direction: 'outbound',
  status: 'SENT',
  text: 'Six cases, please.',
  sentAt: '2026-11-06T08:00:00Z',
  receivedAt: null,
  createdAt: '2026-11-06T08:00:00Z',
  door: 'from_house',
});
const THANKS = letter({ id: 'v1', text: 'Thanks, on its way!', receivedAt: '2026-11-06T09:00:00Z' });
const AUTO = letter({ id: 'a1', text: 'Out of office.', receivedAt: '2026-11-06T09:30:00Z', automatic: true });

const thread = (messages: MailMessage[], waiting: boolean) => ({
  key: 'gm:t1',
  subject: 'Friday order',
  person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega Álvaro' },
  order: null,
  messages,
  before: null,
  waiting,
});

let threadNow: () => unknown;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?thread=gm%3At1']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const as = (role: string) => {
  auth.current = { user: { role, restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: role };
};

beforeEach(() => {
  as('manager');
  threadNow = () => thread([ORDER_LETTER, THANKS], true);
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') return { data: threadNow() };
    if (url === '/mail/summary') return { data: { waitingPeople: 1, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null, doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } }, address: { configured: false, address: null } } };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: [] } };
    if (url === '/mail/threads') return { data: { person: null, threads: [], next: null } };
    if (url === '/communications/letters/sender')
      return {
        data: {
          address: 'siparis@mail.mudavym.com',
          words: null,
          conversation: { where: 'mudavym', words: "Vendors reply to Mudavym's mailbox." },
          reader: { granted: true, enabled: true, lastReadAt: null, lastError: null },
        },
      };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

const threadReads = () => api.get.mock.calls.filter(([u]) => u === '/mail/thread').length;

describe('saying a letter needs no reply', () => {
  it('a waiting thread offers it to a manager, and it marks the newest received letter', async () => {
    api.post.mockResolvedValue({ data: { id: 'v1', marked: true } });
    mount();
    const act = await screen.findByTestId('thread-no-reply');
    expect(act).toHaveTextContent('No reply needed');
    const before = threadReads();
    fireEvent.click(act);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/mail/letters/v1/no-reply-needed'));
    expect(api.delete).not.toHaveBeenCalled();
    // The thread is read again, so what it now says comes from the house's mail.
    await waitFor(() => expect(threadReads()).toBeGreaterThan(before));
  });

  it("an owner sees it too; staff and an unknown role never do", async () => {
    as('owner');
    mount();
    expect(await screen.findByTestId('thread-no-reply')).toBeInTheDocument();
  });

  it.each(['staff', 'waiter', ''])('role %p sees no act', async (role) => {
    as(role);
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('thread-no-reply')).toBeNull();
  });

  it('a thread that does not wait offers nothing, though its last letter is received', async () => {
    threadNow = () => thread([ORDER_LETTER, THANKS], false);
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('thread-no-reply')).toBeNull();
  });

  it('a thread page that says nothing about waiting offers nothing', async () => {
    threadNow = () => {
      const { waiting: _w, ...rest } = thread([ORDER_LETTER, THANKS], true);
      return rest;
    };
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('thread-no-reply')).toBeNull();
  });

  it('an automatic letter after the vendor is not the one marked', async () => {
    threadNow = () => thread([ORDER_LETTER, THANKS, AUTO], true);
    api.post.mockResolvedValue({ data: { id: 'v1', marked: true } });
    mount();
    fireEvent.click(await screen.findByTestId('thread-no-reply'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/mail/letters/v1/no-reply-needed'));
  });

  it('a refusal is said in words and nothing claims it was marked', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 503 } }));
    mount();
    fireEvent.click(await screen.findByTestId('thread-no-reply'));
    expect(await screen.findByTestId('no-reply-failed')).toHaveTextContent(
      'It could not be marked just now, so nothing changed. Try again.',
    );
    expect(screen.queryByTestId('letter-no-reply')).toBeNull();
  });

  it('no answer at all says to check the connection', async () => {
    api.post.mockRejectedValue(new Error('Network Error'));
    mount();
    fireEvent.click(await screen.findByTestId('thread-no-reply'));
    expect(await screen.findByTestId('no-reply-failed')).toHaveTextContent(
      'No answer. Check the connection; nothing was changed.',
    );
  });
});

describe('a marked letter', () => {
  const marked = (over: Partial<MailMessage> = {}) =>
    letter({ ...THANKS, noReplyMarkedAt: '2026-11-06T09:05:00Z', ...over });

  it('says so on the letter, and a manager can take it back', async () => {
    threadNow = () => thread([ORDER_LETTER, marked()], false);
    api.delete.mockResolvedValue({ data: { id: 'v1', marked: false } });
    mount();
    const line = await screen.findByTestId('letter-no-reply');
    expect(line).toHaveTextContent(/^Marked as needing no reply, .+\.\s*It needs a reply after all$/);
    const letters = screen.getAllByTestId('mail-letter');
    expect(within(letters[1]).getByTestId('letter-no-reply')).toBe(line);
    expect(screen.queryByTestId('thread-no-reply')).toBeNull();
    fireEvent.click(within(line).getByTestId('letter-no-reply-undo'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/mail/letters/v1/no-reply-needed'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('staff read the mark but cannot take it back', async () => {
    as('staff');
    threadNow = () => thread([ORDER_LETTER, marked()], false);
    mount();
    expect(await screen.findByTestId('letter-no-reply')).toHaveTextContent('Marked as needing no reply');
    expect(screen.queryByTestId('letter-no-reply-undo')).toBeNull();
  });

  it('only the newest marked letter offers to take its mark back', async () => {
    const older = marked({ id: 'v0', text: 'Got it.', receivedAt: '2026-11-05T09:00:00Z', noReplyMarkedAt: '2026-11-05T10:00:00Z' });
    threadNow = () => thread([older, ORDER_LETTER, marked()], false);
    mount();
    await screen.findAllByTestId('letter-no-reply');
    const undos = screen.getAllByTestId('letter-no-reply-undo');
    expect(undos).toHaveLength(1);
    const letters = screen.getAllByTestId('mail-letter');
    expect(within(letters[2]).getByTestId('letter-no-reply-undo')).toBe(undos[0]);
  });

  it('a later letter waits again: the act returns and targets the new one', async () => {
    const later = letter({ id: 'v2', text: 'One more thing.', receivedAt: '2026-11-06T11:00:00Z' });
    threadNow = () => thread([ORDER_LETTER, marked(), later], true);
    api.post.mockResolvedValue({ data: { id: 'v2', marked: true } });
    mount();
    fireEvent.click(await screen.findByTestId('thread-no-reply'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/mail/letters/v2/no-reply-needed'));
  });

  it('a failed take-back says the mark still holds', async () => {
    threadNow = () => thread([ORDER_LETTER, marked()], false);
    api.delete.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 500 } }));
    mount();
    fireEvent.click(await screen.findByTestId('letter-no-reply-undo'));
    expect(await screen.findByTestId('no-reply-failed')).toHaveTextContent(
      'The mark could not be taken back just now; it still holds. Try again.',
    );
  });

  it('a letter the house sent never shows a mark', async () => {
    threadNow = () => thread([letter({ ...ORDER_LETTER, noReplyMarkedAt: '2026-11-06T09:05:00Z' })], false);
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('letter-no-reply')).toBeNull();
  });
});
