/**
 * The Mail tab's thread and intake sheet (founder /goal 2026-11-07; proposal
 * Phase C, L9 narrowed), rendered for real against a stubbed gateway: the
 * address is the state (`?thread=`), the reply act is an owner's or a
 * manager's, a door with no record of its reads cannot tell, and nothing says
 * a score or a percentage. The list is proved in MailTab.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
let routes: Routes;
function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function mount(at = '/communications?tab=mail', props: Partial<Parameters<typeof MailTab>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenReply = vi.fn();
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={onOpenReply} {...props} />
        <Where />
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
    // Until the gateway serves the intake record, the route is simply not there.
    '/communications/letters/intake': () => {
      throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    },
  };
  api.post.mockReset();
  api.get.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    const h = routes[url];
    if (!h) throw new Error(`unexpected GET ${url}`);
    return { data: h(cfg?.params ?? {}) };
  });
});

const calls = (url: string) =>
  api.get.mock.calls.filter(([u]) => u === url).map(([, cfg]) => (cfg as { params?: Record<string, string> })?.params ?? {});

describe('a thread', () => {
  // Spec (a): the thread key in the address is the key the gateway is asked for.
  it('?thread=gm%3Aabc asks /mail/thread for key gm:abc', async () => {
    mount('/communications?thread=gm%3Aabc');
    await screen.findByText('Standing order');
    expect(calls('/mail/thread')[0]).toEqual({ key: 'gm:abc' });
  });

  it('letters run oldest to newest, each with its provenance in words', async () => {
    mount('/communications?thread=gm%3Aabc');
    const letters = await screen.findAllByTestId('mail-letter');
    expect(letters.map((l) => l.getAttribute('data-testid'))).toHaveLength(5);
    expect(letters[0]).toHaveTextContent('First, from the vendor.');
    expect(within(letters[0]).getByTestId('letter-provenance')).toHaveTextContent('arrived in your mailbox');
    expect(within(letters[1]).getByTestId('letter-chip')).toHaveTextContent('Draft · not sent');
    expect(within(letters[1]).getByTestId('letter-provenance')).toHaveTextContent('not sent · written by Mudavym');
    expect(within(letters[4]).getByTestId('letter-provenance')).toHaveTextContent(
      "arrived at Mudavym's mailbox or your Mudavym address",
    );
    expect(within(letters[4]).getByTestId('letter-removed')).toHaveTextContent(
      'Original removed on 2 Oct 2026; the facts stay.',
    );
    expect(screen.getByRole('link', { name: 'order PO-014' })).toHaveAttribute('href', '/orders/o1');
  });

  it('only a queued house letter carries the pull-back (COMMS-W23)', async () => {
    mount('/communications?thread=gm%3Aabc');
    await screen.findAllByTestId('mail-letter');
    expect(screen.getAllByTestId('pull-back').map((b) => b.getAttribute('data-id'))).toEqual(['m3']);
  });

  it("says why a letter was held or refused, from the book's facts, never the rule code (ADR 0099, COMMS-W22)", async () => {
    const said = "gateway refused the send: HTTP 403 — Conversation m4 is not one of this house's conversations.";
    mount('/communications?thread=gm%3Aabc', {
      bookFacts: new Map([
        ['m2', { relayRefusalReason: null, constraintFlags: { hard: ['C-20', 'C-21', 'C-99'] } }],
        ['m4', { relayRefusalReason: said, constraintFlags: null }],
      ]),
    });
    await screen.findAllByTestId('mail-letter');
    expect(screen.getByTestId('letter-held')).toHaveTextContent(
      'Held because its tone is heated, it holds personal details, and a rule this page has no words for yet.',
    );
    expect(screen.queryByText(/C-2[01]|C-99/)).toBeNull();
    const refused = screen.getByTestId('letter-refused');
    expect(refused).toHaveTextContent(`Not sent — it was refused on the way out: ${said}`);
    expect(refused.style.overflowWrap).toBe('anywhere');
  });

  it('a refused letter outside the book says the reason could not be read, not that none exists', async () => {
    mount('/communications?thread=gm%3Aabc');
    expect(await screen.findByTestId('letter-refused')).toHaveTextContent(
      'Not sent — it was refused on the way out: the reason could not be read with this thread.',
    );
  });

  it('"Show earlier letters" asks for the page before, and puts it first', async () => {
    routes['/mail/thread'] = (p) =>
      p.before === 'B1'
        ? { ...THREAD, messages: [letter({ id: 'm0', text: 'The very first letter.' })], before: null }
        : { ...THREAD, before: 'B1' };
    mount('/communications?thread=gm%3Aabc');
    await screen.findAllByTestId('mail-letter');
    fireEvent.click(screen.getByRole('button', { name: 'Show earlier letters' }));
    await waitFor(() => expect(screen.getAllByTestId('mail-letter')).toHaveLength(6));
    expect(calls('/mail/thread').some((p) => p.before === 'B1' && p.key === 'gm:abc')).toBe(true);
    expect(screen.getAllByTestId('mail-letter')[0]).toHaveTextContent('The very first letter.');
    expect(screen.getByText('This is the first letter of the thread.')).toBeInTheDocument();
  });

  it('Back returns to the list and drops the thread from the address', async () => {
    mount('/communications?tab=mail&thread=gm%3Aabc');
    fireEvent.click(await screen.findByRole('button', { name: /Back to everyone/ }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/communications\?tab=mail$/);
  });

  it('an owner or manager sees "Open the drafted reply" when the order has one, and it opens it', async () => {
    const { onOpenReply } = mount('/communications?thread=gm%3Aabc', { draftedOrderIds: new Set(['o1']) });
    fireEvent.click(await screen.findByTestId('open-thread-reply'));
    expect(onOpenReply).toHaveBeenCalledWith('o1');
  });

  it('no reply act when the order has no drafted reply', async () => {
    mount('/communications?thread=gm%3Aabc', { draftedOrderIds: new Set(['o9']) });
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByText('Open the drafted reply')).toBeNull();
  });

  // Spec (d): staff, and a role that could not be read, see no composer act.
  it.each([
    ['staff', { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' }],
    ['an unknown role', { user: { restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: null }],
  ])('%s sees no "Open the drafted reply"', async (_who, a) => {
    auth.current = a;
    mount('/communications?thread=gm%3Aabc', { draftedOrderIds: new Set(['o1']) });
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByText('Open the drafted reply')).toBeNull();
  });

  // r28 gap 3: a thread with a vendor can be answered by hand.
  const VENDOR_THREAD = () => ({
    ...THREAD,
    person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Bodega Álvaro' },
    messages: [...THREAD.messages, letter({ id: 'm6', direction: 'inbound', door: 'house_mailbox', receivedAt: '2026-11-07T09:00:00Z', sentAt: null })],
  });

  it('an owner or manager can write a reply to the newest letter, beside the drafted one', async () => {
    routes['/mail/thread'] = VENDOR_THREAD;
    const onAnswer = vi.fn();
    const { onOpenReply } = mount('/communications?thread=gm%3Aabc', { draftedOrderIds: new Set(['o1']), onAnswer });
    fireEvent.click(await screen.findByTestId('write-thread-reply'));
    expect(onAnswer).toHaveBeenCalledWith({ providerId: 'p1', answers: 'm6', subject: 'Re: Standing order' });
    expect(onOpenReply).not.toHaveBeenCalled();
    expect(screen.getByTestId('open-thread-reply')).toHaveTextContent('Open the drafted reply');
  });

  it('a thread with no vendor offers no reply to write', async () => {
    const onAnswer = vi.fn();
    mount('/communications?thread=gm%3Aabc', { onAnswer });
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('write-thread-reply')).toBeNull();
  });

  it.each([
    ['staff', { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' }],
    ['an unknown role', { user: { restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: null }],
  ])('%s sees no "Write a reply"', async (_who, a) => {
    auth.current = a;
    routes['/mail/thread'] = VENDOR_THREAD;
    mount('/communications?thread=gm%3Aabc', { onAnswer: vi.fn() });
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('write-thread-reply')).toBeNull();
  });

  it('a thread that is not this house\'s says so', async () => {
    routes['/mail/thread'] = () => ({ key: 'gm:zzz', subject: null, person: null, order: null, messages: [], before: null });
    mount('/communications?thread=gm%3Azzz');
    expect(await screen.findByTestId('thread-missing')).toHaveTextContent("This thread is not in this house's mail.");
  });
});

describe('the intake sheet', () => {
  const open = async () => {
    fireEvent.click(await screen.findByTestId('intake-line'));
    return screen.findByTestId('door-house-mailbox');
  };

  // Spec (e): a way in with no durable record of its reads says "cannot tell".
  it('a way in with no record of its reads cannot tell; never "reading"', async () => {
    mount();
    await open();
    for (const id of ['door-mudavym', 'door-whatsapp']) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-state', 'cannot_tell');
      expect(screen.getByTestId(`${id}-status`)).toHaveTextContent('Cannot tell: when this was last checked is not recorded yet.');
    }
    // The house mailbox has no recorded read in this fixture, so it cannot tell either.
    expect(screen.getByTestId('door-house-mailbox')).toHaveAttribute('data-state', 'cannot_tell');
    // QA round 26, #977: an address and an unread mailbox prove nothing, so
    // the line is not "Connected"; it keeps the old letter's time. The setup
    // read is not served here, so whether a test letter came is not known:
    // "no letter stored yet".
    expect(screen.getByTestId('mail-status')).toHaveTextContent(
      'Address made, no letter stored yet · the last letter came to your mailbox 1 h ago · no read of your mailbox is recorded yet',
    );
    expect(screen.getByTestId('held-at-door')).toHaveTextContent(/^Letters held before reaching the house: — not recorded yet\.$/);
    expect(screen.getByTestId('sender-address')).toHaveTextContent('Letters leave from siparis@mail.mudavym.com.');
  });

  const INTAKE_OK = (over: Record<string, unknown> = {}, shared: unknown = null) => ({
    intake: { byStatus: {}, waiting: 0, oldestWaitingAt: null, unknown: false, ...over },
    sharedMailbox: shared,
  });

  it('a record of zero says none, and offers no Read again', async () => {
    routes['/communications/letters/intake'] = () =>
      INTAKE_OK({}, { lastReadAt: new Date(Date.now() - 5 * 60_000).toISOString(), lastStoredAt: null, errored: false });
    mount();
    await open();
    await waitFor(() =>
      expect(screen.getByTestId('held-at-door')).toHaveTextContent(/^Letters held before reaching the house: none\.$/),
    );
    expect(screen.getByTestId('door-mudavym')).toHaveAttribute('data-state', 'reading');
    expect(screen.getByTestId('door-mudavym-status')).toHaveTextContent("Mudavym's mailbox is read every few minutes.");
    expect(screen.queryByTestId('read-again')).toBeNull();
  });

  it('letters waiting, one stopped: counts them and Read again offers them once more', async () => {
    routes['/communications/letters/intake'] = () =>
      INTAKE_OK({ waiting: 3, oldestWaitingAt: new Date(Date.now() - 2 * 86_400_000 - 60_000).toISOString(), byStatus: { gave_up: 1, failed: 2 } });
    api.post.mockResolvedValue({ data: { queued: 3 } });
    mount();
    await open();
    await waitFor(() =>
      expect(screen.getByTestId('held-at-door')).toHaveTextContent(
        '3 waiting for a home, the oldest for 2 days; 1 stopped after six tries and waits for \u201CRead again\u201D.',
      ),
    );
    fireEvent.click(await screen.findByTestId('read-again'));
    expect(await screen.findByTestId('read-again-result')).toHaveTextContent('Offered again: 3.');
    expect(api.post).toHaveBeenCalledWith('/communications/letters/intake/read-again');
  });

  it('a Read again that fails says it was not done', async () => {
    routes['/communications/letters/intake'] = () => INTAKE_OK({ waiting: 1, byStatus: { failed: 1 } });
    api.post.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500, data: { message: 'The queue is down' } } }));
    mount();
    await open();
    fireEvent.click(await screen.findByTestId('read-again'));
    expect(await screen.findByTestId('read-again-result')).toHaveTextContent('Reading again was not saved (The queue is down).');
  });

  it('an intake record that fails to read is not "none"', async () => {
    routes['/communications/letters/intake'] = () => {
      throw Object.assign(new Error('Server Error'), { response: { status: 500 } });
    };
    mount();
    await open();
    await waitFor(() =>
      expect(screen.getByTestId('held-at-door')).toHaveTextContent(
        'could not be read — that is not the same as none.',
      ),
    );
    expect(screen.getByTestId('door-mudavym')).toHaveAttribute('data-state', 'cannot_tell');
    expect(screen.getByTestId('door-mudavym-status')).toHaveTextContent("Cannot tell: the mailbox's record could not be read.");
    expect(screen.queryByTestId('read-again')).toBeNull();
  });

  it('the house mailbox reads as reading only on a recent recorded read', async () => {
    routes['/communications/letters/sender'] = () => ({
      ...SENDER,
      reader: { granted: true, enabled: true, lastReadAt: new Date(Date.now() - 2 * 60_000).toISOString(), lastError: null },
    });
    mount();
    await open();
    expect(screen.getByTestId('door-house-mailbox')).toHaveAttribute('data-state', 'reading');
    expect(screen.getByTestId('door-mudavym')).toHaveAttribute('data-state', 'cannot_tell');
  });

  it('the Mudavym address can be copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mount();
    await open();
    const addr = screen.getByTestId('mudavym-address');
    expect(addr).toHaveTextContent('bodega@in.mudavym.com');
    fireEvent.click(within(addr).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('bodega@in.mudavym.com'));
    expect(await within(addr).findByText('Copied.')).toBeInTheDocument();
  });

  // Spec (i): no inbound domain means no address, said in words, nothing to copy.
  it('an address with configured: false says so and offers no copy', async () => {
    routes['/mail/summary'] = () => ({ ...SUMMARY, address: { configured: false, address: null } });
    mount();
    await open();
    const addr = screen.getByTestId('mudavym-address');
    expect(addr).toHaveTextContent(
      'No Mudavym address yet: Mudavym cannot receive mail for houses yet, so there is no address to give vendors.',
    );
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  // QA round 16, M11: a failed copy says so; it never says "Copied."
  it('a copy that fails says so and never says "Copied."', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.assign(navigator, { clipboard: { writeText } });
    mount();
    await open();
    const addr = screen.getByTestId('mudavym-address');
    fireEvent.click(within(addr).getByRole('button', { name: 'Copy' }));
    expect(await within(addr).findByText('It could not be copied; select it and copy it by hand.')).toBeInTheDocument();
    expect(within(addr).queryByText('Copied.')).toBeNull();
  });

  // QA round 16, M13: which address letters leave from is never invented.
  it('a failed sender read says it could not be read, and names no address', async () => {
    routes['/communications/letters/sender'] = () => {
      throw Object.assign(new Error('Request failed with status code 503'), { isAxiosError: true, response: { status: 503 } });
    };
    mount();
    await open();
    await waitFor(() =>
      expect(screen.getByTestId('sender-address')).toHaveTextContent(/^Which address letters leave from could not be read\.$/),
    );
    expect(screen.getByTestId('sender-address').textContent).not.toMatch(/leave from \S+@|your mailbox/);
  });

  it('an unknown sender says it could not be read, even with server words', async () => {
    routes['/communications/letters/sender'] = () => ({ ...SENDER, kind: 'unknown', address: null, words: 'Letters leave from your mailbox.' });
    mount();
    await open();
    await waitFor(() =>
      expect(screen.getByTestId('sender-address')).toHaveTextContent(/^Which address letters leave from could not be read\.$/),
    );
  });

  // QA round 16, finding 3: no "door", no "inbound domain", no raw error anywhere on the sheet.
  it('the sheet carries no jargon and no raw error', async () => {
    routes['/communications/letters/sender'] = () => ({
      ...SENDER,
      reader: { ...SENDER.reader, lastError: 'HTTP 401 from gmail.googleapis.com/users/me/history' },
    });
    routes['/mail/summary'] = () => ({ ...SUMMARY, address: { configured: false, address: null } });
    mount();
    await open();
    await waitFor(() => expect(screen.getByTestId('door-house-mailbox')).toHaveAttribute('data-state', 'failing'));
    // Text node by text node, so a heading cannot hide by running into its neighbour.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode.textContent ?? '');
    expect(texts.join(' ')).not.toMatch(/\bdoors?\b|inbound|HTTP|googleapis|invalid_grant|\b401\b/i);
  });
});

// QA round 16, M4: a failed thread read says so; it never reads "Reading…" forever.
describe('a thread that could not be read', () => {
  it('says it could not be read, and that it is not empty', async () => {
    routes['/mail/thread'] = () => {
      throw Object.assign(new Error('Request failed with status code 503'), {
        isAxiosError: true,
        response: { status: 503, data: { message: 'The mail could not be read.' } },
      });
    };
    mount('/communications?tab=mail&thread=gm%3Aabc');
    expect(await screen.findByTestId('thread-unread')).toHaveTextContent(
      'This thread could not be read (The mail could not be read). That does not mean it is empty.',
    );
    expect(screen.queryByText('Reading the thread…')).toBeNull();
  });
});

// Spec (f): the Mail tab carries no percentage, score or confidence (ADR 0104).
describe('no confidence numbers', () => {
  // Everything on screen but the test's own address probe (which prints `%3A`).
  const shown = () => {
    const where = screen.getByTestId('where').textContent ?? '';
    return (document.body.textContent ?? '').replace(where, '');
  };
  it('neither the list nor the sheet says %, score or confidence', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByTestId('intake-line'));
    await screen.findByTestId('door-house-mailbox');
    expect(shown()).not.toMatch(/%|score|confidence/i);
  });
  it('a thread does not say %, score or confidence', async () => {
    mount('/communications?thread=gm%3Aabc');
    await screen.findAllByTestId('mail-letter');
    expect(shown()).not.toMatch(/%|score|confidence/i);
  });
});
