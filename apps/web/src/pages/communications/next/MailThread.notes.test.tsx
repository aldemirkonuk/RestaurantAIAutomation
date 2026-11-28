/**
 * r110 mail-gap g5: the house's notes on a thread. Rendered for real (MailTab,
 * MailThread) against a stubbed gateway: notes sit in time order between the
 * letters on the paper-2 ground and say they were not sent; owners and
 * managers write, the writer deletes their own at once, staff read; a note
 * never reaches the composer; a new note fades in, and nothing moves under
 * reduced motion. The rules under it are in MailThreadNotes.test.tsx; the
 * routes in mail.thread-notes*.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import type { MailThreadNote } from './mail-format';

const base = {
  channel: 'email', aiGenerated: false, rawDeletedAt: null, automatic: false, noReplyMarkedAt: null, kind: 'vendor',
  fromAddress: 'v@x.com', toAddresses: ['orders@house.example'], attachments: [], mailbox: null, senderCheck: null, signedBy: null, delivery: null,
};
const inbound = { ...base, id: 'in1', direction: 'inbound', status: 'RECEIVED', text: 'Prices for December', sentAt: null, receivedAt: '2026-11-27T09:00:00Z', createdAt: '2026-11-27T09:00:00Z', door: 'house_mailbox' };
const outbound = { ...base, id: 'o1', direction: 'outbound', status: 'SENT', text: 'Six cases for Friday', sentAt: '2026-11-27T11:00:00Z', receivedAt: null, createdAt: '2026-11-27T11:00:00Z', door: 'from_house' };
const note = (id: string, at: string, over: Partial<MailThreadNote> = {}): MailThreadNote => ({
  id, body: `note ${id}`, createdAt: at, writtenBy: { id: 'u-ayse', name: 'Ayşe' }, mine: false, ...over,
});
const PERSON = { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Ali' };
const thread = vi.hoisted(() => ({ page: {} as Record<string, unknown> }));

function mount(at = '/communications?thread=gm%3At1&with=vendor%3Ap1') {
  const onAnswer = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} onAnswer={onAnswer} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onAnswer;
}

const reduce = (on: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });

beforeEach(() => {
  reduce(false);
  thread.page = {
    key: 'gm:t1', subject: 'Friday order', person: PERSON, order: null, messages: [inbound, outbound], before: null,
    waiting: false, attachmentsRead: true, heldMarksRead: true, notesRead: true,
    notes: [note('n1', '2026-11-27T10:00:00Z'), note('n2', '2026-11-27T12:00:00Z', { writtenBy: { id: 'u-x', name: null } })],
  };
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.post.mockImplementation(async () => ({ data: {} }));
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') return { data: thread.page };
    if (url === '/mail/summary')
      return { data: { waitingPeople: 0, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null, doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } }, address: { configured: false, address: null }, zone: { zone: 'Europe/Istanbul', source: 'house' } } };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/threads') return { data: { person: null, threads: [], next: null } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});
afterEach(() => reduce(false));

/** Letters and notes, top to bottom, as the reader sees them. */
const order = () =>
  [...document.querySelectorAll('[data-letter-id], [data-note-id]')].map(
    (el) => el.getAttribute('data-note-id') ?? el.getAttribute('data-letter-id'),
  );

