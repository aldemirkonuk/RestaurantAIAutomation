/**
 * The Mail tab's list and a person's threads (founder /goal 2026-11-07;
 * proposal Phase C, L9 narrowed), rendered for real against a stubbed gateway:
 * the address is the state (`?with=`), paging never caps, and a failed read is
 * an em dash and words, never 0. The thread and the intake sheet are proved in
 * MailTab.thread.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn() }));
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
import { communicationsTour } from '../../../guidance/content/communications';
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
let routes: Routes;
const fail503 = () => {
  throw Object.assign(new Error('Request failed with status code 503'), {
    isAxiosError: true,
    response: { status: 503, data: { message: 'The mail could not be read.' } },
  });
};

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

/** The browser's own Back button: one step back in history, nothing else. */
function BrowserBack() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="browser-back" onClick={() => navigate(-1)}>
      browser back
    </button>
  );
}

/** `at` may be a history: the last entry is the one shown. */
function mount(at: string | string[] = '/communications?tab=mail', props: Partial<Parameters<typeof MailTab>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenReply = vi.fn();
  const entries = Array.isArray(at) ? at : [at];
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <QueryClientProvider client={qc}>
        <MailTab
          draftedOrderIds={new Set<string>()}
          onOpenReply={onOpenReply}
          whoIsWriting={<section aria-label="Who is writing" data-testid="who-is-writing" />}
          {...props}
        />
        <Where />
        <BrowserBack />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onOpenReply };
}

