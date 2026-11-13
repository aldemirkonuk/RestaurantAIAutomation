/**
 * r28 mail gaps 16 and 14 on the Mail tab, rendered for real against a
 * stubbed gateway: the search box asks the server (so a person past the first
 * page is found), a search that finds no one says so in its own words, and a
 * thread row counts only the letters that came or went.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { mailSearchTerm, searchEmptyWords, threadCountWords } from './mail-format';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: 'bodega@in.mudavym.com' },
};
const SENDER = { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } };
const person = (n: number) => ({
  key: `vendor:p${n}`,
  kind: 'vendor',
  name: `Vendor ${n}`,
  lastLine: `Line ${n}`,
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderNumber: null,
});

type Routes = Record<string, (params: Record<string, string>) => unknown>;
let routes: Routes;

beforeEach(() => {
  routes = {
    '/mail/summary': () => SUMMARY,
    '/communications/letters/sender': () => SENDER,
    '/mail/people': (p) =>
      p.q === 'fish'
        ? { people: [person(7)], next: null, storedKinds: ['vendor'] }
        : p.q
          ? { people: [], next: null, storedKinds: ['vendor'] }
          : { people: [person(1), person(2)], next: null, storedKinds: ['vendor'] },
    '/mail/threads': () => ({ person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' }, threads: [], next: null }),
  };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    const h = routes[url];
    if (!h) throw new Error(`unexpected GET ${url}`);
    return { data: h(cfg?.params ?? {}) };
  });
});

const calls = (url: string) =>
  api.get.mock.calls.filter(([u]) => u === url).map(([, cfg]) => (cfg as { params?: Record<string, string> })?.params ?? {});

function mount(at = '/communications?tab=mail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the Mail search (gap 16)', () => {
  it('sends the trimmed term to the server and lists who it found', async () => {
    mount();
    expect(await screen.findAllByTestId('mail-person')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search mail' }), { target: { value: '  fish ' } });
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    expect(screen.getByTestId('mail-person')).toHaveTextContent('Vendor 7');
    expect(calls('/mail/people').some((p) => p.q === 'fish')).toBe(true);
    // The unsearched list never carried a q.
    expect(calls('/mail/people')[0]).not.toHaveProperty('q');
  });

  it('waits for typing to stop: one keystroke at a time is not one read each', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    const box = screen.getByRole('searchbox', { name: 'Search mail' });
    for (const v of ['f', 'fi', 'fis', 'fish']) fireEvent.change(box, { target: { value: v } });
    await waitFor(() => expect(calls('/mail/people').some((p) => p.q === 'fish')).toBe(true));
    expect(calls('/mail/people').filter((p) => p.q && p.q !== 'fish')).toEqual([]);
  });

  it('a search with the Waiting chip sends both', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Waiting on you' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search mail' }), { target: { value: 'fish' } });
    await waitFor(() => expect(calls('/mail/people').some((p) => p.q === 'fish' && p.waiting === '1')).toBe(true));
  });

  it('a search that finds no one says so, never that no mail is stored, and Clear brings everyone back', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search mail' }), { target: { value: 'zzz' } });
    const empty = await screen.findByTestId('search-empty');
    expect(empty).toHaveTextContent('No one in this house\'s mail matches “zzz”.');
    expect(screen.queryByTestId('people-empty')).toBeNull();
    expect(screen.queryByText(/No vendor mail has been stored yet/)).toBeNull();
    fireEvent.click(screen.getByTestId('search-clear-empty'));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(2));
    expect(screen.getByRole('searchbox', { name: 'Search mail' })).toHaveValue('');
  });

  it('Escape clears the box and the search', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    const box = screen.getByRole('searchbox', { name: 'Search mail' });
    fireEvent.change(box, { target: { value: 'fish' } });
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(2));
    expect(screen.queryByTestId('search-clear')).toBeNull();
  });

  it('the box takes at most 100 characters', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    expect(screen.getByRole('searchbox', { name: 'Search mail' })).toHaveAttribute('maxLength', '100');
  });

  it('the term helpers: trimmed, cut at 100, and the waiting words', () => {
    expect(mailSearchTerm('  po 12  ')).toBe('po 12');
    expect(mailSearchTerm('   ')).toBe('');
    expect(mailSearchTerm('a'.repeat(150))).toHaveLength(100);
    expect(searchEmptyWords('ali', { waitingOnly: true })).toMatch(/^No one waiting on you matches “ali”\./);
  });
});

describe('a thread row counts its letters (gap 14)', () => {
  const thread = (over: Record<string, unknown>) => ({
    key: 'gm:abc',
    subject: 'Standing order',
    messageCount: 3,
    lastAt: '2026-11-06T09:00:00Z',
    lastDirection: 'inbound',
    waiting: false,
    orderId: null,
    orderNumber: null,
    ...over,
  });

  it('says the letters that came or went, not the drafts', async () => {
    routes['/mail/threads'] = () => ({
      person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' },
      threads: [thread({ messageCount: 3, letterCount: 2 })],
      next: null,
    });
    mount('/communications?tab=mail&with=vendor%3Ap1');
    expect(await screen.findByTestId('mail-thread-count')).toHaveTextContent('2 letters · Bodega wrote last');
  });

  it('a thread holding only a draft shows no count and says nothing has left', async () => {
    routes['/mail/threads'] = () => ({
      person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' },
      threads: [thread({ messageCount: 1, letterCount: 0, lastDirection: null })],
      next: null,
    });
    mount('/communications?tab=mail&with=vendor%3Ap1');
    const line = await screen.findByTestId('mail-thread-count');
    expect(line).toHaveTextContent(/^Nothing on it has been sent or received yet$/);
  });

  it('threadCountWords: one, many, none, and an older gateway with no letterCount', () => {
    expect(threadCountWords({ messageCount: 5, letterCount: 1 })).toBe('1 letter');
    expect(threadCountWords({ messageCount: 5, letterCount: 4 })).toBe('4 letters');
    expect(threadCountWords({ messageCount: 2, letterCount: 0 })).toBeNull();
    expect(threadCountWords({ messageCount: 2 })).toBe('2 letters');
    expect(threadCountWords({ messageCount: 0 })).toBeNull();
  });
});