describe('a note on a thread', () => {
  it('sits between the letters in time order, on paper-2, saying who wrote it and that it was not sent', async () => {
    mount();
    await screen.findAllByTestId('mail-note');
    expect(order()).toEqual(['in1', 'n1', 'o1', 'n2']);
    const [first, second] = screen.getAllByTestId('mail-note');
    expect(within(first!).getByTestId('mail-note-label')).toHaveTextContent('Note from Ayşe · not sent');
    expect(within(second!).getByTestId('mail-note-label')).toHaveTextContent('Note from someone in the house · not sent');
    expect(first!.style.background).toContain('--paper-2');
    // A note is not a letter.
    expect(first!.closest('[data-letter-id]')).toBeNull();
  });

  it('staff read the notes, write none, and delete none but their own', async () => {
    auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    (thread.page.notes as MailThreadNote[])[1] = note('n2', '2026-11-27T12:00:00Z', { mine: true });
    mount();
    const notes = await screen.findAllByTestId('mail-note');
    expect(notes).toHaveLength(2);
    expect(screen.queryByTestId('mail-note-writer')).toBeNull();
    expect(within(notes[0]!).queryByTestId('mail-note-delete')).toBeNull();
    expect(within(notes[1]!).getByTestId('mail-note-delete')).toBeInTheDocument();
  });

  it('an owner keeps a note under the thread and its person; it shows at once and fades in', async () => {
    const kept = note('n3', '2026-11-27T13:00:00Z', { body: 'Chase Friday', mine: true });
    // The thread read after the write is held, so what shows is the answer itself, at once.
    api.post.mockImplementation(async () => {
      api.get.mockImplementation(() => new Promise(() => {}));
      return { data: kept };
    });
    mount();
    const box = await screen.findByTestId('mail-note-body');
    expect(screen.getAllByTestId('mail-note').every((n) => !n.classList.contains('mail-note-in'))).toBe(true);
    fireEvent.change(box, { target: { value: '  Chase Friday  ' } });
    fireEvent.click(screen.getByTestId('mail-note-keep'));
    await waitFor(() => expect(order()).toContain('n3'));
    expect(api.post).toHaveBeenCalledWith('/mail/threads/gm%3At1/notes', { body: 'Chase Friday' }, { params: { with: 'vendor:p1' } });
    const added = document.querySelector('[data-note-id="n3"]')!;
    expect(added.className).toBe('mail-note-in');
    expect(order().at(-1)).toBe('n3');
    expect(box).toHaveValue('');
  });

  it('under reduced motion a new note does not animate', async () => {
    reduce(true);
    api.post.mockImplementation(async () => {
      api.get.mockImplementation(() => new Promise(() => {}));
      return { data: note('n3', '2026-11-27T13:00:00Z', { mine: true }) };
    });
    mount();
    fireEvent.change(await screen.findByTestId('mail-note-body'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('mail-note-keep'));
    await waitFor(() => expect(order()).toContain('n3'));
    expect(document.querySelector('[data-note-id="n3"]')!.className).toBe('');
  });

  it('a refused note says why in the gateway words, and the words typed stay', async () => {
    api.post.mockRejectedValue({ response: { status: 409, data: { message: 'This thread already holds 200 notes. Delete one before adding another.' } } });
    mount();
    const box = await screen.findByTestId('mail-note-body');
    fireEvent.change(box, { target: { value: 'one more' } });
    fireEvent.click(screen.getByTestId('mail-note-keep'));
    expect(await screen.findByTestId('mail-note-failed')).toHaveTextContent('This thread already holds 200 notes.');
    expect(box).toHaveValue('one more');
  });

  it('an empty note cannot be kept', async () => {
    mount();
    fireEvent.change(await screen.findByTestId('mail-note-body'), { target: { value: '   ' } });
    expect(screen.getByTestId('mail-note-keep')).toBeDisabled();
  });

  it('the writer deletes their own note at once, with no exit motion', async () => {
    (thread.page.notes as MailThreadNote[])[0] = note('n1', '2026-11-27T10:00:00Z', { mine: true });
    api.delete.mockImplementation(() => new Promise(() => {}));
    mount();
    const mine = (await screen.findAllByTestId('mail-note'))[0]!;
    act(() => {
      fireEvent.click(within(mine).getByTestId('mail-note-delete'));
    });
    await waitFor(() => expect(order()).toEqual(['in1', 'o1', 'n2']));
    expect(mine.isConnected).toBe(false);
    expect(api.delete).toHaveBeenCalledWith('/mail/threads/gm%3At1/notes/n1');
  });

  it('a failed delete puts the note back and says it is still there', async () => {
    (thread.page.notes as MailThreadNote[])[0] = note('n1', '2026-11-27T10:00:00Z', { mine: true });
    api.delete.mockRejectedValue({ response: { status: 503, data: { message: 'x' } } });
    mount();
    fireEvent.click(within((await screen.findAllByTestId('mail-note'))[0]!).getByTestId('mail-note-delete'));
    expect(await screen.findByTestId('mail-note-delete-failed')).toHaveTextContent('The note could not be deleted just now, so it is still there.');
    await waitFor(() => expect(order()).toEqual(['in1', 'n1', 'o1', 'n2']));
  });

  it('never reaches the composer: a reply answers the letters only', async () => {
    const onAnswer = mount();
    fireEvent.click(await screen.findByTestId('write-thread-reply'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onAnswer.mock.calls[0])).not.toContain('note n');
  });

  it('notes that could not be read are said to be unread, never none', async () => {
    thread.page = { ...thread.page, notes: [], notesRead: false };
    mount();
    expect(await screen.findByTestId('thread-notes-unread')).toHaveTextContent('could not be read just now');
  });

  it('a thread whose letters are gone shows its notes under the person', async () => {
    thread.page = { ...thread.page, subject: null, messages: [] };
    mount();
    expect((await screen.findAllByTestId('mail-note')).map((n) => n.getAttribute('data-note-id'))).toEqual(['n1', 'n2']);
    expect(screen.queryByTestId('thread-missing')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ali' })).toBeInTheDocument();
  });
});
