/**
 * Mail's dates are the house's (r36 mail gap 13): rendered for real against a
 * stubbed gateway whose summary names the house's zone. The zone here is
 * UTC+14, which no test machine runs in, so a date read in the browser's own
 * zone (or UTC) lands on the day before and fails these checks. The words
 * themselves are proved in cm-format.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';

const ZONE = 'Pacific/Kiritimati';
// 12:00 UTC on 1 Jun 2025 is 02:00 on 2 Jun in the house's zone.
const AT = '2025-06-01T12:00:00Z';

let zone: string | null;

beforeEach(() => {
  zone = ZONE;
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.get.mockImplementation(async (url: string) => {
    const routes: Record<string, () => unknown> = {
      '/mail/summary': () => ({
        waitingPeople: 0,
        oldestWaitAt: null,
        inToday: 0,
        outToday: 0,
        zone: { zone, source: zone ? 'house' : 'none' },
        heldAtDoor: null,
        doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
        address: { configured: false, address: null },
      }),
      '/communications/letters/sender': () => ({ address: null, words: null }),
      '/mail/people': () => ({
        people: [
          { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Bodega', lastAt: AT, lastLine: 'Prices', lastDirection: 'inbound', waiting: false, waitingSince: null, openThreads: 0, channels: ['email'], newestOpenOrderId: null, newestOpenOrderNumber: null },
        ],
        next: null,
        storedKinds: ['vendor'],
      }),
      '/mail/threads': () => ({
        person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Bodega' },
        threads: [{ key: 'gm:a', subject: 'Prices', messageCount: 1, letterCount: 1, lastAt: AT, lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null }],
        next: null,
      }),
      '/mail/thread': () => ({
        key: 'gm:a',
        subject: 'Prices',
        person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Bodega' },
        order: null,
        messages: [
          { id: 'm1', direction: 'inbound', channel: 'email', text: 'Prices attached.', aiGenerated: false, status: 'DELIVERED', sentAt: null, receivedAt: AT, createdAt: AT, rawDeletedAt: null, door: 'house_mailbox', noReplyMarkedAt: '2025-06-01T13:00:00Z', attachments: [] },
        ],
        before: null,
      }),
    };
    const h = routes[url];
    if (!h) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    return { data: h() };
  });
});

function mount(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Mail's dates are the house's, and say their year", () => {
  it('a person row', async () => {
    mount('/communications?tab=mail');
    const row = await screen.findByTestId('mail-person');
    expect(await within(row).findByText('2 Jun 2025')).toBeInTheDocument();
  });

  it('a thread row', async () => {
    mount('/communications?tab=mail&with=vendor%3Ap1');
    const row = await screen.findByTestId('mail-thread-row');
    expect(await within(row).findByText('2 Jun 2025')).toBeInTheDocument();
  });

  it('a letter says its day and its time; its "no reply" mark says its day', async () => {
    mount('/communications?tab=mail&thread=gm%3Aa');
    const letter = await screen.findByTestId('mail-letter');
    expect(await within(letter).findByText('2 Jun 2025, 02:00')).toBeInTheDocument();
    expect(within(letter).getByTestId('letter-no-reply')).toHaveTextContent('Marked as needing no reply, 2 Jun 2025.');
  });

  it('with no house zone, the browser\'s day is used and the year is still said', async () => {
    zone = null;
    mount('/communications?tab=mail&thread=gm%3Aa');
    const letter = await screen.findByTestId('mail-letter');
    expect(within(letter).getByText(/^\d{1,2} Jun 2025, \d{2}:\d{2}$/)).toBeInTheDocument();
  });
});
