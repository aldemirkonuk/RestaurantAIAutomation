/**
 * r109 mail-gap g2: a half-written reply stays on its own thread. Rendered for
 * real (MailTab, MailThread, the Stub) against a stubbed gateway, with the
 * page's held replies (useReplyHolds) read from this tab's storage, as after
 * a tear and a reload. The page's half (a tear holds under the thread, Resume
 * opens the held words, a queued send lets go) is in CommunicationsNext.test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { ReplyHoldsContext, useReplyHolds, writeReplyHold } from './held-words';
import type { HeldLetter } from './Compose/ComposeSheet';
import type { MailAnswer } from './mail-format';

const KEY = 'mail-reply:u1:r1:gm:t1';
const ANSWER: MailAnswer = { providerId: 'p1', answers: 'v1', subject: 'Re: Friday order' };
const WORDS: HeldLetter = { to: null, subject: 'Re: Friday order', body: 'Six cases, and the Rioja.', insights: [], templateId: '', answers: 'v1' };

const THREAD = {
  key: 'gm:t1',
  subject: 'Friday order',
  person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega Álvaro', providerId: 'p1' },
  order: null,
  messages: [
    {
      id: 'v1', direction: 'inbound', channel: 'email', text: 'Friday works.', aiGenerated: false, status: 'RECEIVED',
      sentAt: null, receivedAt: '2026-11-06T09:00:00Z', createdAt: '2026-11-06T09:00:00Z', rawDeletedAt: null,
      door: 'house_mailbox', automatic: false, noReplyMarkedAt: null,
    },
  ],
  before: null,
  waiting: true,
};
const PERSON = {
  key: 'vendor:p1', kind: 'vendor', name: 'Bodega Álvaro', providerId: 'p1', lastAt: '2026-11-06T09:00:00Z',
  snippet: 'Friday works.', waiting: true, openThreads: 1, channels: ['email'], newestOpenOrderNumber: null,
  unsentStatus: null, newToYou: false,
};

function Page({ children }: { children: ReactNode }) {
  const replies = useReplyHolds<HeldLetter, MailAnswer>('u1', 'r1');
  return <ReplyHoldsContext.Provider value={replies}>{children}</ReplyHoldsContext.Provider>;
}

function mount(at: string, onAnswer = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <Page>
          <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} onAnswer={onAnswer} />
        </Page>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onAnswer;
}

beforeEach(() => {
  window.sessionStorage.clear();
  auth.current = { user: { userId: 'u1', role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') return { data: THREAD };
    if (url === '/mail/summary') return { data: { waitingPeople: 1, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null, doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } }, address: { configured: false, address: null } } };
    if (url === '/mail/people') return { data: { people: [PERSON], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/threads') return { data: { person: null, threads: [], next: null } };
    if (url === '/communications/letters/sender')
      return { data: { address: 'siparis@mail.mudavym.com', words: null, conversation: { where: 'mudavym', words: '' }, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

const held = () => writeReplyHold('u1', 'r1', 'gm:t1', { words: WORDS, answer: ANSWER, personKey: 'vendor:p1', at: Date.now() });

describe('a held reply stays on its thread', () => {
  it('the thread draws the Stub above its acts, quoting the words, kept in this tab', async () => {
    held();
    mount('/communications?thread=gm%3At1');
    const stub = await screen.findByText(/Six cases, and the Rioja\./);
    const card = stub.closest('.mdv-stub') as HTMLElement;
    expect(within(card).getByText('Not sent. Kept in this tab.')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/until you leave/);
    // Above the acts: the Stub comes before "Write a reply" in the page.
    const write = screen.getByTestId('write-thread-reply');
    expect(card.compareDocumentPosition(write) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Resume and "Write a reply" both open the reply named by its thread and person', async () => {
    held();
    const onAnswer = mount('/communications?thread=gm%3At1');
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(onAnswer).toHaveBeenLastCalledWith(ANSWER, { threadKey: 'gm:t1', personKey: 'vendor:p1' });
    fireEvent.click(screen.getByTestId('write-thread-reply'));
    expect(onAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ answers: 'v1' }), { threadKey: 'gm:t1', personKey: 'vendor:p1' });
  });

  it('Discard lets the words go from the tab; Put it back keeps them again', async () => {
    held();
    mount('/communications?thread=gm%3At1');
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }));
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
    expect(await screen.findByText(/Six cases, and the Rioja\./)).toBeInTheDocument();
  });

  it('staff see no held reply, since they write none', async () => {
    held();
    auth.current = { user: { userId: 'u1', role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    mount('/communications?thread=gm%3At1');
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByText(/Six cases, and the Rioja\./)).toBeNull();
  });

  it('a thread with nothing held draws no Stub', async () => {
    mount('/communications?thread=gm%3At1');
    await screen.findByTestId('write-thread-reply');
    expect(document.querySelector('.mdv-stub')).toBeNull();
  });
});

describe('the person row says Draft', () => {
  it('after the name, while a reply to them is held', async () => {
    held();
    mount('/communications?tab=mail');
    const row = await screen.findByTestId('mail-person');
    await waitFor(() => expect(within(row).getByTestId('mail-person-draft')).toHaveTextContent('Draft'));
    const name = within(row).getByText('Bodega Álvaro');
    expect(name.compareDocumentPosition(within(row).getByTestId('mail-person-draft')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('not when nothing is held', async () => {
    mount('/communications?tab=mail');
    const row = await screen.findByTestId('mail-person');
    expect(within(row).queryByTestId('mail-person-draft')).toBeNull();
  });
});
