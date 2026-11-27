/**
 * The Mail tab shows every conversation, not only vendors: a kind filter, the
 * address each letter came from and went to, a waiting state while the letters
 * open, and the house's say-so to read everything. A gateway that predates any
 * of it degrades to what the tab always showed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const Here = () => {
  const l = useLocation();
  return <span data-testid="here">{l.pathname + l.search}</span>;
};

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({
  current: { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' } as Record<string, unknown>,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));
// The letters' code is held back until the test lets it through, so the waiting state can be seen.
const chunk = vi.hoisted(() => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  return { held, release: () => release() };
});
vi.mock('./MailThread', async (importOriginal) => {
  await chunk.held;
  return importOriginal();
});

import { MailTab } from './MailTab';
import { ARRIVED_ONLY, READ_ALL_OFFER_WORDS, addressLine, answerFor, kindEmptyWords, mailKindOf } from './mail-format';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};

const person = (id: string, kind: string | undefined, name: string) => ({
  key: `${kind ?? 'vendor'}:${id}`,
  ...(kind ? { kind } : {}),
  providerId: id,
  name,
  lastLine: `Line ${id}`,
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  waitingSince: null,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
});

const MIXED = [person('v1', 'vendor', 'Anadolu Fish'), person('t1', 'team', 'Deniz Kaya'), person('g1', 'guest', 'A. Guest')];

let sender: Record<string, unknown>;
/** What GET /integrations/oauth/house-grants answers, and whether the catalogue offers gmail_read_all. */
let grants: Array<Record<string, unknown>>;
let offered: boolean;
let peopleFor: (p: Record<string, string>) => unknown[];
/** Whether /mail/people says another page follows, and whether the thread's second letter is an auto-reply. */
let peopleNext: string | null = null;
let autoB = false;

const letter = (extra: Record<string, unknown>) => ({
  id: 'm1',
  direction: 'inbound',
  channel: 'email',
  text: 'Hello.',
  aiGenerated: false,
  status: null,
  sentAt: null,
  receivedAt: '2026-11-06T09:00:00Z',
  createdAt: '2026-11-06T09:00:00Z',
  rawDeletedAt: null,
  door: 'house_mailbox',
  ...extra,
});

