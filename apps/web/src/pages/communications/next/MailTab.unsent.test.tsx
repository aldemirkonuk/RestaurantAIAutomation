/**
 * A person's row says when the newest letter to them has not left (r43 w3
 * finding 4: the gateway carried unsentStatus and nothing drew it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
import { unsentChipText } from './mail-format';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};

const person = (n: number, extra: Record<string, unknown>) => ({
  key: `vendor:p${n}`,
  kind: 'vendor',
  providerId: `p${n}`,
  name: `Vendor ${n}`,
  lastLine: `Line ${n}`,
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  waitingSince: null,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
  ...extra,
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

beforeEach(() => {
  auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const routes: Record<string, () => unknown> = {
      '/mail/summary': () => SUMMARY,
      '/communications/letters/sender': () => ({ address: null, words: null }),
      '/mail/people': () => ({
        people: [
          person(1, { unsentStatus: 'HOUSE_QUEUED' }),
          person(2, { unsentStatus: 'SEND_REFUSED' }),
          person(3, { unsentStatus: 'HOUSE_CANCELLED' }),
          person(4, { unsentStatus: null }),
          person(5, {}),
          person(6, { unsentStatus: 'SENT' }),
        ],
        next: null,
        storedKinds: ['vendor'],
      }),
    };
    const h = routes[url];
    if (!h) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    return { data: h() };
  });
});

describe('a person whose newest letter has not left says so on the row', () => {
  it('queued, refused and pulled back are each worded; none, absent and a sent status draw nothing', async () => {
    mount();
    const rows = await screen.findAllByTestId('mail-person');
    expect(rows).toHaveLength(6);
    const chip = (r: HTMLElement) => within(r).queryByTestId('mail-unsent')?.textContent ?? null;
    expect(rows.map(chip)).toEqual(['Queued · not sent yet', 'Not sent', 'Pulled back · not sent', null, null, null]);
  });
});

describe('unsentChipText', () => {
  it('never claims a letter went', () => {
    expect(unsentChipText('DELIVERED')).toBeNull();
    expect(unsentChipText('')).toBeNull();
    expect(unsentChipText('HOUSE_FAILED')).toBe('Not sent');
    expect(unsentChipText('SEND_UNCONFIRMED')).toBe('Sent? Not confirmed');
  });
});
