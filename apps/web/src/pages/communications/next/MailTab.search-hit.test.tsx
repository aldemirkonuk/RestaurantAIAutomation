/**
 * A Mail search shows the words that matched (r109 mail-gap g5), rendered for real against a stubbed
 * gateway: a person found by a word in an older letter shows that stretch with the term in <mark>,
 * a row with no snippet keeps its newest line, and nothing animates. What the words are, and who may be
 * quoted, is proved in SQL (the_mail_search_shows_the_words_that_matched_test.sql).
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
import { markedParts } from './mail-format';

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

const found = (over: Record<string, unknown> = {}) => ({ ...person(7), hitLine: '…the Tahini pallet arrives Friday…', ...over });

beforeEach(() => {
  routes = {
    '/mail/summary': () => SUMMARY,
    '/communications/letters/sender': () => SENDER,
    '/mail/people': (p) =>
      p.q ? { people: [found(), person(8)], next: null, storedKinds: ['vendor'] } : { people: [person(1)], next: null, storedKinds: ['vendor'] },
    '/mail/threads': () => ({ person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' }, threads: [], next: null }),
  };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    const h = routes[url];
    if (!h) throw new Error(`unexpected GET ${url}`);
    return { data: h(cfg?.params ?? {}) };
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function search(term: string) {
  await screen.findAllByTestId('mail-person');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search mail' }), { target: { value: term } });
  await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(2));
}

describe('the person row shows the words that matched', () => {
  it('draws the stretch of the older letter in place of the newest line, with the term marked', async () => {
    mount();
    await search('tahini');
    const hit = screen.getByTestId('person-hit');
    expect(hit).toHaveTextContent('…the Tahini pallet arrives Friday…');
    const marks = hit.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    // The reader typed lower case; the letter says Tahini; the letter's own case is kept.
    expect(marks[0]).toHaveTextContent('Tahini');
    expect(screen.getAllByTestId('mail-person')[0]).not.toHaveTextContent('Line 7');
  });

  it('a row with no snippet keeps its newest line', async () => {
    mount();
    await search('tahini');
    const rows = screen.getAllByTestId('mail-person');
    expect(rows[1]).toHaveTextContent('Line 8');
    expect(rows[1].querySelector('mark')).toBeNull();
  });

  it('with no search the list draws the newest lines and no snippet', async () => {
    mount();
    expect(await screen.findByTestId('mail-person')).toHaveTextContent('Line 1');
    expect(screen.queryByTestId('person-hit')).toBeNull();
  });

  it('a snippet the term is not in is shown whole and unmarked', async () => {
    routes['/mail/people'] = (p) => ({ people: p.q ? [found({ hitLine: 'Nothing like it here' }), person(8)] : [person(1)], next: null, storedKinds: ['vendor'] });
    mount();
    await search('tahini');
    expect(screen.getByTestId('person-hit')).toHaveTextContent('Nothing like it here');
    expect(screen.getByTestId('person-hit').querySelector('mark')).toBeNull();
  });

  it('draws no animation on the snippet or the mark', async () => {
    mount();
    await search('tahini');
    const hit = screen.getByTestId('person-hit');
    for (const el of [hit, ...Array.from(hit.querySelectorAll('mark'))]) {
      const css = (el as HTMLElement).style;
      expect(css.animation).toBe('');
      expect(css.transition).toBe('');
    }
    expect(hit.className).not.toMatch(/fade|arrive|animate/);
  });
});

describe('markedParts', () => {
  it('marks every match, blind to case, accents and Turkish i, and keeps the letter exactly as written', () => {
    expect(markedParts('Şükrü sent SUKRU and şükrü', 'sukru')).toEqual([
      { text: 'Şükrü', hit: true },
      { text: ' sent ', hit: false },
      { text: 'SUKRU', hit: true },
      { text: ' and ', hit: false },
      { text: 'şükrü', hit: true },
    ]);
    expect(markedParts('Irmak ve ırmak', 'irmak').filter((p) => p.hit).map((p) => p.text)).toEqual(['Irmak', 'ırmak']);
  });

  it('marks an accented letter by its plain form', () => {
    expect(markedParts('Café Álvaro', 'cafe').filter((p) => p.hit).map((p) => p.text)).toEqual(['Café']);
    expect(markedParts('Café Álvaro', 'alvaro').filter((p) => p.hit).map((p) => p.text)).toEqual(['Álvaro']);
  });

  it('a term that is not there, or an empty one, leaves the text whole', () => {
    expect(markedParts('abc def', 'xyz')).toEqual([{ text: 'abc def', hit: false }]);
    expect(markedParts('abc def', '   ')).toEqual([{ text: 'abc def', hit: false }]);
  });
});