function mount(at = '/communications?tab=mail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} onAnswer={vi.fn()} />
        <Here />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const peopleCalls = () =>
  api.get.mock.calls.filter(([u]) => u === '/mail/people').map(([, c]) => (c as { params?: Record<string, string> })?.params ?? {});

beforeEach(() => {
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  sender = { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } };
  grants = [];
  offered = true;
  peopleFor = () => MIXED;
  peopleNext = null;
  autoB = false;
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.put.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender') return { data: sender };
    if (url === '/integrations/oauth/house-grants') return { data: { success: true, grants, unattributed: 0 } };
    if (url === '/integrations/oauth/catalog')
      return { data: { success: true, integrations: [{ id: 'gmail_read_all', available: offered }, { id: 'gmail_read', available: true }] } };
    if (url === '/mail/people') return { data: { people: peopleFor(cfg?.params ?? {}), next: peopleNext, storedKinds: ['vendor'] } };
    if (url === '/mail/thread')
      return {
        data: {
          key: 'gm:abc',
          subject: 'Friday',
          person: { key: 'team:deniz@example.com', kind: 'team', providerId: null, name: 'deniz@example.com' },
          order: null,
          messages: [
            letter({ id: 'a', fromAddress: 'deniz@example.com', toAddresses: ['house@example.com', 'ops@example.com'] }),
            letter({ id: 'b', text: 'Older gateway.', ...(autoB ? { automatic: true } : {}) }),
          ],
          before: null,
        },
      };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('the kind filter', () => {
  it('lists every kind under All and narrows to one kind, asking the gateway for it (r103 mail-1)', async () => {
    mount();
    expect(await screen.findAllByTestId('mail-person')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    expect(screen.getByTestId('mail-person')).toHaveTextContent('Deniz Kaya');
    expect(within(screen.getByTestId('mail-person')).getByTestId('person-kind')).toHaveTextContent('team');
    // All sends no kind; a chip sends its own, so the page the gateway returns holds that kind only.
    expect(peopleCalls().some((p) => p.kind === 'team')).toBe(true);
    expect(peopleCalls().filter((p) => p.kind === undefined).length).toBeGreaterThan(0);
    expect(peopleCalls().every((p) => p.kind === undefined || p.kind === 'team')).toBe(true);
  });

  it('a chip with nobody found yet and more people to read says what was looked at, never "none"', async () => {
    // An older gateway ignores `kind`: the first page holds no team person, and a second page exists.
    peopleFor = () => [MIXED[0], MIXED[2]];
    peopleNext = 'cursor-2';
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    const line = await screen.findByTestId('people-partial-kind');
    expect(line).toHaveTextContent('Showing the people loaded so far');
    expect(screen.queryByTestId('people-empty-kind')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show older people' })).toBeInTheDocument();
  });

  it('holds to the chosen kind', async () => {
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Guests' }));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    expect(screen.getByTestId('mail-person')).toHaveTextContent('A. Guest');
  });

  it('a row with no kind is a vendor, so an older gateway still lists under Vendors', async () => {
    peopleFor = () => [person('v9', undefined, 'Old Vendor')];
    mount();
    await screen.findByText('Old Vendor');
    fireEvent.click(screen.getByRole('button', { name: 'Vendors' }));
    await waitFor(() => expect(screen.getByTestId('mail-person')).toHaveTextContent('Old Vendor'));
    expect(mailKindOf({})).toBe('vendor');
    expect(mailKindOf({ kind: 'something-new' })).toBe('vendor');
  });

  it('an empty Team list says the house reads vendor mail only, until the house reads every conversation', async () => {
    peopleFor = () => [MIXED[0]];
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    expect(await screen.findByTestId('people-empty-kind')).toHaveTextContent('reads vendor mail only');
    expect(kindEmptyWords('team', true)).toBe('No conversation with team members yet.');
    expect(kindEmptyWords('team', true)).not.toContain('vendor mail only');
  });

  it('once the house reads every conversation, an empty Team list no longer says vendor mail only', async () => {
    grants = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: false } }];
    peopleFor = () => [MIXED[0]];
    mount();
    await screen.findAllByTestId('mail-person');
    await waitFor(() => expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('all'));
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    expect(await screen.findByTestId('people-empty-kind')).toHaveTextContent('No conversation with team members yet.');
  });
});

describe('the kind filter while the next kind is read (r103 fixer)', () => {
  /** Hold the answer for one kind until the test lets it through. */
  function holdKind(kind: string) {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = peopleFor;
    peopleFor = (p) => base(p);
    const inner = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
      if (url === '/mail/people' && cfg?.params?.kind === kind) await gate;
      return inner(url, cfg);
    });
    return release;
  }

  it('while Team is read the list never claims there is nobody of that kind', async () => {
    peopleFor = (p) => (p.kind === 'vendor' ? [MIXED[0]] : p.kind === 'team' ? [MIXED[1]] : MIXED);
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Vendors' }));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    const release = holdKind('team');
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    await waitFor(() => expect(peopleCalls().some((p) => p.kind === 'team')).toBe(true));
    expect(screen.queryByTestId('people-empty-kind')).toBeNull();
    expect(screen.queryByTestId('people-partial-kind')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show older people' })).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId('mail-person')).toHaveTextContent('Deniz Kaya'));
  });

  it('a short kind list does not overwrite the remembered first-page count', async () => {
    window.sessionStorage.clear();
    peopleFor = (p) => (p.kind === 'team' ? [MIXED[1]] : MIXED);
    mount();
    await screen.findAllByTestId('mail-person');
    await waitFor(() => expect(window.sessionStorage.getItem('mail-people-rows:r1')).toBe('3'));
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    expect(window.sessionStorage.getItem('mail-people-rows:r1')).toBe('3');
  });

  it('staff are not told the house reads vendor mail only; they are told who sees team and guest mail', async () => {
    auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    grants = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: false } }];
    peopleFor = () => [MIXED[0]];
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    const line = await screen.findByTestId('people-empty-kind');
    expect(line).not.toHaveTextContent('vendor mail only');
    expect(line).toHaveTextContent('Mail with team members and guests is shown to the owner and managers.');
  });

  it('an empty Team list under Waiting says only vendors wait, not that no conversation exists', () => {
    expect(kindEmptyWords('team', true, { canReply: true, waitingOnly: true })).toBe(
      'No team member is waiting on the house: only vendors wait.',
    );
    expect(kindEmptyWords('guest', true, { canReply: true, waitingOnly: true })).toContain('only vendors wait');
    expect(kindEmptyWords('team', true, { canReply: true, waitingOnly: false })).toBe('No conversation with team members yet.');
  });
});

