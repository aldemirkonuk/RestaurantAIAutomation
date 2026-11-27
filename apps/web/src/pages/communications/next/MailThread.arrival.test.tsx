/**
 * r108 mail g11: a letter that arrives while a thread is open, below the
 * fold, says so ("1 new letter below") and the act jumps to it, instantly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailThread } from './MailThread';
import type { MailMessage } from './mail-format';

const L = (i: number, over: Partial<MailMessage> = {}): MailMessage => ({
  id: `m${i}`,
  direction: 'inbound',
  channel: 'email',
  text: `Letter number ${i}`,
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: `2026-11-0${i}T09:00:00Z`,
  createdAt: `2026-11-0${i}T09:00:00Z`,
  rawDeletedAt: null,
  door: 'house_mailbox',
  automatic: false,
  noReplyMarkedAt: null,
  ...over,
});

let messages: MailMessage[];
let observers: Array<{ el: Element | null; cb: (e: Array<{ isIntersecting: boolean }>) => void; disconnected: boolean }>;
let qc: QueryClient;
const scrolls: Array<unknown> = [];

function mount(reduced = false) {
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  api.get.mockImplementation(async (url: string) =>
    url === '/mail/thread'
      ? { data: { key: 'gm:t1', subject: 'Friday', person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' }, order: null, messages, before: null, waiting: true } }
      : { data: {} },
  );
  api.post.mockResolvedValue({ data: {} });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MailThread threadKey="gm:t1" onBack={vi.fn()} backLabel="Back" onOpenPerson={vi.fn()} canReply draftedOrderIds={new Set()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const arrive = async (next: MailMessage[]) => {
  messages = next;
  await act(async () => {
    await qc.invalidateQueries();
  });
};
const live = () => observers.filter((o) => !o.disconnected && o.el);

beforeEach(() => {
  messages = [L(1), L(2)];
  observers = [];
  scrolls.length = 0;
  api.get.mockReset();
  api.post.mockReset();
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    rec = { el: null as Element | null, cb: null as never, disconnected: false };
    constructor(cb: never) {
      this.rec.cb = cb;
      observers.push(this.rec);
    }
    observe(el: Element) {
      this.rec.el = el;
    }
    disconnect() {
      this.rec.disconnected = true;
    }
    unobserve() {}
  };
  Element.prototype.scrollIntoView = function (this: HTMLElement, arg?: unknown) {
    scrolls.push([this.getAttribute('data-letter-id'), arg]);
  } as never;
});
afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe('a new letter below', () => {
  it('says nothing on the first read, then names one letter that arrives off screen', async () => {
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('new-letter-below')).toBeNull();
    await arrive([L(1), L(2), L(3)]);
    expect(await screen.findByTestId('new-letter-below')).toHaveTextContent('1 new letter below');
    expect(screen.getByTestId('new-letter-below')).toHaveStyle({ minHeight: '44px' });
    expect(screen.getByTestId('new-letter-live')).toHaveTextContent('A new letter from Bodega');
    expect(screen.getByTestId('new-letter-live')).toHaveAttribute('aria-live', 'polite');
  });

  it('counts several', async () => {
    mount();
    await screen.findAllByTestId('mail-letter');
    await arrive([L(1), L(2), L(3), L(4)]);
    expect(await screen.findByTestId('new-letter-below')).toHaveTextContent('2 new letters below');
  });

  it('shows no pill for a letter already in view', async () => {
    mount();
    await screen.findAllByTestId('mail-letter');
    await arrive([L(1), L(2), L(3)]);
    await screen.findByTestId('new-letter-below');
    act(() => live().at(-1)!.cb([{ isIntersecting: true }]));
    expect(screen.queryByTestId('new-letter-below')).toBeNull();
  });

  it('never counts the house\'s own letter, or earlier letters read by paging', async () => {
    mount();
    await screen.findAllByTestId('mail-letter');
    await arrive([L(1), L(2), L(3, { direction: 'outbound', status: 'SENT', sentAt: '2026-11-03T09:00:00Z', receivedAt: null, door: 'from_house' })]);
    await waitFor(() => expect(screen.getAllByTestId('mail-letter')).toHaveLength(3));
    expect(screen.queryByTestId('new-letter-below')).toBeNull();
  });

  it('click jumps to the letter with an instant scroll, focuses it and goes', async () => {
    mount();
    await screen.findAllByTestId('mail-letter');
    await arrive([L(1), L(2), L(3)]);
    fireEvent.click(await screen.findByTestId('new-letter-below'));
    expect(scrolls).toEqual([['m3', { block: 'nearest', behavior: 'auto' }]]);
    expect(document.activeElement).toBe(document.querySelector('[data-letter-id="m3"]'));
    expect(screen.queryByTestId('new-letter-below')).toBeNull();
  });

  it('fades in by opacity, and under reduced motion draws no animation class', async () => {
    mount();
    await screen.findAllByTestId('mail-letter');
    await arrive([L(1), L(2), L(3)]);
    expect((await screen.findByTestId('new-letter-below')).className).toContain('mail-fade-in');
  });

  it('reduced motion: no animation class', async () => {
    mount(true);
    await screen.findAllByTestId('mail-letter');
    await arrive([L(1), L(2), L(3)]);
    expect((await screen.findByTestId('new-letter-below')).className).not.toContain('mail-fade-in');
  });
});
