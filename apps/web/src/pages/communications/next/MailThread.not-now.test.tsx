/**
 * "Not now" in Mail (r110 mail, DD-r109-13), rendered for real against a
 * stubbed gateway. A manager or an owner puts a waiting vendor thread off
 * until a time on the house's clock; the thread says until when, with Undo;
 * the row says "Back from Not now" once its time came. No motion anywhere.
 * The rule (what waits, what ends it) is proved in SQL
 * (20280125100000_..._test.sql) and the routes in mail.not-now.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import type { MailMessage } from './mail-format';

const THANKS: MailMessage = {
  id: 'v1',
  direction: 'inbound',
  channel: 'email',
  text: 'Can you confirm Friday?',
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: '2026-11-06T09:00:00Z',
  createdAt: '2026-11-06T09:00:00Z',
  rawDeletedAt: null,
  door: 'house_mailbox',
  automatic: false,
  noReplyMarkedAt: null,
};
const WITH = 'vendor:7b000000-0000-4000-8000-000000000001';
const thread = (waiting: boolean, notNow: unknown = null) => ({
  key: 'gm:t1',
  subject: 'Friday order',
  person: { key: WITH, kind: 'vendor', providerId: '7b000000-0000-4000-8000-000000000001', name: 'Bodega Álvaro' },
  order: null,
  messages: [THANKS],
  before: null,
  waiting,
  notNow,
});
const person = (over: Record<string, unknown> = {}) => ({
  key: WITH,
  kind: 'vendor',
  providerId: '7b000000-0000-4000-8000-000000000001',
  name: 'Bodega Álvaro',
  lastAt: '2026-11-06T09:00:00Z',
  lastLine: 'Can you confirm Friday?',
  lastDirection: 'inbound',
  waiting: true,
  waitingSince: '2026-11-06T09:00:00Z',
  openThreads: 1,
  channels: ['email'],
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  key: 'gm:t1',
  subject: 'Friday order',
  messageCount: 1,
  letterCount: 1,
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: true,
  orderId: null,
  orderNumber: null,
  ...over,
});

let threadNow: () => unknown;
let peopleNow: () => unknown[];
let rowsNow: () => unknown[];

function mount(at = '/communications?with=vendor%3A7b000000-0000-4000-8000-000000000001&thread=gm%3At1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
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
  threadNow = () => thread(true);
  peopleNow = () => [];
  rowsNow = () => [];
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') return { data: threadNow() };
    if (url === '/mail/summary') return { data: { waitingPeople: 1, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null, doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } }, address: { configured: false, address: null } } };
    if (url === '/mail/people') return { data: { people: peopleNow(), next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/threads') return { data: { person: { key: WITH, kind: 'vendor', providerId: null, name: 'Bodega Álvaro' }, threads: rowsNow(), next: null } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('Not now on a thread', () => {
  it.each([
    ['in_3_hours', 'In 3 hours'],
    ['tomorrow_9', 'Tomorrow 09:00'],
    ['monday_9', 'Monday 09:00'],
  ])('a manager puts a waiting thread off: %s', async (choice, label) => {
    mount();
    fireEvent.click(await screen.findByTestId('thread-not-now-open'));
    expect(screen.getByText('09:00 house time')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/mail/thread/not-now', { choice }, { params: { key: 'gm:t1', with: WITH } }),
    );
    expect(api.delete).not.toHaveBeenCalled();
  });

  it.each(['staff', 'waiter', ''])('role %p sees no Not now', async (role) => {
    as(role);
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('thread-not-now-open')).toBeNull();
  });

  it('a thread that does not wait offers no Not now', async () => {
    threadNow = () => thread(false);
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('thread-not-now-open')).toBeNull();
  });

  it('a thread put off says until when, and Undo takes it back', async () => {
    threadNow = () => thread(false, { until: '2026-11-07T06:00:00Z', state: 'on' });
    mount();
    expect(await screen.findByTestId('thread-not-now')).toHaveTextContent(/^Not now until .+\. ?Undo$/);
    fireEvent.click(screen.getByTestId('thread-not-now-undo'));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/mail/thread/not-now', { params: { key: 'gm:t1', with: WITH } }),
    );
    expect(api.post.mock.calls.filter(([u]) => u === '/mail/thread/not-now')).toEqual([]);
  });

  it('staff read no Undo line', async () => {
    as('staff');
    threadNow = () => thread(false, { until: '2026-11-07T06:00:00Z', state: 'on' });
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('thread-not-now')).toBeNull();
  });

  it('a thread that came back is cleared once when a manager opens it', async () => {
    threadNow = () => thread(true, { until: '2026-11-06T06:00:00Z', state: 'back' });
    mount();
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    expect(api.delete).toHaveBeenCalledWith('/mail/thread/not-now', { params: { key: 'gm:t1', with: WITH } });
  });

  it('the buttons are 44 px tall on a phone (under 640 px)', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('thread-not-now-open'));
    for (const id of ['thread-not-now-open', 'thread-not-now-in_3_hours', 'thread-not-now-tomorrow_9', 'thread-not-now-monday_9'])
      expect(screen.getByTestId(id).className).toContain('max-sm:min-h-[44px]');
  });

  it('a refusal is said in words', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 409 } }));
    mount();
    fireEvent.click(await screen.findByTestId('thread-not-now-open'));
    fireEvent.click(screen.getByTestId('thread-not-now-tomorrow_9'));
    expect(await screen.findByTestId('not-now-failed')).toHaveTextContent("time zone isn't set");
  });
});

describe('the rows', () => {
  it('a thread row says Back from Not now, and one put off says until when', async () => {
    rowsNow = () => [row({ backFromNotNow: true }), row({ key: 'gm:t2', waiting: false, notNowUntil: '2026-11-07T06:00:00Z' })];
    mount('/communications?with=vendor%3A7b000000-0000-4000-8000-000000000001');
    expect(await screen.findByTestId('thread-back-from-not-now')).toHaveTextContent('Back from Not now');
    expect(screen.getByTestId('thread-not-now-until')).toHaveTextContent(/^· Not now until .+/);
  });

  it('a person row says Back from Not now, and nothing when it is not', async () => {
    peopleNow = () => [person({ backFromNotNow: true }), person({ key: 'vendor:7b000000-0000-4000-8000-000000000002', name: 'Other', backFromNotNow: false })];
    mount('/communications');
    expect(await screen.findAllByTestId('person-back-from-not-now')).toHaveLength(1);
  });
});
