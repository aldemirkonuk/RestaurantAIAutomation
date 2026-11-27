/**
 * The newer-in-thread notice (r110 mail-gap g2). A reply carries what its
 * thread showed; a 409 NEWER_IN_THREAD says who wrote and when, with "Send
 * mine as well" (acknowledged) and "Read it first" (the words are held, the
 * page brings the letter into view). Opacity only, 160 ms, in reserved space.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
  useLetterSenderStanding: () => ({ restaurantId: 'r1', canRelease: true, noMailbox: false, basis: 'owner', checking: false, checkedAt: 0, recheck: () => {} }),
}));
vi.mock('../../../../services/api/client', () => ({ apiClient: { post: mockPost, get: vi.fn() } }));

import { ComposeSheet } from './ComposeSheet';
import { fmtClock } from './compose-format';
import { NEWER_CSS, newerFrom, newerLine } from './newer-in-thread';
import { answerFor } from '../mail-format';

const SEEN = { id: 'a-1', createdAt: '2026-11-27T14:00:00.000Z' };
const AYSE = { id: 'n-1', who: 'Ayşe', at: '2026-11-27T14:05:00.000Z', direction: 'outbound', status: 'SENT', firstLine: 'Thursday works.' };
const AGAIN = { id: 'n-2', who: null, at: '2026-11-27T14:07:00.000Z', direction: 'inbound', status: 'RECEIVED', firstLine: 'Friday?' };
const conflict = (items: unknown[]) => Object.assign(new Error('409'), { response: { status: 409, data: { code: 'NEWER_IN_THREAD', message: 'Someone wrote.', items } } });

const data = {
  restaurantId: 'r1',
  sender: {
    kind: 'house_mailbox', address: 'owner@house.test', sendable: true, ceremony: 'undo', undoMs: 120000, words: '', missing: [], categories: [], dispatcher: null,
    sendOrAsk: { readable: true, maySend: true, mode: 'send', basis: 'owner', grant: null, sentence: null },
  },
  senderFailed: false, senderError: null,
  book: [{ providerId: 'p1', providerName: 'Fikri Tarım Gıda', contactName: null, email: 'fikri@fikritarim.com', source: 'provider' }],
  bookFailed: false, bookError: null, byProvider: new Map(), templates: [], templatesFailed: false, templatesError: null,
  insights: [], insightsFailed: false, insightsError: null, queued: [], queuedFailed: false, refetchQueued: vi.fn(),
};

function reply(prefill: Record<string, unknown> = {}) {
  const onHold = vi.fn();
  const onClose = vi.fn();
  const onReadNewer = vi.fn();
  render(
    <MemoryRouter>
      <ComposeSheet
        open
        onClose={onClose}
        onHold={onHold}
        onReadNewer={onReadNewer}
        prefill={{ providerId: 'p1', subject: 'Re: Delivery', answers: 'a-1', seenThrough: SEEN, ...prefill }}
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Thursday is fine.' } });
  return { onHold, onClose, onReadNewer };
}

const queuedBodies = () => mockPost.mock.calls.filter(([u]) => u === '/communications/letters').map(([, b]) => b);

beforeEach(() => {
  mockData.current = data;
  mockPost.mockReset();
});

function answers(...outcomes: Array<'ok' | unknown[]>) {
  mockPost.mockImplementation(async (url: string) => {
    if (url.endsWith('seal-challenge')) return { data: { challenge: 'c-1' } };
    const next = outcomes.shift() ?? 'ok';
    if (next !== 'ok') throw conflict(next as unknown[]);
    return { data: { id: 'l-1', dispatchAt: new Date(Date.now() + 120000).toISOString(), says: 'Queued.', undoMs: 120000, notices: [], insightsRecorded: 0 } };
  });
}

describe('a reply over a thread that moved on', () => {
  it('sends what it saw, and the seal is over the words alone', async () => {
    answers('ok');
    reply();
    await waitFor(() => expect((screen.getByTestId('letter-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(queuedBodies()).toHaveLength(1));
    expect(queuedBodies()[0]).toMatchObject({ answers: 'a-1', seenThrough: SEEN });
    expect(queuedBodies()[0]).not.toHaveProperty('acknowledged');
    expect(mockPost.mock.calls.find(([u]) => String(u).endsWith('seal-challenge'))?.[1]).not.toHaveProperty('seenThrough');
  });

  it("says who answered and when, takes focus, and 'Send mine as well' names what was shown", async () => {
    answers([AYSE, AGAIN], 'ok');
    reply();
    await waitFor(() => expect((screen.getByTestId('letter-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('letter-send'));
    const notice = await screen.findByTestId('letter-newer');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.className).toContain('cmp-newer');
    expect(notice.textContent).toContain(`They wrote again at ${fmtClock(AGAIN.at)} (and 1 more)`);
    expect(document.activeElement?.textContent).toContain('They wrote again');
    fireEvent.click(screen.getByTestId('letter-newer-send'));
    await waitFor(() => expect(screen.getByTestId('letter-queued')).toBeTruthy());
    expect(queuedBodies()[1]).toMatchObject({ seenThrough: SEEN, acknowledged: ['n-1', 'n-2'] });
  });

  it("'Read it first' holds the words, closes the sheet and asks the page for the newest letter", async () => {
    answers([AYSE]);
    const { onHold, onClose, onReadNewer } = reply();
    await waitFor(() => expect((screen.getByTestId('letter-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('letter-send'));
    expect((await screen.findByTestId('letter-newer')).textContent).toContain(`Ayşe answered at ${fmtClock(AYSE.at)}: Thursday works.`);
    fireEvent.click(screen.getByTestId('letter-newer-read'));
    expect(onHold).toHaveBeenCalledWith(expect.objectContaining({ body: 'Thursday is fine.', answers: 'a-1' }));
    expect(onClose).toHaveBeenCalled();
    expect(onReadNewer).toHaveBeenCalledWith('n-1');
  });

  it('keeps the space for the notice from the start, on a reply only', () => {
    reply();
    expect(screen.getByTestId('letter-newer-slot').style.minHeight).toBe('76px');
    expect(screen.queryByTestId('letter-newer')).toBeNull();
  });

  it('a new letter has no slot and sends no seenThrough', () => {
    render(
      <MemoryRouter>
        <ComposeSheet open onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('letter-newer-slot')).toBeNull();
  });

  it('any other refusal reads as before', async () => {
    mockPost.mockImplementation(async (url: string) => {
      if (url.endsWith('seal-challenge')) return { data: { challenge: 'c-1' } };
      throw Object.assign(new Error('x'), { response: { status: 409, data: { message: 'This house has no sending identity.' } } });
    });
    reply();
    await waitFor(() => expect((screen.getByTestId('letter-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('letter-send'));
    await screen.findByText(/no sending identity/);
    expect(screen.queryByTestId('letter-newer')).toBeNull();
  });
});

describe('the words and the motion', () => {
  it('names the house member, or says someone in the house', () => {
    const clock = () => '14:05';
    expect(newerLine(AYSE as never, clock)).toBe('Ayşe answered at 14:05: Thursday works.');
    expect(newerLine({ ...AYSE, who: null, firstLine: '' } as never, clock)).toBe('Someone in the house answered at 14:05');
    expect(newerLine(AGAIN as never, clock)).toBe('They wrote again at 14:05');
  });

  it('reads only a 409 that says NEWER_IN_THREAD', () => {
    expect(newerFrom(conflict([AYSE]))).toHaveLength(1);
    expect(newerFrom(conflict([]))).toBeNull();
    expect(newerFrom({ response: { status: 400, data: { code: 'NEWER_IN_THREAD', items: [AYSE] } } })).toBeNull();
    expect(newerFrom({ response: { status: 409, data: { code: 'OTHER', items: [AYSE] } } })).toBeNull();
  });

  it('opacity only, 160 ms on the house curve, none under reduced motion', () => {
    expect(NEWER_CSS).toContain('from { opacity: 0 } to { opacity: 1 }');
    expect(NEWER_CSS).toContain('animation: cmp-newer-in 160ms cubic-bezier(0.16,1,0.3,1) both');
    expect(NEWER_CSS).toMatch(/prefers-reduced-motion: reduce\) \{ \.cmp-newer \{ animation: none \} \}/);
    expect(NEWER_CSS).not.toMatch(/transform|height/);
  });

  it('a reply opened from Mail carries the newest letter shown, of either direction', () => {
    const m = (id: string, direction: string, createdAt: string, sentAt: string | null = null) =>
      ({ id, direction, createdAt, sentAt, receivedAt: direction === 'inbound' ? createdAt : null, channel: 'email', automatic: false, text: 'x', rawDeletedAt: null }) as never;
    const a = answerFor(
      { subject: 'Delivery', person: { key: 'p1', providerId: 'p1', name: 'Fikri' } } as never,
      [m('a-1', 'inbound', '2026-11-27T14:00:00.000Z'), m('q-1', 'outbound', '2026-11-27T14:03:00.000Z')],
    );
    expect(a?.answers).toBe('a-1');
    expect(a?.seenThrough).toEqual({ id: 'q-1', createdAt: '2026-11-27T14:03:00.000Z' });
  });
});
