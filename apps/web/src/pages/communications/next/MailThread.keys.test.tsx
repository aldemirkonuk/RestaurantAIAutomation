/**
 * r108 mail-r108-8: the thread works from the keyboard. `n` opens the next
 * thread waiting on the house (from the person's thread list the page holds,
 * wrapping), `r` writes a reply, Escape stays Back. Never while typing, in a
 * dialog, with a modifier or as the second key of `g` then a letter. No motion
 * of its own: the move is the page's cross-fade, and none is added.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const who = vi.hoisted(() => ({ role: 'manager' }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: who.role, restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: who.role }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { nextWaiting, threadKey } from './mail-keys';

const SUMMARY = {
  waitingPeople: 1, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: 'a@b.c' },
};
const person = (n: number) => ({
  key: `vendor:p${n}`, kind: 'vendor', name: `Vendor ${n}`, lastLine: `Line ${n}`, lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound', waiting: n === 1, channels: ['email'], openThreads: 1, newestOpenOrderNumber: null,
});
const PERSON = { key: 'vendor:p2', kind: 'vendor', name: 'Vendor 2', providerId: 'p2' };
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

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const onAnswer = vi.fn();
function mount(at = '/communications?tab=mail&with=vendor%3Ap2') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} onAnswer={onAnswer} />
        <Where />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const row = (key: string, subject: string, waiting: boolean) => ({
  key, subject, orderNumber: null, lastAt: '2026-11-06T09:00:00Z', lastDirection: 'inbound', messageCount: 1, waiting,
});
const THREADS = [row('gm:a', 'First', true), row('gm:b', 'Second', false), row('gm:c', 'Third', true)];

beforeEach(() => {
  who.role = 'manager';
  onAnswer.mockReset();
  api.get.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    const ok: Record<string, unknown> = {
      '/mail/summary': SUMMARY,
      '/communications/letters/sender': {
        address: 'a@b.c', words: null, conversation: { where: 'mudavym', words: 'x' },
        reader: { granted: true, enabled: true, lastReadAt: null, lastError: null },
      },
      '/mail/people': { people: [person(1), person(2)], next: null, storedKinds: ['vendor'] },
      '/mail/threads': { person: PERSON, threads: THREADS, next: null },
      '/mail/thread': { ...THREAD, key: cfg?.params?.key ?? 'gm:a' },
    };
    if (!(url in ok)) throw new Error(`unexpected GET ${url}`);
    return { data: ok[url] };
  });
});

async function openThread(name: string) {
  fireEvent.click(await screen.findByText(name));
  await screen.findByRole('heading', { level: 2 });
}
const at = () => screen.getByTestId('where').textContent ?? '';

describe('the rules', () => {
  it('n is next, r is reply, nothing else is ours', () => {
    expect(threadKey('n')).toBe('next');
    expect(threadKey('r')).toBe('reply');
    expect(threadKey('Escape')).toBeNull();
    expect(threadKey('j')).toBeNull();
  });
  it('the next waiting thread skips the open one and the quiet ones, and wraps', () => {
    expect(nextWaiting(THREADS, 'gm:a')).toBe('gm:c');
    expect(nextWaiting(THREADS, 'gm:c')).toBe('gm:a');
    expect(nextWaiting(THREADS, 'gm:b')).toBe('gm:c');
    expect(nextWaiting([row('gm:a', 'x', true), row('gm:b', 'y', false)], 'gm:a')).toBeNull();
    expect(nextWaiting([], 'gm:a')).toBeNull();
  });
});

describe('in a thread', () => {
  it('n opens the next waiting thread and wraps from the last', async () => {
    mount();
    await openThread('First');
    expect(at()).toContain('thread=gm%3Aa');
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(at()).toContain('thread=gm%3Ac');
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(at()).toContain('thread=gm%3Aa');
  });

  it('r writes a reply to the thread', async () => {
    mount();
    await openThread('First');
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  // ADR 0357 answer 3 (proposal F6): staff read mail, they do not write it.
  // `r` opens no composer for them, the same as the absent "Write a reply" act.
  it('r opens no composer for staff, who have no reply act', async () => {
    who.role = 'staff';
    mount();
    await openThread('First');
    expect(screen.queryByRole('button', { name: /write a reply/i })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('the keys are the reader\'s while typing, in a dialog, with a modifier, or after g', async () => {
    mount();
    await openThread('First');
    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'n' });
    fireEvent.keyDown(field, { key: 'r' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.appendChild(inner);
    document.body.appendChild(dialog);
    fireEvent.keyDown(inner, { key: 'n' });
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'r', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(at()).toContain('thread=gm%3Aa');
    expect(onAnswer).not.toHaveBeenCalled();
    field.remove();
    dialog.remove();
  });

  it('Escape still goes back, and the keys are not live in the list', async () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'n' });
    fireEvent.keyDown(document.body, { key: 'r' });
    await screen.findByText('First');
    expect(onAnswer).not.toHaveBeenCalled();
    await openThread('First');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(at()).not.toContain('thread=');
  });

  it('under reduced motion the keys still work and add no animation', async () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) as unknown as MediaQueryList,
    );
    try {
      mount();
      await openThread('First');
      fireEvent.keyDown(document.body, { key: 'n' });
      expect(at()).toContain('thread=gm%3Ac');
      expect(document.querySelector('[style*="animation"]')).toBeNull();
    } finally {
      mm.mockRestore();
    }
  });
});
