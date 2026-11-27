/**
 * "Send at…" on the house's clock (r110 mail-gap g1). The composer sends a
 * choice key, never a clock; the queued row says when it leaves in the house's
 * own words; the list enters with a 160 ms rise and leaves at once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockQueued = vi.hoisted(() => ({ current: [] as unknown[] }));
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
  useQueuedLetters: () => ({ restaurantId: 'r1', queued: mockQueued.current, failed: false }),
  useLetterSenderStanding: () => ({ restaurantId: 'r1', canRelease: true, noMailbox: false, basis: 'owner', checking: false, checkedAt: 0, recheck: () => {} }),
}));
vi.mock('../../../../services/api/client', () => ({ apiClient: { post: mockPost, get: vi.fn() } }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { ComposeSheet } from './ComposeSheet';
import { QueuedPullBack } from '../QueuedPullBack';
import { SEND_AT_CSS, leavesAt } from './SendAtMenu';

const standing = (basis: string) => ({ readable: true, maySend: true, mode: 'send', basis, grant: null, sentence: null });
const sender = (over: Record<string, unknown> = {}) => ({
  kind: 'house_mailbox',
  address: 'owner@house.test',
  sendable: true,
  ceremony: 'undo',
  undoMs: 120000,
  words: '',
  missing: [],
  categories: [],
  dispatcher: null,
  sendOrAsk: standing('owner'),
  ...over,
});
const data = (s: Record<string, unknown>) => ({
  restaurantId: 'r1',
  sender: s,
  senderFailed: false,
  senderError: null,
  book: [{ providerId: 'p1', providerName: 'Fikri Tarım Gıda', contactName: null, email: 'fikri@fikritarim.com', source: 'provider' }],
  bookFailed: false,
  bookError: null,
  byProvider: new Map(),
  templates: [],
  templatesFailed: false,
  templatesError: null,
  insights: [],
  insightsFailed: false,
  insightsError: null,
  queued: [],
  queuedFailed: false,
  refetchQueued: vi.fn(),
});

const CHOSEN = { choice: 'monday_0800', local: '2027-03-29 08:00', zone: 'Europe/Berlin' };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function open(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <ComposeSheet open onClose={onClose} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('Fikri Tarım Gıda'));
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Order' } });
  fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Two cases.' } });
  return { onClose };
}

beforeEach(() => {
  mockData.current = data(sender());
  mockQueued.current = [];
  mockPost.mockReset();
  mockPost.mockImplementation(async (url: string) =>
    url.endsWith('seal-challenge')
      ? { data: { challenge: 'c-1' } }
      : { data: { id: 'l-1', dispatchAt: inDays(2), says: 'Queued to leave at 2027-03-29 08:00.', undoMs: 120000, notices: [], insightsRecorded: 0, sendAtChosen: CHOSEN } },
  );
});

describe('Send at… in the composer', () => {
  it('sends the choice key, never a clock, and the seal is over the words alone', async () => {
    open();
    fireEvent.click(screen.getByTestId('letter-send-at'));
    const items = screen.getAllByRole('menuitem').map((b) => b.textContent);
    expect(items).toEqual(['In an hour', 'Tomorrow, 08:00 house time', 'Monday, 08:00 house time']);
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Monday, 08:00 house time' }));
    await waitFor(() => expect(screen.getByTestId('letter-queued')).toBeTruthy());
    const queued = mockPost.mock.calls.find(([u]) => u === '/communications/letters');
    expect(queued?.[1]).toMatchObject({ to: 'fikri@fikritarim.com', sendAt: 'monday_0800' });
    expect(Object.keys(queued?.[1] ?? {})).not.toContain('dispatchAt');
    const sealed = mockPost.mock.calls.find(([u]) => String(u).endsWith('seal-challenge'));
    expect(sealed?.[1]).not.toHaveProperty('sendAt');
    expect(screen.getByTestId('letter-queued').textContent).toContain('Leaves Mon 08:00 · Pull it back');
  });

  it('plain Send carries no choice', async () => {
    open();
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(mockPost.mock.calls.some(([u]) => u === '/communications/letters')).toBe(true));
    expect(mockPost.mock.calls.find(([u]) => u === '/communications/letters')?.[1]).not.toHaveProperty('sendAt');
  });

  it('Escape closes the list, not the sheet, at once, and gives focus back', async () => {
    const { onClose } = open();
    const trigger = screen.getByTestId('letter-send-at');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull(); // no exit animation keeps it mounted
    expect(onClose).not.toHaveBeenCalled();
    // The sheet never heard it: a held sheet tears and closes after its tuck.
    await new Promise((r) => setTimeout(r, 1000));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('is offered to an owner or a manager only, and not on the seal ceremony', () => {
    for (const [s, shown] of [
      [sender({ sendOrAsk: standing('manager') }), true],
      [sender({ sendOrAsk: standing('grant') }), false],
      [sender({ ceremony: 'seal' }), false],
    ] as const) {
      mockData.current = data(s);
      const { unmount } = render(
        <MemoryRouter>
          <ComposeSheet open onClose={() => {}} />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('letter-send-at') !== null).toBe(shown);
      unmount();
    }
  });

  it('enters with opacity and a 4px rise over 160 ms, and not at all under reduced motion', () => {
    expect(SEND_AT_CSS).toContain('from { opacity: 0; transform: translateY(4px) }');
    expect(SEND_AT_CSS).toContain('animation: cmp-sendat-in 160ms cubic-bezier(0.16,1,0.3,1) both');
    expect(SEND_AT_CSS).toMatch(/prefers-reduced-motion: reduce\) \{ \.cmp-sendat-pop \{ animation: none \} \}/);
    expect(SEND_AT_CSS).not.toMatch(/cmp-sendat-out|transition/);
  });
});

describe('the queued row says when it leaves on the house clock', () => {
  it("'Leaves Mon 08:00 · Pull it back' while more than a minute is left", () => {
    mockQueued.current = [{ id: 'l-1', providerId: 'p1', subject: 'Order', to: 'x', dispatchAt: inDays(2), sendAtChosen: CHOSEN }];
    render(<QueuedPullBack id="l-1" />);
    expect(screen.getByTestId('book-queued').textContent).toContain('Leaves Mon 08:00 ·Pull it back');
    expect(screen.getByTestId('book-pull-back').textContent).toBe('Pull it back');
  });

  it('counts seconds only in its last minute, and a letter with no choice counts as before', () => {
    mockQueued.current = [
      { id: 'l-1', providerId: 'p1', subject: 'Order', to: 'x', dispatchAt: new Date(Date.now() + 30_000).toISOString(), sendAtChosen: CHOSEN },
      { id: 'l-2', providerId: 'p1', subject: 'Order', to: 'x', dispatchAt: inDays(2) },
    ];
    render(<QueuedPullBack id="l-1" />);
    expect(screen.getByTestId('book-pull-back').textContent).toMatch(/^Pull it back \(\d+s\)$/);
    expect(screen.getByTestId('book-queued').textContent).not.toContain('Leaves');
  });

  it('leavesAt reads the house wall time, and nothing else', () => {
    expect(leavesAt(CHOSEN as never)).toBe('Mon 08:00');
    expect(leavesAt({ ...CHOSEN, local: '2027-03-28 03:00' } as never)).toBe('Sun 03:00');
    expect(leavesAt({ ...CHOSEN, local: '2027-03-28T03:00:00Z' } as never)).toBeNull();
    expect(leavesAt(null)).toBeNull();
  });
});