describe('the letters', () => {
  it('shows a waiting state while the letters are fetched', async () => {
    mount('/communications?tab=mail&thread=gm%3Aabc');
    expect(screen.getByTestId('letters-opening')).toHaveTextContent('Opening the letters');
    chunk.release();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('letters-opening')).toBeNull();
  });

  it('an automatic letter says it is automatic, and a person\'s letter says nothing of the kind (r103 mail-6)', async () => {
    autoB = true;
    mount('/communications?tab=mail&thread=gm%3Aabc');
    chunk.release();
    const all = await screen.findAllByTestId('mail-letter');
    expect(all).toHaveLength(2);
    expect(within(all[1]).getByTestId('letter-automatic')).toHaveTextContent('Automatic mail');
    expect(within(all[0]).queryByTestId('letter-automatic')).toBeNull();
  });

  it('each says where it came from and went to; a letter without them says nothing', async () => {
    mount('/communications?tab=mail&thread=gm%3Aabc');
    const letters = await screen.findAllByTestId('mail-letter');
    expect(within(letters[0]).getByTestId('letter-addresses')).toHaveTextContent(
      'From deniz@example.com to house@example.com, ops@example.com',
    );
    expect(within(letters[1]).queryByTestId('letter-addresses')).toBeNull();
    expect(addressLine({ fromAddress: 'a@x.com' })).toBe('From a@x.com');
    expect(addressLine({ toAddresses: ['b@x.com'] })).toBe('To b@x.com');
    expect(addressLine({ fromAddress: ' ', toAddresses: [] })).toBeNull();
  });
});

describe('a thread with a team member', () => {
  it('says who it is with, and offers a reply to the address that wrote (ADR 0396)', async () => {
    mount('/communications?tab=mail&thread=gm%3Aabc');
    await screen.findAllByTestId('mail-letter');
    expect(screen.getByTestId('thread-kind')).toHaveTextContent('team');
    expect(screen.getByTestId('thread-arrived-only')).toHaveTextContent(ARRIVED_ONLY);
    expect(screen.getByTestId('write-thread-reply')).toBeInTheDocument();
  });

  it('answerFor answers a guest at the address that wrote, with no vendor (ADR 0396)', () => {
    const head = { subject: 'Rota', person: { key: 'guest:a@b.co', kind: 'guest' as const, providerId: null, name: 'A Guest' } };
    const got = answerFor(head, [letter({ id: 'a' }) as never]);
    expect(got).toMatchObject({ providerId: null, answers: 'a', person: { kind: 'guest', address: 'a@b.co', name: 'A Guest' } });
  });

  it('answerFor offers nothing when only the house has written to a person', () => {
    const head = { subject: 'Rota', person: { key: 'guest:a@b.co', kind: 'guest' as const, providerId: null, name: 'a@b.co' } };
    expect(answerFor(head, [letter({ id: 'a', direction: 'outbound', sentAt: '2026-01-01T00:00:00Z' }) as never])).toBeNull();
    expect(answerFor(head, [letter({ id: 'b', automatic: true }) as never])).toBeNull();
  });
});

