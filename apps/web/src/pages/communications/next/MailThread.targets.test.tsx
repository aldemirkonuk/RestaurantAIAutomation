/**
 * The thread's three acts keep the 44 px touch floor under 640 px (r109 mail-gap g7).
 * jsdom has no layout, so the spec pins the class that gives the floor, the same
 * way Check now's was pinned (b9867132d). Desktop carries no class and so does not change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({
  current: { user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' } as Record<
    string,
    unknown
  >,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));

// The pull-back itself is proved in QueuedPullBack.test.tsx.
vi.mock('./QueuedPullBack', () => ({
  QueuedPullBack: ({ id }: { id: string }) => <span data-testid="pull-back" data-id={id} />,
}));

import { MailTab } from './MailTab';
import type { MailMessage, MailSummary } from './mail-format';

const SUMMARY: MailSummary = {
  waitingPeople: 2,
  oldestWaitAt: new Date(Date.now() - 2 * 86_400_000 - 60_000).toISOString(),
  inToday: 4,
  outToday: 2,
  heldAtDoor: null,
  doors: {
    houseMailbox: { lastStoredAt: new Date(Date.now() - 3_600_000).toISOString() },
    whatsapp: { lastStoredAt: null },
    mudavymMail: { lastStoredAt: null },
  },
  address: { configured: true, address: 'bodega@in.mudavym.com' },
};

const SENDER = {
  address: 'siparis@mail.mudavym.com',
  words: null,
  conversation: { where: 'mudavym', words: "Vendors reply to Mudavym's mailbox." },
  reader: { granted: true, enabled: true, lastReadAt: null, lastError: null },
};

const person = (n: number, over: Record<string, unknown> = {}) => ({
  key: `vendor:p${n}`,
  kind: 'vendor',
  name: `Vendor ${n}`,
  lastLine: `Line ${n}`,
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: n === 1,
  channels: ['email'],
  openThreads: 1,
  newestOpenOrderNumber: n === 1 ? 'PO-014' : null,
  ...over,
});

const letter = (over: Partial<MailMessage>): MailMessage => ({
  id: 'm1',
  direction: 'outbound',
  channel: 'email',
  text: 'Six cases, as every week.',
  aiGenerated: false,
  status: 'SENT',
  sentAt: '2026-11-06T09:00:00Z',
  receivedAt: null,
  createdAt: '2026-11-06T08:59:00Z',
  rawDeletedAt: null,
  door: 'from_house',
  ...over,
});

const THREAD = {
  key: 'gm:abc',
  subject: 'Standing order',
  person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega Álvaro' },
  order: { id: 'o1', number: 'PO-014', status: 'SENT' },
  messages: [
    letter({ id: 'm1', direction: 'inbound', door: 'house_mailbox', status: 'DRAFT', text: 'First, from the vendor.', receivedAt: '2026-11-01T09:00:00Z' }),
    letter({ id: 'm2', status: 'PENDING_APPROVAL', aiGenerated: true, text: 'Drafted answer.' }),
    letter({ id: 'm3', status: 'HOUSE_QUEUED', text: 'Queued letter.' }),
    letter({ id: 'm4', status: 'RELAY_REFUSED', text: 'Refused letter.' }),
    letter({ id: 'm5', direction: 'inbound', door: 'mudavym_mail', status: 'DRAFT', text: '', rawDeletedAt: '2026-10-02T10:00:00Z' }),
  ],
  before: null as string | null,
};

type Routes = Record<string, (params: Record<string, string>) => unknown>;
const THREAD_WAITING = {
  ...THREAD,
  waiting: true,
  person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Bodega Álvaro' },
  messages: [
    ...THREAD.messages,
    letter({ id: 'm6', direction: 'inbound', door: 'house_mailbox', receivedAt: '2026-11-07T09:00:00Z', sentAt: null }),
  ],
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?thread=gm%3Aabc']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>(['o1'])} onOpenReply={vi.fn()} onAnswer={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender') return { data: SENDER };
    if (url === '/mail/people') return { data: { people: [person(1)], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/threads') return { data: { person: THREAD.person, threads: [], next: null } };
    if (url === '/mail/thread') return { data: THREAD_WAITING };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('the thread acts on a phone', () => {
  it.each(['open-thread-reply', 'write-thread-reply', 'thread-no-reply'])('%s is at least 44 px tall under 640 px', async (id) => {
    mount();
    const act = await screen.findByTestId(id);
    expect(act.className).toContain('max-sm:min-h-[44px]');
    // Only under 640 px: nothing sets a floor at desktop width.
    expect(act.className).not.toMatch(/(^|\s)min-h-/);
  });
});
