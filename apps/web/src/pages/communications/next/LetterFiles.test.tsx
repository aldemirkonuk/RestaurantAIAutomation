/**
 * r28 mail gap 13 on a Mail thread, rendered for real against a stubbed
 * gateway: each letter names the files it carried, "Open" opens a new tab in
 * the click and points it at a five-minute address, a removed file keeps its
 * name with nothing to open, and a page whose files could not be read says
 * so, never that the letters carried none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailThread } from './MailThread';
import { fileKindWords, fileOpenFailWords, fileSizeWords, type MailMessage } from './mail-format';

const letter = (over: Partial<MailMessage>): MailMessage => ({
  id: 'm1',
  direction: 'inbound',
  channel: 'email',
  text: 'Prices attached.',
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: '2026-11-06T09:00:00Z',
  createdAt: '2026-11-06T09:00:00Z',
  rawDeletedAt: null,
  door: 'house_mailbox',
  ...over,
});

const INVOICE = { id: 'f1', filename: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 122_880, removedAt: null };
const PHOTO = { id: 'f2', filename: 'delivery.jpg', mimeType: 'image/jpeg', sizeBytes: 2_516_582, removedAt: '2026-11-10T08:00:00Z' };

let page: Record<string, unknown>;
let link: () => unknown;
let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> } | null;
const realOpen = window.open;
const openSpy = vi.fn((_url?: string, _target?: string) => tab as unknown as Window | null);

beforeEach(() => {
  page = {
    key: 'gm:abc',
    subject: 'Spring list',
    person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' },
    order: null,
    messages: [
      letter({ id: 'm1', attachments: [INVOICE, PHOTO] }),
      letter({ id: 'm2', direction: 'outbound', status: 'SENT', sentAt: '2026-11-06T10:00:00Z', door: 'from_house', text: 'Thanks', attachments: [] }),
    ],
    before: null,
    waiting: false,
    attachmentsRead: true,
  };
  link = () => ({ id: 'f1', filename: 'invoice.pdf', mimeType: 'application/pdf', url: 'https://files.test/f1', expiresInSeconds: 300 });
  tab = { opener: 'the app', location: { href: '' }, close: vi.fn() };
  openSpy.mockClear();
  window.open = openSpy as unknown as typeof window.open;
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') return { data: page };
    if (url.startsWith('/mail/attachments/')) return { data: link() };
    throw new Error(`unexpected GET ${url}`);
  });
});

afterEach(() => {
  window.open = realOpen;
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MailThread
          threadKey="gm:abc"
          onBack={vi.fn()}
          backLabel="Back"
          onOpenPerson={vi.fn()}
          canReply={false}
          draftedOrderIds={new Set<string>()}
          onOpenReply={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const lettersShown = async () => screen.findAllByTestId('mail-letter');

describe('a letter names the files it carried', () => {
  it('names each file with its kind and size, and only on its own letter', async () => {
    mount();
    const [vendorLetter, houseLetter] = await lettersShown();
    const files = within(vendorLetter).getAllByTestId('letter-file');
    expect(files).toHaveLength(2);
    expect(files[0]).toHaveTextContent('invoice.pdf');
    expect(files[0]).toHaveTextContent('PDF, 120 KB');
    expect(within(files[0]).getByRole('button', { name: 'Open invoice.pdf' })).toBeInTheDocument();
    expect(within(houseLetter).queryByTestId('letter-files')).toBeNull();
  });

  it('a removed file keeps its name, says why, and offers nothing to open', async () => {
    mount();
    const [vendorLetter] = await lettersShown();
    const photo = within(vendorLetter).getAllByTestId('letter-file')[1];
    expect(photo).toHaveTextContent('delivery.jpg');
    expect(photo).toHaveTextContent('photo, 2.4 MB');
    expect(within(photo).getByTestId('letter-file-removed')).toHaveTextContent(
      /^The file was removed under the retention rule, .+; its name is kept\.$/,
    );
    expect(within(photo).queryByRole('button')).toBeNull();
  });

  it('a page whose files could not be read says so, and still shows the letters', async () => {
    page = { ...page, attachmentsRead: false, messages: [letter({ id: 'm1', attachments: [] })] };
    mount();
    expect(await screen.findByTestId('thread-files-unread')).toHaveTextContent(
      'The files these letters carried could not be read just now. That does not mean there are none.',
    );
    expect(screen.getAllByTestId('mail-letter')).toHaveLength(1);
  });

  it('a page that read its files says nothing about them', async () => {
    mount();
    await lettersShown();
    expect(screen.queryByTestId('thread-files-unread')).toBeNull();
  });
});

describe('Open', () => {
  it('opens a tab in the click, then points it at the address, cut from the app', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open invoice.pdf' }));
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab!.location.href).toBe('https://files.test/f1'));
    expect(tab!.opener).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/mail/attachments/f1/link');
    expect(screen.queryByTestId('letter-file-failed')).toBeNull();
  });

  it("a refused file closes the tab and says the gateway's words", async () => {
    link = () => {
      throw Object.assign(new Error('Request failed'), {
        response: {
          status: 410,
          data: { message: "This file was removed under the house's mail retention rule. Its name is kept with the letter." },
        },
      });
    };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open invoice.pdf' }));
    expect(await screen.findByTestId('letter-file-failed')).toHaveTextContent(
      "This file was removed under the house's mail retention rule. Its name is kept with the letter.",
    );
    expect(tab!.close).toHaveBeenCalled();
  });

  it('a blocked pop-up shows the address as a link to click', async () => {
    tab = null;
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open invoice.pdf' }));
    const blocked = await screen.findByTestId('letter-file-blocked');
    const a = within(blocked).getByRole('link', { name: 'Open invoice.pdf' });
    expect(a).toHaveAttribute('href', 'https://files.test/f1');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('target', '_blank');
    expect(blocked).toHaveTextContent('this link works for five minutes');
  });
});

describe('the words', () => {
  it('fileSizeWords', () => {
    expect(fileSizeWords(880)).toBe('880 bytes');
    expect(fileSizeWords(1024)).toBe('1 KB');
    expect(fileSizeWords(122_880)).toBe('120 KB');
    expect(fileSizeWords(2_516_582)).toBe('2.4 MB');
    expect(fileSizeWords(15 * 1024 * 1024)).toBe('15 MB');
    expect(fileSizeWords(null)).toBeNull();
    expect(fileSizeWords(-1)).toBeNull();
  });

  it('fileKindWords', () => {
    expect(fileKindWords('application/pdf')).toBe('PDF');
    expect(fileKindWords('IMAGE/PNG')).toBe('photo');
    expect(fileKindWords('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('spreadsheet');
    expect(fileKindWords('text/csv')).toBe('spreadsheet');
    expect(fileKindWords('application/msword')).toBe('document');
    expect(fileKindWords('application/zip')).toBeNull();
    expect(fileKindWords(null)).toBeNull();
  });

  it('fileOpenFailWords: no answer, a 404 in its words, anything else plainly', () => {
    expect(fileOpenFailWords(new Error('Network Error'))).toBe('No answer. Check the connection and try again.');
    expect(fileOpenFailWords({ response: { status: 404, data: { message: "That file is not in this house's mail." } } })).toBe(
      "That file is not in this house's mail.",
    );
    expect(fileOpenFailWords({ response: { status: 503, data: { message: 'internal detail' } } })).toBe(
      'The file could not be opened just now. Try again in a moment.',
    );
  });
});
