/**
 * The Mail tab wires its lists to the summary (r41 mail audit, gaps 4 and 5):
 * rendered for real against a stubbed gateway, a summary that answers the
 * same again reads no list, and one that names a new letter reads the people
 * again. The hook's own rules are in useMailData.follow.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
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
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: '2026-11-14T07:00:00Z' } },
  address: { configured: false, address: null },
};

const PERSON = {
  key: 'vendor:p1',
  kind: 'vendor',
  providerId: 'p1',
  name: 'Bodega',
  lastLine: 'Prices attached',
  lastAt: '2026-11-14T07:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  waitingSince: null,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
  newToYou: false,
};

let summary: typeof SUMMARY;
const gets = (url: string) => api.get.mock.calls.filter(([u]) => u === url).length;

beforeEach(() => {
  summary = SUMMARY;
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const routes: Record<string, () => unknown> = {
      '/mail/summary': () => summary,
      '/communications/letters/sender': () => ({ address: null, words: null }),
      '/mail/people': () => ({ people: [PERSON], next: null, storedKinds: ['vendor'] }),
    };
    const h = routes[url];
    if (!h) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    return { data: h() };
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
  return qc;
}

describe('the Mail tab reads its people again when the summary moves', () => {
  it('a summary that answers the same reads no list; a new letter reads the people once more', async () => {
    const qc = mount();
    await screen.findByText('Bodega');
    await waitFor(() => expect(gets('/mail/summary')).toBe(1));
    const peopleReads = gets('/mail/people');

    await act(async () => {
      await qc.refetchQueries({ queryKey: ['mail-summary', 'r1'] });
    });
    expect(gets('/mail/summary')).toBe(2);
    expect(gets('/mail/people')).toBe(peopleReads);

    summary = { ...SUMMARY, doors: { ...SUMMARY.doors, mudavymMail: { lastStoredAt: '2026-11-14T08:10:00Z' } } };
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['mail-summary', 'r1'] });
    });
    await waitFor(() => expect(gets('/mail/people')).toBe(peopleReads + 1));
  });
});
