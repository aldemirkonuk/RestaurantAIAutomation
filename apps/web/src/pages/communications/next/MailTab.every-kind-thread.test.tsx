/**
 * A team or guest person's thread opens (r81 w1): the thread read names the
 * person it was opened from, because the gateway reads a non-vendor thread by
 * (kind, address) and an unnamed key is an empty page ("This thread is not in
 * this house's mail" for a letter that is in the book). The threads header
 * names the person's own kind, not "vendor" for everyone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
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
const TEAM = { key: 'team:manager@x.test', kind: 'team', providerId: null, name: 'manager@x.test' };

function mount(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender')
      return { data: { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } } };
    if (url === '/integrations/oauth/house-grants') return { data: { success: true, grants: [], unattributed: 0 } };
    if (url === '/integrations/oauth/catalog') return { data: { success: true, integrations: [] } };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: ['vendor', 'team'] } };
    if (url === '/mail/threads')
      return {
        data: {
          person: TEAM,
          threads: [{ key: 'mid:team-1', subject: 'Friday cover', messageCount: 1, letterCount: 1, lastAt: '2026-11-06T09:00:00Z', lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null }],
          next: null,
        },
      };
    if (url === '/mail/thread') {
      // The real gateway: a team thread without its person is an empty page.
      const empty = cfg?.params?.with !== TEAM.key;
      return {
        data: {
          key: 'mid:team-1',
          subject: 'Friday cover',
          person: empty ? null : TEAM,
          order: null,
          messages: empty
            ? []
            : [{ id: 'a', direction: 'inbound', channel: 'email', text: 'Can you cover?', aiGenerated: false, status: null, sentAt: null, receivedAt: '2026-11-06T09:00:00Z', createdAt: '2026-11-06T09:00:00Z', rawDeletedAt: null, door: 'house_mailbox', fromAddress: 'manager@x.test', toAddresses: ['house@x.test'] }],
          before: null,
        },
      };
    }
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('a team person from the list', () => {
  it('names its own kind over the threads, not vendor', async () => {
    mount('/communications?tab=mail&with=team%3Amanager%40x.test');
    expect(await screen.findByText('manager@x.test')).toBeTruthy();
    const head = screen.getByRole('heading', { level: 2 });
    expect(head.textContent).toMatch(/team/);
    expect(head.textContent).not.toMatch(/vendor/);
  });

  it('opens a thread with the person named, so the letter is found', async () => {
    mount('/communications?tab=mail&with=team%3Amanager%40x.test&thread=mid%3Ateam-1');
    expect(await screen.findByText('Can you cover?')).toBeTruthy();
    await waitFor(() => {
      const calls = api.get.mock.calls.filter(([u]) => u === '/mail/thread');
      expect(calls.length).toBeGreaterThan(0);
      for (const [, c] of calls) expect((c as { params: Record<string, string> }).params.with).toBe('team:manager@x.test');
    });
  });

  it('a thread opened without a person still asks as before', async () => {
    mount('/communications?tab=mail&thread=gm%3Aabc');
    await waitFor(() => expect(api.get.mock.calls.some(([u]) => u === '/mail/thread')).toBe(true));
    for (const [, c] of api.get.mock.calls.filter(([u]) => u === '/mail/thread'))
      expect((c as { params: Record<string, string> }).params).toEqual({ key: 'gm:abc' });
  });
});
