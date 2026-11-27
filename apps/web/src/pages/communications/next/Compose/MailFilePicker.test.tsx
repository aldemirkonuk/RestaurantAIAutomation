/**
 * g6b step 3 (DD-r109-8 part 3, r110 mail-fix item 1): the composer's file
 * picker. Owner and manager only; 3 files and 5 MB per letter, refused in words
 * before any upload; the ids ride inside the sealed letter; no animation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
  useLetterSenderStanding: () => ({
    restaurantId: 'r1',
    canRelease: false,
    noMailbox: false,
    basis: 'owner',
    checking: false,
    checkedAt: 0,
    recheck: () => {},
  }),
}));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { post: mockPost, get: vi.fn() },
}));

import { ComposeSheet } from './ComposeSheet';
import { MailFilePicker, MAX_LETTER_BYTES, refusePick } from './MailFilePicker';

const standing = (basis: 'owner' | 'manager' | 'grant' | null, maySend: boolean) => ({
  readable: true,
  maySend,
  mode: maySend ? ('send' as const) : ('ask' as const),
  basis,
  grant: null,
  sentence: null,
});

const sender = (s: ReturnType<typeof standing>) => ({
  sendOrAsk: s,
  kind: 'house_mailbox' as const,
  address: 'siparis@lokantamudavim.com',
  sendable: true,
  ceremony: 'undo' as const,
  undoMs: 120000,
  words: 'Sends as siparis@lokantamudavim.com, this house’s own connected mailbox.',
  missing: [],
  deployment: { address: 'notifications@mudavym.com', refusedBecause: 'x' },
  subdomain: { provisioned: false, tier: 'paid' as const, words: 'x' },
  categories: ['price_query'],
  dispatcher: null,
});

const base = (s: ReturnType<typeof standing>) => ({
  sender: sender(s),
  senderFailed: false,
  senderError: null,
  book: [
    { providerId: 'p1', providerName: 'Fikri Tarım Gıda', contactName: 'Fikri', email: 'fikri@fikritarim.com', source: 'provider' as const },
  ],
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

function file(name: string, size: number, type = 'application/pdf'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function openSheet() {
  return render(
    <MemoryRouter initialEntries={['/communications']}>
      <ComposeSheet open onClose={() => {}} />
    </MemoryRouter>,
  );
}

function pickRecipient() {
  fireEvent.click(screen.getByText('Fikri Tarım Gıda'));
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Standing order' } });
  fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
}

function choose(files: File[]) {
  fireEvent.change(screen.getByTestId('letter-files-input'), { target: { files } });
}

const stored = (id: string, name: string, size: number) => ({ id, name, contentType: 'application/pdf', size, sha256: 'a'.repeat(64) });

beforeEach(() => {
  mockPost.mockReset();
  mockData.current = base(standing('owner', true));
});

describe('who sees the picker', () => {
  it('an owner and a manager see it; staff asking, and a staff grantee sending, do not', () => {
    const { unmount } = openSheet();
    expect(screen.getByTestId('letter-files')).toBeInTheDocument();
    unmount();
    mockData.current = base(standing('manager', true));
    const m = openSheet();
    expect(screen.getByTestId('letter-files')).toBeInTheDocument();
    m.unmount();
    mockData.current = base(standing(null, false));
    const s = openSheet();
    expect(screen.queryByTestId('letter-files')).toBeNull();
    expect(screen.queryByText('Attach files')).toBeNull();
    s.unmount();
    mockData.current = base(standing('grant', true));
    openSheet();
    expect(screen.queryByTestId('letter-files')).toBeNull();
  });
});

describe('the caps, refused in words before any upload', () => {
  it('a 4th file is refused and nothing is uploaded', async () => {
    mockPost.mockResolvedValueOnce({ data: [stored('11111111-1111-4111-8111-111111111111', 'a.pdf', 10), stored('22222222-2222-4222-8222-222222222222', 'b.pdf', 10), stored('33333333-3333-4333-8333-333333333333', 'c.pdf', 10)] });
    openSheet();
    choose([file('a.pdf', 10), file('b.pdf', 10), file('c.pdf', 10)]);
    await waitFor(() => expect(screen.getByTestId('letter-files-total')).toHaveTextContent('3 of 3 files'));
    expect(mockPost).toHaveBeenCalledTimes(1);
    choose([file('d.pdf', 10)]);
    expect(screen.getByRole('alert')).toHaveTextContent('A letter can carry 3 files at most. This one has 3, so the 1 you chose was not added. Nothing was uploaded.');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('four chosen at once are refused whole, with no upload', () => {
    openSheet();
    choose([file('a.pdf', 1), file('b.pdf', 1), file('c.pdf', 1), file('d.pdf', 1)]);
    expect(screen.getByTestId('letter-files-refused')).toHaveTextContent('This one has 0, so the 4 you chose were not added. Nothing was uploaded.');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('over 5 MB in all is refused with the running total, and nothing is uploaded', async () => {
    mockPost.mockResolvedValueOnce({ data: [stored('11111111-1111-4111-8111-111111111111', 'menu.pdf', 3 * 1024 * 1024)] });
    openSheet();
    choose([file('menu.pdf', 3 * 1024 * 1024)]);
    await waitFor(() => expect(screen.getByTestId('letter-files-total')).toHaveTextContent('1 of 3 files · 3.0 MB of 5 MB'));
    choose([file('photo.jpg', 2 * 1024 * 1024 + 1, 'image/jpeg')]);
    expect(screen.getByRole('alert')).toHaveTextContent('The files together would be 5.0 MB, over the 5 MB a letter can carry. Nothing was uploaded.');
    expect(mockPost).toHaveBeenCalledTimes(1);
    // Exactly 5 MB fits: the cap is "over", as the gateway counts it.
    expect(refusePick([{ size: 3 * 1024 * 1024 }], [{ size: 2 * 1024 * 1024 }])).toBeNull();
    expect(refusePick([], [{ size: MAX_LETTER_BYTES + 1 }])).toMatch(/over the 5 MB/);
  });

  it("an upload the gateway refuses says the gateway's sentence and attaches nothing", async () => {
    mockPost.mockRejectedValueOnce({ response: { data: { message: 'The file e.txt is empty. Nothing was uploaded.' } } });
    openSheet();
    choose([file('e.txt', 0, 'text/plain')]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nothing was attached: The file e.txt is empty. Nothing was uploaded.'));
    expect(screen.getByTestId('letter-files-total')).toHaveTextContent('0 of 3 files');
  });
});

describe('the ids ride inside the sealed letter', () => {
  it('sends the uploaded ids in BOTH the seal and the queue, and Remove drops one from both', async () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    mockPost.mockImplementation((path: string, body: { files?: unknown[] }) =>
      Promise.resolve(
        path === '/communications/letters/files'
          ? { data: body.files?.length === 2 ? [stored(A, 'a.pdf', 10), stored(B, 'b.pdf', 10)] : [] }
          : path === '/communications/letters/seal-challenge'
            ? { data: { challenge: 'seal-1' } }
            : { data: { id: 'L1', dispatchAt: new Date(Date.now() + 120000).toISOString(), says: 'Queued.', undoMs: 120000, notices: [], insightsRecorded: 0 } },
      ),
    );
    openSheet();
    pickRecipient();
    choose([file('a.pdf', 10), file('b.pdf', 10)]);
    await waitFor(() => expect(screen.getByTestId('letter-files-total')).toHaveTextContent('2 of 3 files'));
    const [, upload] = mockPost.mock.calls[0];
    expect(upload.files.map((f: { name: string }) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(upload.files[0].contentBase64).not.toMatch(/^data:/);
    fireEvent.click(within(screen.getByTestId('letter-files-list')).getByRole('button', { name: 'Remove a.pdf' }));
    expect(screen.getByTestId('letter-files-total')).toHaveTextContent('1 of 3 files');
    fireEvent.click(screen.getByTestId('letter-send'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(3));
    const [mintPath, mintBody] = mockPost.mock.calls[1];
    const [queuePath, queueBody] = mockPost.mock.calls[2];
    expect(mintPath).toBe('/communications/letters/seal-challenge');
    expect(queuePath).toBe('/communications/letters');
    expect(mintBody.fileIds).toEqual([B]);
    expect(queueBody.fileIds).toEqual([B]);
  });

  it('Send waits while a file is still uploading', async () => {
    let finish: (v: unknown) => void = () => {};
    mockPost.mockImplementation(() => new Promise((r) => { finish = r; }));
    openSheet();
    // The file goes up first, so the letter is otherwise ready while it is in flight. (jsdom cannot
    // re-parse this button's background going from the seal colour to transparent, so the test
    // never asks it to: it watches Send stay off, then come on.)
    choose([file('a.pdf', 10)]);
    await waitFor(() => expect(screen.getByTestId('letter-files-attach')).toHaveTextContent('Uploading…'));
    pickRecipient();
    expect(screen.getByTestId('letter-send')).toBeDisabled();
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('letter-send')).toBeDisabled();
    finish({ data: [stored('11111111-1111-4111-8111-111111111111', 'a.pdf', 10)] });
    await waitFor(() => expect(screen.getByTestId('letter-send')).toBeEnabled());
  });
});

describe('motion', () => {
  it('under reduced motion nothing in the picker animates, not even a fade', () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      render(<MailFilePicker files={[stored('11111111-1111-4111-8111-111111111111', 'a.pdf', 10)]} onChange={() => {}} onBusy={() => {}} />);
      const root = screen.getByTestId('letter-files');
      for (const el of [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[]) {
        expect(el.style.animation).toBe('');
        expect(el.style.transition).toBe('');
        expect(el.style.opacity).toBe('');
        expect(el.getAttribute('class') ?? '').not.toMatch(/fade|anim|motion/i);
      }
    } finally {
      window.matchMedia = mm;
    }
  });
});
