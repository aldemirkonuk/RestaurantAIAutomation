/**
 * An empty Mail list whose mailbox and address reads are still in flight does not
 * word them as failed (r41 mail gap 6); a read that failed still says so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({
  current: { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' } as Record<
    string,
    unknown
  >,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
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

let senderRead: () => Promise<unknown>;

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

const never = () => new Promise<unknown>(() => {});

beforeEach(() => {
  auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/summary') return senderRead().then(() => ({ data: SUMMARY }));
    if (url === '/communications/letters/sender') return senderRead().then(() => ({ data: { address: null, words: null } }));
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('the empty list while the reads are still in flight', () => {
  it('says it is still reading, never that the reads could not be made', async () => {
    senderRead = never;
    mount();
    const empty = await screen.findByTestId('people-empty');
    expect(empty.textContent).toContain('is still being read');
    expect(empty.textContent).not.toContain('could not be read');
  });

  it('says the reads failed when they did', async () => {
    senderRead = () => Promise.reject(Object.assign(new Error('boom'), { response: { status: 503 } }));
    mount();
    await waitFor(() => expect(screen.getByTestId('people-empty').textContent).toContain('could not be read'));
    expect(screen.getByTestId('people-empty').textContent).not.toContain('is still being read');
  });
});
