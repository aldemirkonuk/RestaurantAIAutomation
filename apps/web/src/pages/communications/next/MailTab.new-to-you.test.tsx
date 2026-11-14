/**
 * "New to you" in Mail (r36 mail gap 6, second half), rendered for real
 * against a stubbed gateway: a row whose newest vendor letter this person was
 * not shown says "New"; a thread on screen tells the gateway it was read,
 * through the newest vendor letter it shows, by that letter's own time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({
  current: { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' } as Record<
    string,
    unknown
  >,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { NEW_TO_YOU, seenMarkFor, type MailMessage } from './mail-format';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};

const person = (n: number, newToYou: unknown) => ({
  key: `vendor:p${n}`,
  kind: 'vendor',
  providerId: `p${n}`,
  name: `Vendor ${n}`,
  lastLine: `Line ${n}`,
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  waitingSince: null,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
  ...(newToYou === 'absent' ? {} : { newToYou }),
});

const letter = (over: Partial<MailMessage>): MailMessage => ({
  id: 'm1',
  direction: 'outbound',
  channel: 'email',
  text: 'Six cases.',
  aiGenerated: false,
  status: 'SENT',
  sentAt: '2026-11-06T09:00:00Z',
  receivedAt: null,
  createdAt: '2026-11-06T08:59:00Z',
  rawDeletedAt: null,
  door: 'from_house',
  ...over,
});

// The newest vendor letter carries Postgres's microseconds; the house wrote after it.
const THREAD = {
  key: 'gm:abc',
  subject: 'Standing order',
  person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Bodega' },
  order: null,
  messages: [
    letter({ id: 'm1', direction: 'inbound', door: 'house_mailbox', receivedAt: '2026-11-05 09:00:00+00', text: 'First.' }),
    letter({ id: 'm2', direction: 'inbound', door: 'house_mailbox', receivedAt: '2026-11-06 07:30:00.123456+00', text: 'Second.' }),
    letter({ id: 'm3', text: 'Our answer.' }),
  ],
  before: null as string | null,
};

let thread: unknown;
let people: unknown[];

function mount(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return qc;
}

const seenPosts = () => api.post.mock.calls.filter(([u]) => u === '/mail/thread/seen');
const gets = (url: string) => api.get.mock.calls.filter(([u]) => u === url).length;

beforeEach(() => {
  auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
  thread = THREAD;
  people = [person(1, true), person(2, false), person(3, null), person(4, 'absent')];
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { key: 'gm:abc', with: 'vendor:p1', seenThrough: '2026-11-06T07:30:00.123456+00:00' } });
  api.get.mockImplementation(async (url: string) => {
    const routes: Record<string, () => unknown> = {
      '/mail/summary': () => SUMMARY,
      '/communications/letters/sender': () => ({ address: null, words: null }),
      '/mail/people': () => ({ people, next: null, storedKinds: ['vendor'] }),
      '/mail/threads': () => ({
        person: THREAD.person,
        threads: [
          { key: 't-new', subject: 'New prices', messageCount: 1, letterCount: 1, lastAt: '2026-11-06T09:00:00Z', lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null, newToYou: true },
          { key: 't-read', subject: 'Old prices', messageCount: 1, letterCount: 1, lastAt: '2026-11-05T09:00:00Z', lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null, newToYou: false },
          { key: 't-unknown', subject: 'Unknown', messageCount: 1, letterCount: 1, lastAt: '2026-11-04T09:00:00Z', lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null, newToYou: null },
        ],
        next: null,
      }),
      '/mail/thread': () => thread,
    };
    const h = routes[url];
    if (!h) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    return { data: h() };
  });
});

describe('the rows say what is new to this person', () => {
  it('a person whose newest vendor letter you were not shown says "New"; read, unknown or an older gateway say nothing', async () => {
    mount('/communications?tab=mail');
    const rows = await screen.findAllByTestId('mail-person');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByTestId('new-to-you')).toHaveTextContent(NEW_TO_YOU);
    expect(NEW_TO_YOU).toBe('New');
    for (const r of rows.slice(1)) expect(within(r).queryByTestId('new-to-you')).toBeNull();
  });

  it("a person's threads say it the same way, thread by thread", async () => {
    mount('/communications?tab=mail&with=vendor%3Ap1');
    const rows = await screen.findAllByTestId('mail-thread-row');
    expect(rows.map((r) => within(r).queryByTestId('new-to-you') !== null)).toEqual([true, false, false]);
  });
});

describe('a thread on screen is read by this person', () => {
  it('tells the gateway the thread, its person and the newest vendor letter, by its time exactly as given', async () => {
    mount('/communications?tab=mail&thread=gm%3Aabc');
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
    expect(seenPosts()[0]).toEqual([
      '/mail/thread/seen',
      null,
      { params: { key: 'gm:abc', with: 'vendor:p1', through: '2026-11-06 07:30:00.123456+00' } },
    ]);
  });

  it('reads the people list and the threads again once the gateway kept the mark, so "New" leaves them', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['mail-people', 'r1', false, ''], { pages: [], pageParams: [] });
    qc.setQueryData(['mail-threads', 'r1', 'vendor:p1'], { pages: [], pageParams: [] });
    qc.setQueryData(['mail-summary', 'r1'], SUMMARY);
    render(
      <MemoryRouter initialEntries={['/communications?tab=mail&thread=gm%3Aabc']}>
        <QueryClientProvider client={qc}>
          <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(qc.getQueryState(['mail-people', 'r1', false, ''])?.isInvalidated).toBe(true));
    expect(qc.getQueryState(['mail-threads', 'r1', 'vendor:p1'])?.isInvalidated).toBe(true);
    // Only those two: the header's count is not what a mark changes, so the
    // summary (fresh, and on screen) is not read again.
    await waitFor(() => expect(qc.isMutating()).toBe(0));
    expect(gets('/mail/summary')).toBe(0);
  });

  it('does not read the lists again when the mark was not kept', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 503 } }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['mail-people', 'r1', false, ''], { pages: [], pageParams: [] });
    render(
      <MemoryRouter initialEntries={['/communications?tab=mail&thread=gm%3Aabc']}>
        <QueryClientProvider client={qc}>
          <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
    await waitFor(() => expect(qc.isMutating()).toBe(0));
    expect(qc.getQueryState(['mail-people', 'r1', false, ''])?.isInvalidated).toBe(false);
  });

  it('sends once per letter: reading the same thread again sends nothing more; a new vendor letter is marked when drawn', async () => {
    const qc = mount('/communications?tab=mail&thread=gm%3Aabc');
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['mail-thread'] });
    });
    expect(gets('/mail/thread')).toBeGreaterThan(1);
    expect(seenPosts()).toHaveLength(1);
    thread = {
      ...THREAD,
      messages: [
        ...THREAD.messages,
        letter({ id: 'm4', direction: 'inbound', door: 'house_mailbox', receivedAt: '2026-11-06 10:00:00+00', text: 'Third.' }),
      ],
    };
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['mail-thread'] });
    });
    await waitFor(() => expect(seenPosts()).toHaveLength(2));
    expect((seenPosts()[1][2] as { params: Record<string, string> }).params.through).toBe('2026-11-06 10:00:00+00');
  });

  it('a thread with no letter from the vendor, or with no person, sends nothing', async () => {
    thread = { ...THREAD, messages: [THREAD.messages[2]] };
    mount('/communications?tab=mail&thread=gm%3Aabc');
    await screen.findByText('Our answer.');
    expect(seenPosts()).toHaveLength(0);
  });

  it('a failed mark changes nothing on screen and is not sent again for the same letter', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 503 } }));
    const qc = mount('/communications?tab=mail&thread=gm%3Aabc');
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['mail-thread'] });
    });
    expect(screen.getByText('Second.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(seenPosts()).toHaveLength(1);
  });
});

describe('seenMarkFor', () => {
  it('names the newest vendor letter on the newest page, never the house\'s own', () => {
    expect(seenMarkFor(THREAD as never)).toEqual({ key: 'gm:abc', with: 'vendor:p1', through: '2026-11-06 07:30:00.123456+00' });
  });

  it('falls back to when the letter was stored, as the gateway does, when its arrival time is missing', () => {
    const page = { ...THREAD, messages: [letter({ id: 'x', direction: 'inbound', receivedAt: null, createdAt: '2026-11-07 08:00:00+00' })] };
    expect(seenMarkFor(page as never)?.through).toBe('2026-11-07 08:00:00+00');
  });

  it('is null with no page, no person, or no vendor letter', () => {
    expect(seenMarkFor(null)).toBeNull();
    expect(seenMarkFor({ ...THREAD, person: null } as never)).toBeNull();
    expect(seenMarkFor({ ...THREAD, messages: [THREAD.messages[2]] } as never)).toBeNull();
  });
});
