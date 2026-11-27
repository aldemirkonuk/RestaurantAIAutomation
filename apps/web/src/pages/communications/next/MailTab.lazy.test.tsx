/**
 * The Mail tab's heavy panels load as code when asked for, not with
 * /communications. The thread and the setup page are not imported until their
 * entry is clicked (or the pointer or focus reaches it), each waits behind a
 * static block of one fixed height, and under reduced motion that block carries
 * no animation (ADR 0112, MOTIONS.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

/**
 * The panels' code is fetched through `loaders`; the spec counts those fetches and
 * holds them at a gate, so the place held while code arrives can be seen.
 */
const gates = { setup: Promise.resolve(), thread: Promise.resolve() };
const hold = { setup: () => {}, thread: () => {} };
const calls = { setup: 0, thread: 0 };

import { MailTab } from './MailTab';
import { CODE_HOLD_PANEL_PX, loaders } from './mail-code';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};
const PERSON = {
  key: 'vendor:p1',
  kind: 'vendor',
  name: 'Bodega',
  lastLine: 'Line',
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderNumber: null,
};

function holdPanels() {
  gates.setup = new Promise<void>((r) => (hold.setup = r));
  gates.thread = new Promise<void>((r) => (hold.thread = r));
  vi.spyOn(loaders, 'setup').mockImplementation((() => {
    calls.setup += 1;
    return gates.setup.then(() => ({ MailSetup: () => <div data-testid="setup-loaded" /> }));
  }) as never);
  vi.spyOn(loaders, 'thread').mockImplementation((() => {
    calls.thread += 1;
    return gates.thread.then(() => ({ MailThread: () => <div data-testid="thread-loaded" /> }));
  }) as never);
}

function reduce(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

holdPanels();

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender')
      return { data: { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } } };
    if (url === '/integrations/oauth/house-grants') return { data: { success: true, grants: [], unattributed: 0 } };
    if (url === '/integrations/oauth/catalog') return { data: { success: true, integrations: [] } };
    if (url === '/mail/people') return { data: { people: [PERSON], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/threads')
      return {
        data: {
          person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' },
          threads: [{ key: 'gm:abc', subject: 'Friday', messageCount: 1, letterCount: 1, lastAt: '2026-11-06T09:00:00Z', lastDirection: 'inbound', waiting: false, orderId: null, orderNumber: null }],
          next: null,
        },
      };
    throw new Error(`unexpected GET ${url}`);
  });
});

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

/**
 * One walk, in order, because a loaded chunk stays loaded: the gate holds each
 * panel's code so its held place can be seen, and the counts say when each was
 * first asked for.
 */
describe('the Mail tab loads its panels as code when asked for', () => {
  it('has no static import of the panels', () => {
    const src = readFileSync(join(__dirname, 'MailTab.tsx'), 'utf8');
    expect(src).not.toMatch(/import\s+\{[^}]*\bMailSetup\b[^}]*\}\s+from\s+'\.\/MailSetup'/);
    expect(src).not.toMatch(/import\s+\{[^}]*\bMailThread\b[^}]*\}\s+from\s+'\.\/MailThread'/);
    const page = readFileSync(join(__dirname, 'CommunicationsNext.tsx'), 'utf8');
    expect(page).not.toMatch(/import\s+WhoIsWriting\s+from/);
  });

  it('asks for nothing at first, warms on pointer and focus, holds a fixed place, then shows the panel', async () => {
    reduce(true);
    mount();
    const row = await screen.findByTestId('mail-person');
    // Nothing is fetched with the tab.
    expect(calls.setup).toBe(0);
    expect(calls.thread).toBe(0);

    // The pointer on a person row starts the thread code and only that.
    fireEvent.pointerEnter(row);
    await waitFor(() => expect(calls.thread).toBe(1));
    expect(calls.setup).toBe(0);

    // Focus on the setup entry starts the setup code; the click that follows asks again for the same chunk.
    const link = screen.getByTestId('setup-link');
    fireEvent.focus(link);
    await waitFor(() => expect(calls.setup).toBe(1));
    fireEvent.click(link);
    const place = await screen.findByTestId('setup-opening');
    expect(place.style.minHeight).toBe(`${CODE_HOLD_PANEL_PX}px`);
    // Under reduced motion the held place carries no animation or transition, and nothing in it moves.
    expect(place.style.animation).toBe('none');
    expect(place.style.transition).toBe('none');
    expect(place.querySelector('*')).toBeNull();
    hold.setup();
    expect(await screen.findByTestId('setup-loaded')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-opening')).toBeNull();
  });

  it('a thread waits in a place as tall as the setup page, then the thread replaces it', async () => {
    reduce(true);
    mount('/communications?tab=mail&with=vendor%3Ap1&thread=gm%3Aabc');
    const place = await screen.findByTestId('letters-opening');
    expect(place.style.minHeight).toBe(`${CODE_HOLD_PANEL_PX}px`);
    expect(place.style.animation).toBe('none');
    hold.thread();
    expect(await screen.findByTestId('thread-loaded')).toBeInTheDocument();
  });
});