beforeEach(() => {
  auth.current = { user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' };
  routes = {
    '/mail/summary': () => SUMMARY,
    '/communications/letters/sender': () => SENDER,
    '/mail/people': () => ({ people: [person(1), person(2)], next: null, storedKinds: ['vendor'] }),
    '/mail/threads': () => ({ person: THREAD.person, threads: [], next: null }),
    '/mail/thread': () => THREAD,
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

describe('the list', () => {
  it('says who waits, today, and one row per person with their marks', async () => {
    mount();
    expect(await screen.findByText('2 vendors are waiting on you. The oldest has been waiting 2 days.')).toBeInTheDocument();
    expect(screen.getByTestId('mail-today')).toHaveTextContent('Today: 4 letters in, 2 out.');
    const rows = await screen.findAllByTestId('mail-person');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Vendor 1');
    expect(rows[0]).toHaveTextContent('vendor');
    expect(rows[0]).toHaveTextContent('order PO-014');
    expect(rows[0]).toHaveTextContent('Line 1');
    expect(within(rows[0]).getByRole('img', { name: 'waiting on you' })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('img', { name: 'waiting on you' })).toBeNull();
    expect(within(rows[0]).getByRole('img', { name: 'mail' })).toBeInTheDocument();
    expect(screen.getByTestId('stored-kinds')).toHaveTextContent('are under Who is writing, below');
    // Two chips only: All and Waiting on you.
    expect(within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All',
      'Waiting on you',
    ]);
  });

  // r21: strangers and held letters are mail too. "Who is writing" sits
  // under the people list, and only there: a person's threads, a thread and
  // the setup are their own views.
  it('draws "Who is writing" under the people, and not inside a person, a thread or the setup', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    const people = screen.getByRole('region', { name: 'People' });
    const who = screen.getByTestId('who-is-writing');
    expect(people.compareDocumentPosition(who) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([['with=vendor%3Ap1'], ['thread=gm%3Aabc'], ['setup=1']])('no "Who is writing" at ?%s', (q) => {
    mount(`/communications?tab=mail&${q}`);
    expect(screen.queryByTestId('who-is-writing')).toBeNull();
  });

  it('Waiting on you asks for only the waiting people', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Waiting on you' }));
    await waitFor(() => expect(calls('/mail/people').some((p) => p.waiting === '1')).toBe(true));
  });

  // Spec (c): no cap — the next cursor is asked for and the page appends.
  it('"Show older people" asks for the next cursor and appends', async () => {
    routes['/mail/people'] = (p) =>
      p.after === 'CUR2'
        ? { people: [person(3)], next: null, storedKinds: ['vendor'] }
        : { people: [person(1), person(2)], next: 'CUR2', storedKinds: ['vendor'] };
    mount();
    expect(await screen.findAllByTestId('mail-person')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show older people' }));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(3));
    expect(calls('/mail/people').some((p) => p.after === 'CUR2')).toBe(true);
    expect(screen.getAllByTestId('mail-person')[2]).toHaveTextContent('Vendor 3');
    expect(screen.queryByRole('button', { name: 'Show older people' })).toBeNull();
  });

  it('an empty list names which doors are connected', async () => {
    routes['/mail/people'] = () => ({ people: [], next: null, storedKinds: ['vendor'] });
    mount();
    expect(await screen.findByTestId('people-empty')).toHaveTextContent(
      'No vendor mail has been stored yet. Mail is read from your mailbox and your Mudavym address (bodega@in.mudavym.com).',
    );
  });

  it('opening a person puts ?with= in the address', async () => {
    mount();
    fireEvent.click((await screen.findAllByTestId('mail-person'))[0]);
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?tab=mail&with=vendor%3Ap1');
  });

  // Spec (g): a failed summary is an em dash and words, never 0.
  it('a failed summary is an em dash and words, never 0', async () => {
    routes['/mail/summary'] = fail503;
    mount();
    const header = await screen.findByText(/Who is waiting on you could not be read/);
    expect(header).toHaveTextContent(
      '— Who is waiting on you could not be read (The mail could not be read). That does not mean no one is.',
    );
    expect(screen.getByTestId('mail-today')).toHaveTextContent('Today: —');
    expect(screen.getByTestId('mail-header').textContent).not.toMatch(/\b0\b|No one is waiting/);
  });

  it('a failed list says so in words', async () => {
    routes['/mail/people'] = fail503;
    mount();
    expect(await screen.findByTestId('people-unread')).toHaveTextContent(
      'The people this house has mail with could not be read (The mail could not be read). That does not mean there are none.',
    );
  });
});

// r23 walk: the page tour has steps for each tab. Started from Mail it showed
// "1/1", since both later steps were Letters' own. Mail's steps must be drawn
// by the real tab: the status line in every view, the people and "Who is
// writing" in the list.
describe('the tour on the Mail tab', () => {
  const mailSteps = communicationsTour.steps
    .map((s) => s.element)
    .filter((el) => el !== 'nav[aria-label="Mail and letters"]');
  const drawn = () => mailSteps.filter((el) => document.querySelector(el));

  it('the list draws three steps of its own', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    expect(drawn()).toEqual([
      '[data-tour="mail-status"]',
      'section[aria-label="People"]',
      'section[aria-label="Who is writing"]',
    ]);
  });

  it.each([['with=vendor%3Ap1'], ['thread=gm%3Aabc'], ['setup=1']])('?%s still draws the status step', async (q) => {
    mount(`/communications?tab=mail&${q}`);
    await screen.findByTestId('mail-status');
    expect(drawn()).toEqual(['[data-tour="mail-status"]']);
    expect(document.querySelector('[data-tour="mail-status"]')).toContainElement(screen.getByTestId('mail-status'));
  });
});

describe("a person's threads (spec b)", () => {
  it('?with= shows that person\'s threads: subject, count, who wrote last, order', async () => {
    routes['/mail/threads'] = (p) => ({
      person: { key: p.with, kind: 'vendor', name: 'Bodega Álvaro' },
      threads: [
        {
          key: 'gm:abc',
          subject: 'Standing order',
          messageCount: 3,
          lastAt: '2026-11-06T09:00:00Z',
          lastDirection: 'inbound',
          waiting: true,
          orderId: 'o1',
          orderNumber: 'PO-014',
        },
      ],
      next: null,
    });
    mount('/communications?tab=mail&with=vendor%3Ap1');
    const row = await screen.findByTestId('mail-thread-row');
    expect(calls('/mail/threads')[0]).toMatchObject({ with: 'vendor:p1' });
    expect(row).toHaveTextContent('Standing order');
    expect(row).toHaveTextContent('order PO-014');
    expect(row).toHaveTextContent('3 letters · Bodega Álvaro wrote last');
    fireEvent.click(row);
    expect(screen.getByTestId('where')).toHaveTextContent('with=vendor%3Ap1&thread=gm%3Aabc');
    fireEvent.click(await screen.findByRole('button', { name: /Back to their threads/ }));
    expect(screen.getByTestId('where')).toHaveTextContent(/with=vendor%3Ap1$/);
  });

  it('a person the house has no mail with says so', async () => {
    routes['/mail/threads'] = () => ({ person: null, threads: [], next: null });
    mount('/communications?tab=mail&with=vendor%3Anobody');
    expect(await screen.findByTestId('threads-missing')).toHaveTextContent('This house has no mail with that person.');
  });
});

// The founder's ask (2026-11-07): one line says whether mail is connected.
describe('the status line', () => {
  const status = () => screen.findByTestId('mail-status');

  // A recent read of the mailbox: the 1 h old letter came in through a way in that is open now.
  const READING = () => ({ ...SENDER, reader: { ...SENDER.reader, lastReadAt: new Date(Date.now() - 60_000).toISOString() } });

  it('connected, with when the last letter came', async () => {
    routes['/communications/letters/sender'] = READING;
    mount();
    await waitFor(async () => expect(await status()).toHaveTextContent('Connected · last letter 1 h ago'));
    expect(screen.getByTestId('mail-status')).toHaveAttribute('data-state', 'connected');
  });

  // QA round 16, finding 4: never "cannot tell" for a house known not connected.
  it('not connected says "Not connected"', async () => {
    routes['/communications/letters/sender'] = () => ({ ...SENDER, reader: { ...SENDER.reader, granted: false } });
    routes['/mail/summary'] = () => ({ ...SUMMARY, address: { configured: true, address: null } });
    mount();
    await waitFor(async () => expect(await status()).toHaveTextContent(/^Not connected$/));
  });

  it('a failed last read needs attention, in words, never the raw error', async () => {
    routes['/communications/letters/sender'] = () => ({
      ...SENDER,
      reader: { ...SENDER.reader, lastError: 'invalid_grant: Token has been expired or revoked.' },
    });
    mount();
    await waitFor(async () =>
      expect(await status()).toHaveTextContent(
        'Needs attention · Google no longer lets Mudavym read your mailbox. Connect it again in Connections.',
      ),
    );
    expect(document.body.textContent).not.toMatch(/invalid_grant|Token has been/);
  });

  it('a failed sender read with no address says it could not be read', async () => {
    routes['/communications/letters/sender'] = fail503;
    routes['/mail/summary'] = () => ({ ...SUMMARY, address: { configured: true, address: null } });
    mount();
    await waitFor(async () => expect(await status()).toHaveTextContent('Whether mail is connected could not be read'));
  });

  // QA S5b: a sender reply with no reader must not say "checking" forever.
  it('a sender reply with no reader is not read, never "checking"', async () => {
    routes['/communications/letters/sender'] = () => ({ ...SENDER, reader: undefined });
    routes['/mail/summary'] = () => ({ ...SUMMARY, address: { configured: true, address: null } });
    mount();
    await waitFor(async () => expect(await status()).toHaveAttribute('data-state', 'unknown'));
  });

  // QA round 16, finding 6: the reader is re-read while the tab is shown.
  it('the reader is read again every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      await waitFor(() => expect(calls('/communications/letters/sender')).toHaveLength(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await waitFor(() => expect(calls('/communications/letters/sender').length).toBeGreaterThanOrEqual(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

// QA round 16, N2: browser Back used to leave /communications.
describe('Back', () => {
  it("browser Back steps thread → person → everyone and stays on /communications", async () => {
    routes['/mail/threads'] = (p) => ({
      person: { key: p.with, kind: 'vendor', name: 'Vendor 1' },
      threads: [
        { key: 'gm:abc', subject: 'Standing order', messageCount: 1, lastAt: '2026-11-06T09:00:00Z', lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null },
      ],
      next: null,
    });
    mount(['/orders', '/communications?tab=mail']);
    fireEvent.click((await screen.findAllByTestId('mail-person'))[0]);
    fireEvent.click(await screen.findByTestId('mail-thread-row'));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?tab=mail&with=vendor%3Ap1&thread=gm%3Aabc');
    fireEvent.click(screen.getByTestId('browser-back'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail&with=vendor%3Ap1$/);
    fireEvent.click(screen.getByTestId('browser-back'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
  });

  it('the in-app Back steps the same history, so it piles up no entries', async () => {
    mount(['/orders', '/communications?tab=mail']);
    fireEvent.click((await screen.findAllByTestId('mail-person'))[0]);
    fireEvent.click(await screen.findByRole('button', { name: '← Everyone' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
    fireEvent.click(screen.getByTestId('browser-back'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/orders$/);
  });

  it('the in-app Back on a link opened cold stays on the page', async () => {
    mount(['/orders', '/communications?tab=mail&with=vendor%3Ap1']);
    fireEvent.click(await screen.findByRole('button', { name: '← Everyone' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
  });

  // Audit follow-up: "← Everyone" used to step history, and after the
  // thread's person link the entry behind was the thread, not everyone.
  it('"← Everyone" after the thread\'s person link goes to everyone, not back to the thread', async () => {
    routes['/mail/threads'] = (p) => ({
      person: { key: p.with, kind: 'vendor', name: 'Bodega Álvaro' },
      threads: [
        { key: 'gm:abc', subject: 'Standing order', messageCount: 1, lastAt: '2026-11-06T09:00:00Z', lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null },
      ],
      next: null,
    });
    mount(['/orders', '/communications?tab=mail']);
    fireEvent.click((await screen.findAllByTestId('mail-person'))[0]);
    fireEvent.click(await screen.findByTestId('mail-thread-row'));
    fireEvent.click(await screen.findByRole('button', { name: 'Bodega Álvaro' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail&with=vendor%3Ap1$/);
    fireEvent.click(await screen.findByRole('button', { name: '← Everyone' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
    expect(await screen.findAllByTestId('mail-person')).toHaveLength(2);
  });

  it('"← Everyone" after a cold thread link\'s person link goes to everyone and stays on the page', async () => {
    mount(['/orders', '/communications?tab=mail&thread=gm%3Aabc']);
    fireEvent.click(await screen.findByRole('button', { name: 'Bodega Álvaro' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail&with=vendor%3Ap1$/);
    fireEvent.click(await screen.findByRole('button', { name: '← Everyone' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
    fireEvent.click(screen.getByTestId('browser-back'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail&thread=gm%3Aabc$/);
  });
});

describe('the setup path', () => {
  const SETUP = {
    canChange: true,
    senders: { failed: null, chosenConnectionId: null, choices: [] },
    arrival: { domainReady: true, address: 'bodega@in.mudavym.com', failed: null },
    testLetter: { failed: null, latest: null },
  };
  beforeEach(() => {
    routes['/communications/mail-setup'] = () => SETUP;
    routes['/communications/letters/sender'] = () => ({
      ...SENDER,
      reader: { ...SENDER.reader, lastReadAt: new Date(Date.now() - 60_000).toISOString() },
    });
  });

  it('"Mail setup" opens ?setup=1 with the tab\'s own status line, and browser Back returns to the list', async () => {
    mount(['/orders', '/communications?tab=mail']);
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByTestId('setup-link'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail&setup=1$/);
    expect(await screen.findByTestId('mail-setup')).toBeInTheDocument();
    expect(screen.queryByTestId('mail-person')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('setup-status')).toHaveTextContent('Connected · last letter 1 h ago'));
    fireEvent.click(screen.getByTestId('browser-back'));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
    expect(await screen.findAllByTestId('mail-person')).toHaveLength(2);
  });

  // r21 walk: the house has a Mudavym address, so the status line reads
  // "Connected · …"; its own reader is switched off, and the setup must still
  // offer the switch.
  it('a switched-off reader under a connected line still offers the switch', async () => {
    routes['/communications/letters/sender'] = () => ({
      ...SENDER,
      reader: { ...SENDER.reader, enabled: false, lastReadAt: new Date(Date.now() - 60_000).toISOString() },
    });
    mount(['/communications?tab=mail&setup=1']);
    await waitFor(() => expect(screen.getByTestId('setup-status')).toHaveTextContent(/reading your mailbox is switched off/));
    expect(await screen.findByRole('button', { name: 'Open the switch in Settings' })).toBeInTheDocument();
  });

  it('the in-app Back on a setup link opened cold stays on the page', async () => {
    mount(['/orders', '/communications?tab=mail&setup=1']);
    fireEvent.click(await screen.findByRole('button', { name: '← Back to the mail' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
  });

  it('"Not connected" offers the setup', async () => {
    routes['/communications/letters/sender'] = () => ({ ...SENDER, reader: { ...SENDER.reader, granted: false } });
    routes['/mail/summary'] = () => ({ ...SUMMARY, address: { configured: true, address: null } });
    mount();
    fireEvent.click(await screen.findByTestId('status-setup'));
    expect(screen.getByTestId('where')).toHaveTextContent(/setup=1/);
    expect(await screen.findByTestId('mail-setup')).toBeInTheDocument();
  });

  it('a connected house is not nagged to set up', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    await waitFor(() => expect(screen.getByTestId('mail-status')).toHaveAttribute('data-state', 'connected'));
    expect(screen.queryByTestId('status-setup')).toBeNull();
  });

  // QA round 26, #977: an address alone is not mail arriving; the test letter is.
  it('an address with nothing arrived is not connected, and offers the setup', async () => {
    routes['/communications/letters/sender'] = () => ({ ...SENDER, reader: { ...SENDER.reader, granted: false } });
    routes['/mail/summary'] = () => ({
      ...SUMMARY,
      doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('mail-status')).toHaveTextContent(/^Address made, no letter yet$/));
    expect(screen.getByTestId('mail-status')).toHaveAttribute('data-state', 'unproven');
    expect(screen.getByTestId('status-setup')).toBeInTheDocument();
  });

  it('the arrived test letter makes the line connected', async () => {
    routes['/communications/letters/sender'] = () => ({ ...SENDER, reader: { ...SENDER.reader, granted: false } });
    routes['/mail/summary'] = () => ({
      ...SUMMARY,
      doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
    });
    routes['/communications/mail-setup'] = () => ({
      ...SETUP,
      testLetter: {
        failed: null,
        latest: {
          code: 'K7QM-2RZD',
          subject: 'Mudavym test letter K7QM-2RZD',
          address: 'bodega@in.mudavym.com',
          mailto: 'mailto:bodega@in.mudavym.com',
          startedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
          arrivedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
          arrivedFrom: 'me@gmail.test',
        },
      },
    });
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('mail-status')).toHaveTextContent(/^Connected · the test letter arrived 3 min ago$/),
    );
  });

  it('an earlier test letter that arrived also makes the line connected', async () => {
    // QA round 26, #974 defect 2: the newest check is still open, an older
    // one landed. The address is proved either way.
    routes['/communications/letters/sender'] = () => ({ ...SENDER, reader: { ...SENDER.reader, granted: false } });
    routes['/mail/summary'] = () => ({
      ...SUMMARY,
      doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
    });
    routes['/communications/mail-setup'] = () => ({
      ...SETUP,
      testLetter: {
        failed: null,
        latest: {
          code: 'BBBB-BBBB',
          subject: 'Mudavym test letter BBBB-BBBB',
          address: 'bodega@in.mudavym.com',
          mailto: 'mailto:bodega@in.mudavym.com',
          startedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
          arrivedAt: null,
          arrivedFrom: null,
        },
        lastArrival: { code: 'AAAA-AAAA', arrivedAt: new Date(Date.now() - 2 * 60_000).toISOString(), arrivedFrom: 'me@gmail.test' },
      },
    });
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('mail-status')).toHaveTextContent(/^Connected · the test letter arrived 2 min ago$/),
    );
  });

  it('an empty list offers the setup', async () => {
    routes['/mail/people'] = () => ({ people: [], next: null, storedKinds: ['vendor'] });
    mount();
    fireEvent.click(await screen.findByTestId('empty-setup'));
    expect(await screen.findByTestId('mail-setup')).toBeInTheDocument();
  });
});
