/**
 * r107 mail-gap g1: every failed Mail read offers "Read again" instead of a
 * dead end. The people list, a person's threads and an open thread each fail
 * once, the button asks the same read again (one extra request), the content
 * draws, and focus lands on what drew. A read that succeeded has no button.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  waitingPeople: 1,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: 'bodega@in.mudavym.com' },
};
const PERSON = { key: 'vendor:p1', kind: 'vendor', name: 'Bodega Álvaro' };
const PEOPLE = {
  people: [
    {
      key: 'vendor:p1', kind: 'vendor', name: 'Bodega Álvaro', lastLine: 'Line', lastAt: '2026-11-06T09:00:00Z',
      lastDirection: 'inbound', waiting: true, channels: ['email'], openThreads: 1, newestOpenOrderNumber: null,
    },
  ],
  next: null,
  storedKinds: ['vendor'],
};
const THREAD = {
  key: 'gm:abc',
  subject: 'Standing order',
  person: PERSON,
  order: null,
  messages: [
    {
      id: 'm1', direction: 'inbound', channel: 'email', text: 'Six cases.', aiGenerated: false, status: 'DRAFT',
      sentAt: null, receivedAt: '2026-11-01T09:00:00Z', createdAt: '2026-11-01T09:00:00Z', rawDeletedAt: null, door: 'house_mailbox',
    },
  ],
  before: null,
};

const refused = () =>
  Object.assign(new Error('Request failed with status code 503'), {
    isAxiosError: true,
    response: { status: 503, data: { message: 'The mail could not be read.' } },
  });

let failures: Record<string, number>;
const hits = (url: string) => api.get.mock.calls.filter(([u]) => u === url).length;

function mount(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  failures = {};
  const ok: Record<string, unknown> = {
    '/mail/summary': SUMMARY,
    '/communications/letters/sender': {
      address: 'siparis@mail.mudavym.com', words: null,
      conversation: { where: 'mudavym', words: 'x' }, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null },
    },
    '/mail/people': PEOPLE,
    '/mail/threads': { person: PERSON, threads: [], next: null },
    '/mail/thread': THREAD,
  };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if ((failures[url] ?? 0) > 0) {
      failures[url] -= 1;
      throw refused();
    }
    if (!(url in ok)) throw new Error(`unexpected GET ${url}`);
    return { data: ok[url] };
  });
});

describe('Read again', () => {
  it('the people list: one extra request, then the list, focus on it', async () => {
    failures['/mail/people'] = 1;
    mount('/communications?tab=mail');
    const alert = await screen.findByTestId('people-unread');
    const button = screen.getByTestId('people-read-again');
    expect(alert).toContainElement(button);
    expect(button).toHaveTextContent('Read again');
    expect(hits('/mail/people')).toBe(1);
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('mail-person')).toBeInTheDocument());
    expect(hits('/mail/people')).toBe(2);
    expect(screen.queryByTestId('people-read-again')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'People' }));
  });

  it('a person\'s threads: one extra request, then the threads, focus on the name', async () => {
    failures['/mail/threads'] = 1;
    mount('/communications?tab=mail&with=vendor%3Ap1');
    await screen.findByTestId('threads-unread');
    fireEvent.click(screen.getByTestId('threads-read-again'));
    const heading = await screen.findByRole('heading', { name: /Bodega Álvaro/ });
    expect(hits('/mail/threads')).toBe(2);
    expect(screen.queryByTestId('threads-read-again')).toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it('an open thread: one extra request, then the thread, focus on its subject', async () => {
    failures['/mail/thread'] = 1;
    mount('/communications?tab=mail&thread=gm%3Aabc');
    await screen.findByTestId('thread-unread');
    fireEvent.click(screen.getByTestId('thread-read-again'));
    const heading = await screen.findByRole('heading', { name: 'Standing order' });
    expect(hits('/mail/thread')).toBe(2);
    expect(screen.queryByTestId('thread-read-again')).toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it('while it reads again the button says so and a second press asks nothing more', async () => {
    failures['/mail/thread'] = 1;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === '/mail/thread' && failures[url] === 0) await gate;
      return base(url, cfg);
    });
    mount('/communications?tab=mail&thread=gm%3Aabc');
    await screen.findByTestId('thread-unread');
    fireEvent.click(screen.getByTestId('thread-read-again'));
    await waitFor(() => expect(screen.getByTestId('thread-read-again')).toHaveTextContent('Reading…'));
    expect(screen.getByTestId('thread-read-again')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('thread-read-again'));
    expect(hits('/mail/thread')).toBe(2);
    release();
    await screen.findByRole('heading', { name: 'Standing order' });
    expect(hits('/mail/thread')).toBe(2);
  });

  it('a failed people read is not claimed of a different search still being read', async () => {
    failures['/mail/people'] = 1;
    mount('/communications?tab=mail');
    await screen.findByTestId('people-unread');
    const base = api.get.getMockImplementation()!;
    // The next people read (the new search) stays in flight.
    api.get.mockImplementation((url: string, cfg?: unknown) =>
      url === '/mail/people' ? new Promise(() => {}) : base(url, cfg),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search mail' }), { target: { value: 'fikri' } });
    await waitFor(() => expect(hits('/mail/people')).toBe(2));
    expect(screen.queryByTestId('people-unread')).toBeNull();
    expect(screen.queryByText(/The people this house has mail with could not be read/)).toBeNull();
  });

  it('a read that succeeded has no button', async () => {
    mount('/communications?tab=mail');
    await screen.findByTestId('mail-person');
    expect(screen.queryByTestId('people-read-again')).toBeNull();
    expect(screen.queryByText('Read again')).toBeNull();
  });
});
