/**
 * The Mail tab shows every conversation, not only vendors: a kind filter, the
 * address each letter came from and went to, a waiting state while the letters
 * open, and the house's say-so to read everything. A gateway that predates any
 * of it degrades to what the tab always showed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
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
import { READ_ALL_CONSENT_TEXT, addressLine, kindEmptyWords, mailKindOf } from './mail-format';

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
let peopleFor: (p: Record<string, string>) => unknown[];

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
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const peopleCalls = () =>
  api.get.mock.calls.filter(([u]) => u === '/mail/people').map(([, c]) => (c as { params?: Record<string, string> })?.params ?? {});

beforeEach(() => {
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  sender = { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } };
  peopleFor = () => MIXED;
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender') return { data: sender };
    if (url === '/mail/people') return { data: { people: peopleFor(cfg?.params ?? {}), next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/thread')
      return {
        data: {
          key: 'gm:abc',
          subject: 'Friday',
          person: { key: 'team:t1', kind: 'team', providerId: 't1', name: 'Deniz Kaya' },
          order: null,
          messages: [
            letter({ id: 'a', fromAddress: 'deniz@example.com', toAddresses: ['house@example.com', 'ops@example.com'] }),
            letter({ id: 'b', text: 'Older gateway.' }),
          ],
          before: null,
        },
      };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('the kind filter', () => {
  it('lists every kind under All and narrows to one kind, asking the gateway for it', async () => {
    mount();
    expect(await screen.findAllByTestId('mail-person')).toHaveLength(3);
    peopleFor = (p) => (p.kind ? MIXED.filter((x) => x.key.startsWith(`${p.kind}:`)) : MIXED);
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    expect(screen.getByTestId('mail-person')).toHaveTextContent('Deniz Kaya');
    expect(within(screen.getByTestId('mail-person')).getByTestId('person-kind')).toHaveTextContent('team');
    expect(peopleCalls().some((p) => p.kind === 'team')).toBe(true);
    // The All read never carries a kind.
    expect(peopleCalls()[0].kind).toBeUndefined();
  });

  it('holds to the chosen kind even when the gateway answers with more', async () => {
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

  it('an empty Team list says the house reads vendor mail only, until it has said yes', async () => {
    peopleFor = (p) => (p.kind === 'team' ? [] : MIXED);
    mount();
    await screen.findAllByTestId('mail-person');
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    expect(await screen.findByTestId('people-empty-kind')).toHaveTextContent('reads vendor mail only');
    expect(kindEmptyWords('team', true)).toBe('No conversation with team members yet.');
    expect(kindEmptyWords('team', true)).not.toContain('vendor mail only');
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

describe('reading every conversation', () => {
  it('until it is accepted the tab says it shows vendor mail only and offers the wider read', async () => {
    mount();
    const scope = await screen.findByTestId('read-scope');
    expect(scope).toHaveTextContent('This tab shows vendor mail only.');
    expect(scope.getAttribute('data-state')).toBe('vendors');
    expect(screen.getByRole('button', { name: 'Read every conversation, not only vendors' })).toBeInTheDocument();
    expect(screen.queryByTestId('read-all-consent')).toBeNull();
  });

  it('shows the consent text in full, records acceptance, and then says it reads everything', async () => {
    api.post.mockImplementation(async () => {
      sender = { ...sender, reader: { ...(sender.reader as object), readAll: { accepted: true } } };
      return { data: {} };
    });
    mount();
    fireEvent.click(await screen.findByTestId('read-all-offer'));
    expect(screen.getByTestId('read-all-text').textContent).toBe(READ_ALL_CONSENT_TEXT);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('read-all-accept'));
    await waitFor(() => expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('all'));
    expect(api.post).toHaveBeenCalledWith('/mail/consent', { scope: 'gmail_read_all' });
    expect(screen.getByTestId('read-scope')).toHaveTextContent('every conversation in the mailbox');
  });

  it("uses the gateway's own consent wording when it sends one", async () => {
    sender = { ...sender, reader: { ...(sender.reader as object), readAll: { accepted: false, text: 'Version 2 wording.' } } };
    mount();
    fireEvent.click(await screen.findByTestId('read-all-offer'));
    expect(screen.getByTestId('read-all-text')).toHaveTextContent('Version 2 wording.');
  });

  it('a refused save says so and keeps saying vendor mail only', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } }));
    mount();
    fireEvent.click(await screen.findByTestId('read-all-offer'));
    fireEvent.click(screen.getByTestId('read-all-accept'));
    expect(await screen.findByTestId('read-all-failed')).toHaveTextContent('The tab still shows vendor mail only.');
    expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('vendors');
  });

  it('once accepted, an owner can stop it (DELETE)', async () => {
    sender = { ...sender, reader: { ...(sender.reader as object), readAll: { accepted: true } } };
    api.delete.mockResolvedValue({ data: {} });
    mount();
    fireEvent.click(await screen.findByTestId('read-all-stop'));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/mail/consent', { params: { scope: 'gmail_read_all' } }),
    );
  });

  it('staff are told what the tab reads and are offered no act', async () => {
    auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    mount();
    expect(await screen.findByTestId('read-scope')).toHaveTextContent('vendor mail only');
    expect(screen.queryByTestId('read-all-offer')).toBeNull();
  });

  it('a failed read of the reader never claims vendor mail only', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/communications/letters/sender') throw Object.assign(new Error('x'), { response: { status: 500 } });
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
