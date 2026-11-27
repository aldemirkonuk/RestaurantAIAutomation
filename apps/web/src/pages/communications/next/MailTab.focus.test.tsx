/**
 * r107 mail-gap g2: opening and leaving a view keeps the reader's place.
 * Opening a person or a thread puts the page at its top at once and focuses the
 * heading; going back restores the scroll and focuses the row that was opened;
 * the arriving view fades in by opacity once, and the stylesheet zeroes that
 * under reduced motion. The first draw does not fade.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { MAIL_MOTION_CSS } from './mail-motion';

const SUMMARY = {
  waitingPeople: 1,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: 'bodega@in.mudavym.com' },
};
const person = (n: number) => ({
  key: `vendor:p${n}`, kind: 'vendor', name: `Vendor ${n}`, lastLine: `Line ${n}`, lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound', waiting: n === 1, channels: ['email'], openThreads: 1, newestOpenOrderNumber: null,
});
const PERSON = { key: 'vendor:p2', kind: 'vendor', name: 'Vendor 2' };
const THREAD = {
  key: 'gm:abc', subject: 'Standing order', person: PERSON, order: null,
  messages: [
    {
      id: 'm1', direction: 'inbound', channel: 'email', text: 'Six cases.', aiGenerated: false, status: 'DRAFT',
      sentAt: null, receivedAt: '2026-11-01T09:00:00Z', createdAt: '2026-11-01T09:00:00Z', rawDeletedAt: null, door: 'house_mailbox',
    },
  ],
  before: null,
};

const scrollTo = vi.mocked(window.scrollTo);

function mount(at = '/communications?tab=mail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  scrollTo.mockClear();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  const ok: Record<string, unknown> = {
    '/mail/summary': SUMMARY,
    '/communications/letters/sender': {
      address: 'a@b.c', words: null, conversation: { where: 'mudavym', words: 'x' },
      reader: { granted: true, enabled: true, lastReadAt: null, lastError: null },
    },
    '/mail/people': { people: [person(1), person(2), person(3)], next: null, storedKinds: ['vendor'] },
    '/mail/threads': {
      person: PERSON,
      threads: [{ key: 'gm:abc', subject: 'Standing order', orderNumber: null, lastAt: '2026-11-06T09:00:00Z', lastDirection: 'inbound', messageCount: 1, waiting: false }],
      next: null,
    },
    '/mail/thread': THREAD,
  };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (!(url in ok)) throw new Error(`unexpected GET ${url}`);
    return { data: ok[url] };
  });
});

const rowOf = async (name: string) => (await screen.findByRole('button', { name: new RegExp(name) })) as HTMLElement;

describe('keeping the place', () => {
  it('opening a person goes to the top at once and focuses the name; Back restores the scroll and focuses that row', async () => {
    mount();
    const row = await rowOf('Vendor 2');
    scrollTo.mockClear();
    (window as { scrollY: number }).scrollY = 640;
    row.focus();
    fireEvent.click(row);
    const heading = await screen.findByRole('heading', { name: /Vendor 2/ });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveAttribute('tabindex', '-1');

    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Everyone/ }));
    const back = await rowOf('Vendor 2');
    expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'auto' });
    expect(document.activeElement).toBe(back);
  });

  it('opening a thread goes to the top and focuses its subject; Back to their threads focuses that thread row', async () => {
    mount('/communications?tab=mail&with=vendor%3Ap2');
    const row = await screen.findByTestId('mail-thread-row');
    (window as { scrollY: number }).scrollY = 300;
    fireEvent.click(row);
    const heading = await screen.findByRole('heading', { name: 'Standing order' });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(document.activeElement).toBe(heading);
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Back to their threads/ }));
    const again = await screen.findByTestId('mail-thread-row');
    expect(scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'auto' });
    expect(document.activeElement).toBe(again);
  });

  it('a view that arrives fades in once; the first draw does not; reduced motion zeroes it', async () => {
    mount();
    const row = await rowOf('Vendor 1');
    expect(document.querySelector('[data-testid="mail-tab"] > div.mail-fade-in')).toBeNull();
    fireEvent.click(row);
    await screen.findByRole('heading', { name: /Vendor 2|Bodega|Vendor/ });
    expect(document.querySelectorAll('[data-testid="mail-tab"] > div.mail-fade-in')).toHaveLength(1);
    expect(MAIL_MOTION_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mail-fade-in[\s\S]*animation: none/);
    // Opacity only: no slide, no height.
    expect(MAIL_MOTION_CSS).toMatch(/@keyframes mail-fade-in \{ from \{ opacity: 0 \} to \{ opacity: 1 \} \}/);
  });

  it('focus is not pulled back when the reader has moved on to something outside the view', async () => {
    mount();
    const row = await rowOf('Vendor 2');
    fireEvent.click(row);
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    await screen.findByRole('heading', { name: /Vendor 2/ });
    await act(async () => {});
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
