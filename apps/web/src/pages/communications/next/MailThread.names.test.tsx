/**
 * A team or guest thread names its person, and never says "The vendor"
 * (r104 mail-gap g3, web). The gateway sends the person's name (a staff
 * member from the roster, a guest from the From line); when it has none, the
 * thread says what the person is, not what they are not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { lastWriterWords, personWords } from './mail-format';

const letter = {
  id: 'g1',
  direction: 'inbound',
  channel: 'email',
  text: 'Can we book Friday?',
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: '2026-11-06T09:00:00Z',
  createdAt: '2026-11-06T09:00:00Z',
  rawDeletedAt: null,
  door: 'house_mailbox',
  automatic: false,
  noReplyMarkedAt: null,
  kind: 'guest',
  fromAddress: 'j@x.example',
  toAddresses: ['house@x.example'],
};

let name: string | null;
function mount(onAnswer: (a: unknown) => void = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?thread=gm%3At1']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} onAnswer={onAnswer} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  name = null;
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread')
      return {
        data: {
          key: 'gm:t1',
          subject: 'A table',
          person: { key: 'guest:j@x.example', kind: 'guest', providerId: null, name },
          order: null,
          messages: [letter],
          before: null,
          waiting: false,
          attachmentsRead: true,
        },
      };
    if (url === '/mail/summary') return { data: { waitingPeople: 0, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null, doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } }, address: { configured: false, address: null } } };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: [] } };
    if (url === '/mail/threads') return { data: { person: null, threads: [], next: null } };
    if (url === '/communications/letters/sender')
      return { data: { address: 'siparis@mail.mudavym.com', words: null, conversation: { where: 'mudavym', words: 'x' }, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('a guest thread', () => {
  it("says the guest's name on the header and the letter", async () => {
    name = 'Jane Roe';
    mount();
    await screen.findByText('A table');
    expect((await screen.findAllByText('Jane Roe')).length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain('The vendor');
  });

  it("with no name says 'The guest', never 'The vendor'", async () => {
    mount();
    await screen.findByText('A table');
    expect((await screen.findAllByText('The guest')).length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain('The vendor');
  });
});

describe('answering a guest (r104 mail-gap g1, ADR 0396)', () => {
  it('offers the reply to an owner, naming the address that wrote', async () => {
    const onAnswer = vi.fn();
    mount(onAnswer);
    const act = await screen.findByTestId('write-thread-reply');
    act.click();
    expect(onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: null, answers: 'g1', person: expect.objectContaining({ kind: 'guest', address: 'j@x.example' }) }),
      { threadKey: 'gm:t1', personKey: 'guest:j@x.example' },
    );
  });
  it('offers it to a manager', async () => {
    auth.current = { user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' };
    mount();
    expect(await screen.findByTestId('write-thread-reply')).toBeInTheDocument();
  });
  it('offers it to no one else', async () => {
    auth.current = { user: { role: 'waiter', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'waiter' };
    mount();
    await screen.findByText('A table');
    expect(screen.queryByTestId('write-thread-reply')).toBeNull();
  });
});

describe('the words for a person with no name', () => {
  it('say what the person is', () => {
    expect(personWords(null, 'guest')).toBe('The guest');
    expect(personWords('  ', 'team')).toBe('The team member');
    expect(personWords(undefined)).toBe('The vendor');
    expect(personWords('Ayse (manager)', 'team')).toBe('Ayse (manager)');
  });
  it('a thread row says who wrote last by kind', () => {
    expect(lastWriterWords('inbound', null, 2, 'guest')).toBe('The guest wrote last');
    expect(lastWriterWords('inbound', 'Jane Roe', 2, 'guest')).toBe('Jane Roe wrote last');
    expect(lastWriterWords('inbound', null, 2)).toBe('The vendor wrote last');
  });
});
