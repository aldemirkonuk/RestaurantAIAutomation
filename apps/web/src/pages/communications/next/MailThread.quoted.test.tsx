/**
 * r41 mail audit, gap 3: a reply in a Mail thread shows its own words, and the
 * earlier letters it quotes sit folded behind one button that says how many
 * lines it holds. They are not laid out until the button is pressed. A letter
 * that quotes nothing has no button.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailThread } from './MailThread';
import type { MailMessage } from './mail-format';

const letter = (over: Partial<MailMessage>): MailMessage => ({
  id: 'm1',
  direction: 'inbound',
  channel: 'email',
  text: '',
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: '2026-11-12T09:00:00Z',
  createdAt: '2026-11-12T09:00:00Z',
  rawDeletedAt: null,
  door: 'mudavym_mail',
  attachments: [],
  ...over,
});

const REPLY = 'Yes, 40 cases on Tuesday.\n\nOn Mon, 13 Nov 2026 at 09:00, Kitchen <k@example.com> wrote:\n> Can you do 40 cases?\n> And deliver Tuesday?';

beforeEach(() => {
  const page = {
    key: 'gm:abc',
    subject: '40 cases',
    person: { key: 'vendor:p1', kind: 'vendor', name: 'Bodega' },
    order: null,
    messages: [letter({ id: 'm1', text: 'Prices attached.' }), letter({ id: 'm2', text: REPLY })],
    before: null,
    waiting: false,
    attachmentsRead: true,
    heldMarksRead: true,
  };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread') return { data: page };
    throw new Error(`unexpected GET ${url}`);
  });
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

describe('a reply folds the earlier letters it quotes', () => {
  it('shows its own words, and the quoted letters only after the button', async () => {
    mount();
    const letters = await screen.findAllByTestId('mail-letter');
    const reply = letters.find((li) => li.textContent?.includes('Yes, 40 cases on Tuesday.'))!;
    expect(reply).toBeTruthy();
    expect(reply.textContent).not.toContain('Can you do 40 cases?');
    expect(within(reply).queryByTestId('letter-quoted')).toBeNull();

    const toggle = within(reply).getByRole('button', { name: 'Show the earlier letters it quotes (3 lines)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(within(reply).getByTestId('letter-quoted').textContent).toContain('> Can you do 40 cases?');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide the earlier letters it quotes (3 lines)');

    fireEvent.click(toggle);
    expect(within(reply).queryByTestId('letter-quoted')).toBeNull();
  });

  it('a letter that quotes nothing has no button', async () => {
    mount();
    const letters = await screen.findAllByTestId('mail-letter');
    const first = letters.find((li) => li.textContent?.includes('Prices attached.'))!;
    expect(within(first).queryByRole('button', { name: /earlier letters it quotes/ })).toBeNull();
  });
});
