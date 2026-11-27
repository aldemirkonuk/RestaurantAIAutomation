/**
 * r108 mail g9: a long thread folds its earlier letters so the one that needs
 * the house is on screen. Rendered for real against a stubbed gateway.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailThread } from './MailThread';
import { openLettersOf, type MailMessage } from './mail-format';

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
const OUT = (i: number, over: Partial<MailMessage> = {}) =>
  L(i, { direction: 'outbound', status: 'SENT', sentAt: `2026-11-0${i}T09:00:00Z`, receivedAt: null, door: 'from_house', ...over });

// Oldest to newest: m1..m6. m6 (newest) is a vendor letter that waits.
const SIX = [L(1), OUT(2), L(3), OUT(4), OUT(5), L(6)];

function mount(messages: MailMessage[], waiting = true, reduced = false) {
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') {
      return { data: { key: 'gm:t1', subject: 'Friday', person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' }, order: null, messages, before: null, waiting } };
    }
    return { data: {} };
  });
  api.post.mockResolvedValue({ data: {} });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MailThread threadKey="gm:t1" onBack={vi.fn()} backLabel="Back" onOpenPerson={vi.fn()} canReply draftedOrderIds={new Set()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('openLettersOf', () => {
  it('opens everything under four letters', () => {
    expect([...openLettersOf([L(1), L(2), L(3)], { waiting: false })]).toEqual(['m1', 'm2', 'm3']);
  });
  it('keeps the newest, the waiting, the chipped outbound and the newest marked open', () => {
    const letters = [L(1, { noReplyMarkedAt: '2026-11-01T10:00:00Z' }), L(2), OUT(3, { status: 'HOUSE_QUEUED' }), OUT(4), L(5), L(6)];
    const open = openLettersOf(letters, { waiting: true });
    expect([...open].sort()).toEqual(['m1', 'm3', 'm5', 'm6']);
    expect(open.has('m2')).toBe(false); // answered by m3 and m4
    expect(open.has('m4')).toBe(false); // sent, no chip
  });
  it('opens nothing waiting when the thread does not wait', () => {
    const open = openLettersOf([L(1), OUT(2), OUT(3), OUT(4)], { waiting: false });
    expect([...open]).toEqual(['m4']);
  });
});

describe('a long thread folds', () => {
  it('opens the newest, folds the run into one stack that unfolds in place with focus on the first revealed letter', async () => {
    mount(SIX);
    expect(await screen.findAllByTestId('mail-letter')).toHaveLength(1); // m6 is newest and waits; m1 and m3 were answered
    expect(screen.getAllByTestId('mail-letter').map((e) => e.getAttribute('data-letter-id'))).toEqual(['m6']);
    const stack = screen.getByTestId('mail-letter-stack');
    expect(stack).toHaveTextContent('5 earlier letters');
    expect(stack.querySelector('button')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(within(stack).getByRole('button'));
    expect(screen.queryByTestId('mail-letter-stack')).toBeNull();
    expect(screen.getAllByTestId('mail-letter')).toHaveLength(6);
    // The letter itself, not its name span: a reader hears the whole letter that was revealed.
    expect(document.activeElement).toBe(document.querySelector('[data-letter-id="m1"]'));
  });

  it('folds a run of two to single 44 px rows that say name, when and the first 90 characters', async () => {
    const long = 'x'.repeat(120);
    mount([L(1, { text: long }), OUT(2, { status: 'HOUSE_QUEUED' }), L(3), L(4), OUT(5, { status: 'HOUSE_QUEUED' }), L(6)], false);
    const rows = await screen.findAllByTestId('mail-letter-folded');
    expect(rows).toHaveLength(3); // m1 alone; m3 and m4 are a run of two, still single rows
    expect(screen.queryByTestId('mail-letter-stack')).toBeNull();
    const btn = within(rows[0]!).getByRole('button');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveStyle({ height: '44px' });
    expect(btn.textContent).toContain('x'.repeat(90));
    expect(btn.textContent).not.toContain('x'.repeat(91));
    fireEvent.click(btn);
    expect(screen.queryAllByTestId('mail-letter-folded').length).toBe(rows.length - 1);
  });

  it('does not fold a three-letter thread', async () => {
    mount([L(1), OUT(2), L(3)]);
    expect(await screen.findAllByTestId('mail-letter')).toHaveLength(3);
    expect(screen.queryByTestId('mail-letter-stack')).toBeNull();
  });

  it('fades an unfolded letter in, and under reduced motion draws no animation class', async () => {
    mount(SIX);
    fireEvent.click(within(await screen.findByTestId('mail-letter-stack')).getByRole('button'));
    expect(document.querySelector('[data-letter-id="m2"]')!.className).toContain('mail-fade-in');
    expect(document.querySelector('[data-letter-id="m6"]')!.className).not.toContain('mail-fade-in');
  });

  it('under reduced motion an unfolded letter carries no animation class', async () => {
    mount(SIX, true, true);
    fireEvent.click(within(await screen.findByTestId('mail-letter-stack')).getByRole('button'));
    expect(document.querySelector('[data-letter-id="m2"]')!.className).not.toContain('mail-fade-in');
  });

  it('opens at the heading, not scrolled', async () => {
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    mount(SIX);
    await screen.findAllByTestId('mail-letter');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('a letter that was open stays open when a newer one arrives', () => {
  it('keeps the house\'s own reply open under the vendor letter that arrives after it', async () => {
    let live: MailMessage[] = [L(1), OUT(2), L(3), OUT(4), OUT(5), OUT(6)];
    let waiting = false;
    api.get.mockImplementation(async (url: string) =>
      url === '/mail/thread'
        ? { data: { key: 'gm:t1', subject: 'Friday', person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' }, order: null, messages: live, before: null, waiting } }
        : { data: {} },
    );
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <MailThread threadKey="gm:t1" onBack={vi.fn()} backLabel="Back" onOpenPerson={vi.fn()} canReply draftedOrderIds={new Set()} onOpenReply={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // m6 is the newest, so it is the one letter drawn open.
    expect((await screen.findAllByTestId('mail-letter')).map((e) => e.getAttribute('data-letter-id'))).toEqual(['m6']);
    live = [...live, L(7)];
    waiting = true;
    await act(async () => {
      await qc.invalidateQueries();
    });
    await waitFor(() => expect(document.querySelector('[data-letter-id="m7"]')).not.toBeNull());
    expect(screen.getAllByTestId('mail-letter').map((e) => e.getAttribute('data-letter-id'))).toEqual(['m6', 'm7']);
    expect(screen.getByTestId('mail-letter-stack')).toHaveTextContent('5 earlier letters');
  });
});
