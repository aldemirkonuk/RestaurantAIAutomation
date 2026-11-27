/**
 * r107 mail-gap g3: the Mail list works from the keyboard like a mail client.
 * One Tab stop (roving tabindex), arrows and j/k move, Home/End jump, Enter
 * opens; `/` finds but never while typing; Escape in a person or a thread goes
 * back but never from a field or a dialog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { listMove, tabMove } from './mail-keys';

const SUMMARY = {
  waitingPeople: 1, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: 'a@b.c' },
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

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function mount(at = '/communications?tab=mail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
        <Where />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
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

const rows = async () => await screen.findAllByTestId('mail-person');

describe('the rules', () => {
  it('list moves clamp, tab moves wrap', () => {
    expect(listMove('ArrowDown', 0, 3)).toBe(1);
    expect(listMove('j', 2, 3)).toBe(2);
    expect(listMove('k', 0, 3)).toBe(0);
    expect(listMove('End', 0, 3)).toBe(2);
    expect(listMove('x', 0, 3)).toBeNull();
    expect(tabMove('ArrowRight', 1, 2)).toBe(0);
    expect(tabMove('ArrowLeft', 0, 2)).toBe(1);
  });
});

describe('the people list', () => {
  it('is one Tab stop; ArrowDown/ArrowUp, j/k, Home/End move focus across the rows and the stop follows', async () => {
    mount();
    const r = await rows();
    expect(r.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    r[0].focus();
    fireEvent.keyDown(r[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(r[1]);
    fireEvent.keyDown(r[1], { key: 'j' });
    expect(document.activeElement).toBe(r[2]);
    fireEvent.keyDown(r[2], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(r[2]);
    fireEvent.keyDown(r[2], { key: 'k' });
    expect(document.activeElement).toBe(r[1]);
    expect((await rows()).map((b) => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    fireEvent.keyDown(r[1], { key: 'Home' });
    expect(document.activeElement).toBe(r[0]);
    fireEvent.keyDown(r[0], { key: 'End' });
    expect(document.activeElement).toBe(r[2]);
  });

  it('Enter opens the focused row', async () => {
    mount();
    const r = await rows();
    r[1].focus();
    fireEvent.click(r[1]);
    expect(screen.getByTestId('where')).toHaveTextContent('with=vendor%3Ap2');
  });
});

describe('/ and Escape', () => {
  it('/ focuses the search box, but not while typing in it or with a modifier', async () => {
    mount();
    await rows();
    const search = screen.getByTestId('mail-search') as HTMLInputElement;
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search);
    // While typing: the key is the reader's, nothing is stolen or prevented.
    const typing = fireEvent.keyDown(search, { key: '/' });
    expect(typing).toBe(true);
    search.blur();
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    expect(document.activeElement).not.toBe(search);
  });

  it('Escape in a person goes back to everyone; in a thread goes back; not from a field or a dialog', async () => {
    mount('/communications?tab=mail&with=vendor%3Ap2&thread=gm%3Aabc');
    await screen.findByRole('heading', { name: 'Standing order' });
    const field = document.createElement('input');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.getByTestId('where')).toHaveTextContent('thread=gm%3Aabc');
    field.remove();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    const inside = document.createElement('button');
    dlg.appendChild(inside);
    document.body.appendChild(dlg);
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(screen.getByTestId('where')).toHaveTextContent('thread=gm%3Aabc');
    dlg.remove();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByTestId('where')).not.toHaveTextContent('thread=');
    expect(screen.getByTestId('where')).toHaveTextContent('with=vendor%3Ap2');
    await screen.findByTestId('mail-thread-row');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByTestId('where')).not.toHaveTextContent('with=');
  });
});
