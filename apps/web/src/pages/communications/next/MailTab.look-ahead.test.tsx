/**
 * Mail reads what a click is about to ask for when the pointer reaches a row
 * (r56 mail): a person's threads, a thread's letters. A row passed over twice is
 * read once, and looking ahead marks nothing seen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};
const PERSON = {
  key: 'vendor:11111111-1111-4111-8111-111111111111',
  kind: 'vendor',
  providerId: '11111111-1111-4111-8111-111111111111',
  name: 'Maple Meats',
  lastAt: '2026-11-17T10:00:00Z',
  lastLine: 'Tuesday works',
  lastDirection: 'inbound',
  waiting: false,
  waitingSince: null,
  openThreads: 1,
  channels: ['email'],
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
};
const THREAD = {
  key: 'th-1',
  subject: 'Order 12',
  orderNumber: null,
  lastAt: '2026-11-17T10:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  messageCount: 2,
};

function calls(path: string) {
  return api.get.mock.calls.filter((c) => c[0] === path);
}

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/people') return { data: { people: [PERSON], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/mail/threads') return { data: { person: { id: PERSON.providerId, name: 'Maple Meats' }, threads: [THREAD], next: null } };
    if (url === '/mail/thread') return { data: { key: 'th-1', subject: 'Order 12', person: null, order: null, messages: [], before: null } };
    if (url === '/communications/letters/sender') return { data: { address: null, words: null } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('looking ahead', () => {
  it('reads a person\'s threads when the pointer reaches the row, once however often it passes', async () => {
    mount('/communications?tab=mail');
    const row = await screen.findByTestId('mail-person');
    expect(calls('/mail/threads')).toHaveLength(0);
    fireEvent.pointerEnter(row);
    fireEvent.focus(row);
    fireEvent.pointerEnter(row);
    await vi.waitFor(() => expect(calls('/mail/threads')).toHaveLength(1));
    expect(calls('/mail/threads')[0][1]).toEqual({ params: { with: PERSON.key } });
  });

  it('opens the person from what was read ahead without asking again', async () => {
    mount('/communications?tab=mail');
    const row = await screen.findByTestId('mail-person');
    fireEvent.pointerEnter(row);
    await vi.waitFor(() => expect(calls('/mail/threads')).toHaveLength(1));
    fireEvent.click(row);
    await screen.findByTestId('mail-thread-row');
    expect(calls('/mail/threads')).toHaveLength(1);
  });

  it('reads a thread\'s letters when the pointer reaches its row, and marks nothing seen', async () => {
    mount(`/communications?tab=mail&with=${PERSON.key}`);
    const row = await screen.findByTestId('mail-thread-row');
    expect(calls('/mail/thread')).toHaveLength(0);
    fireEvent.touchStart(row);
    await vi.waitFor(() => expect(calls('/mail/thread')).toHaveLength(1));
    expect(calls('/mail/thread')[0][1]).toEqual({ params: { key: 'th-1' } });
    expect(api.post).not.toHaveBeenCalled();
  });
});