describe('reading every conversation', () => {
  it('until a grant is in use the tab says it shows vendor mail only and offers the wider read', async () => {
    mount();
    const scope = await screen.findByTestId('read-scope');
    expect(scope).toHaveTextContent('This tab shows vendor mail only.');
    expect(scope.getAttribute('data-state')).toBe('vendors');
    expect(await screen.findByRole('button', { name: 'Read every conversation, not only vendors' })).toBeInTheDocument();
    expect(screen.queryByTestId('read-all-consent')).toBeNull();
  });

  it('the offer sends the person to the consent screen for gmail_read_all and sends nothing itself', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('read-all-offer'));
    expect(screen.getByTestId('read-all-text').textContent).toBe(READ_ALL_OFFER_WORDS);
    fireEvent.click(screen.getByTestId('read-all-accept'));
    expect(screen.getByTestId('here')).toHaveTextContent(
      `/authorize/gmail_read_all?returnPath=${encodeURIComponent('/communications?tab=mail')}`,
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('a house that has a live gmail_read_all grant is told it reads everything', async () => {
    grants = [
      { connectionId: 'c0', integrationId: 'gmail_read', houseAccess: { revoked: false } },
      { connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: false } },
    ];
    mount();
    await waitFor(() => expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('all'));
    expect(screen.getByTestId('read-scope')).toHaveTextContent('the letters that arrived in the mailbox');
  });

  it('a grant the house has stopped using does not count', async () => {
    grants = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: true } }];
    mount();
    const scope = await screen.findByTestId('read-scope');
    expect(scope.getAttribute('data-state')).toBe('vendors');
  });

  it('offers nothing when the catalogue does not offer the grant', async () => {
    offered = false;
    mount();
    await screen.findByTestId('read-scope');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/integrations/oauth/catalog'));
    expect(screen.queryByTestId('read-all-offer')).toBeNull();
  });

  it('an owner can stop the house reading: the grant is kept, the house stops using it', async () => {
    grants = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: false } }];
    api.put.mockImplementation(async () => {
      grants = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: true } }];
      return { data: {} };
    });
    mount();
    fireEvent.click(await screen.findByTestId('read-all-stop'));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/integrations/oauth/house-grants/c1/access', { houseUses: false }),
    );
    await waitFor(() => expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('vendors'));
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('a refused stop says so and keeps saying it reads every conversation', async () => {
    grants = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: false } }];
    api.put.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } }));
    mount();
    fireEvent.click(await screen.findByTestId('read-all-stop'));
    expect(await screen.findByTestId('read-all-failed')).toHaveTextContent('The tab still reads every conversation.');
    expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('all');
  });

  it('staff are told what the tab reads, are offered no act, and the owner-only grants are never asked for', async () => {
    auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    mount();
    expect(await screen.findByTestId('read-scope')).toHaveTextContent('vendor mail only');
    expect(screen.queryByTestId('read-all-offer')).toBeNull();
    expect(api.get.mock.calls.some(([u]) => u === '/integrations/oauth/house-grants')).toBe(false);
  });

  it('a failed read of the grants never claims vendor mail only', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/integrations/oauth/house-grants') throw Object.assign(new Error('x'), { response: { status: 500 } });
      if (url === '/communications/letters/sender') return { data: sender };
      if (url === '/mail/summary') return { data: SUMMARY };
      if (url === '/mail/people') return { data: { people: MIXED, next: null, storedKinds: [] } };
      throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    });
    mount();
    const scope = await screen.findByTestId('read-scope');
    expect(scope).toHaveTextContent('could not be read');
    expect(scope.textContent).not.toContain('vendor mail only.');
  });
});
