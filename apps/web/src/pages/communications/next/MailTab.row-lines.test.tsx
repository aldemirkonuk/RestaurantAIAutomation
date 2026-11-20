/** The person row keeps three things on line one (r102 mail-critic-4); the rest is a quiet line two. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';

const SUMMARY = {
  waitingPeople: 0, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: 'bodega@in.mudavym.com' },
};
const person = (n: number) => ({
  key: `vendor:p${n}`, kind: 'vendor', name: `Vendor ${n}`, lastLine: `Line ${n}`, lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound', waiting: true, channels: ['email'], openThreads: 2, newestOpenOrderNumber: 'PO-7',
  newToYou: true, unsentStatus: 'queued',
});

beforeEach(() => {
  api.get.mockReset();
});

describe('the people list', () => {
  it('a row with several facts keeps three things on line one, and the rest on a quiet line two', async () => {
    api.get.mockImplementation(async (url: string) => {
      const data = url === '/mail/summary' ? SUMMARY : url === '/mail/people' ? { people: [person(1)], next: null, storedKinds: ['vendor'] } : null;
      if (!data) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
      return { data };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/communications?tab=mail']}>
        <QueryClientProvider client={qc}>
          <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const row = await screen.findByTestId('mail-person');
    const lineOne = row.children[0] as HTMLElement;
    const facts = within(row).getByTestId('person-facts');
    expect(row.children[1]).toBe(facts);
    // line one: waiting dot, New dot, name, time; nothing else
    expect(within(lineOne).getByRole('img', { name: /waiting on/ })).toBeTruthy();
    expect(within(lineOne).getByText('Vendor 1')).toBeTruthy();
    expect(within(lineOne).queryByTestId('person-kind')).toBeNull();
    expect(within(lineOne).queryByText(/order PO-7/)).toBeNull();
    expect(within(lineOne).queryByTestId('mail-unsent')).toBeNull();
    // line two: kind, order, open threads, unsent
    expect(within(facts).getByTestId('person-kind')).toHaveTextContent('vendor');
    expect(within(facts).getByText('order PO-7')).toBeTruthy();
    expect(within(facts).getByText('2 open threads')).toBeTruthy();
    expect(within(facts).getByTestId('mail-unsent')).toBeTruthy();
    // New is a 6px dot that still says "New" to a reader
    const dot = within(lineOne).getByTestId('new-to-you');
    expect(dot.style.width).toBe('6px');
    expect(dot).toHaveTextContent('New');
    // the type floor: chips 11px, meta 12px
    expect((within(facts).getByText('order PO-7') as HTMLElement).style.fontSize).toBe('11px');
    expect((within(facts).getByTestId('mail-unsent') as HTMLElement).style.fontSize).toBe('11px');
    expect(row.style.minHeight).toBe('60px');
  });

});
