/**
 * A letter's Details (r108 mail-gap g8): how it came, which address received
 * it, and whether its sender was checked, in place under the provenance line.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { MAIL_MOTION_CSS } from './mail-motion';
import { letterDetails, type MailMessage } from './mail-format';

const base = {
  direction: 'inbound',
  channel: 'email',
  text: 'Prices for December',
  aiGenerated: false,
  status: 'RECEIVED',
  sentAt: null,
  receivedAt: '2026-11-06T09:00:00Z',
  createdAt: '2026-11-06T09:00:00Z',
  rawDeletedAt: null,
  automatic: false,
  noReplyMarkedAt: null,
  kind: 'vendor',
  fromAddress: 'ali@v.example',
  toAddresses: ['orders@house.example'],
  attachments: [],
};
// Three letters, not four: a thread of FOLD_AT (4) or more folds its earlier letters
// behind a button, and the Details toggles under test would not be on the page.
const received = [
  { ...base, id: 'a', door: 'house_mailbox', mailbox: 'orders@house.example', senderCheck: 'passed', signedBy: 'v.example' },
  { ...base, id: 'b', door: 'mudavym_mail', toAddresses: ['kitchen@mail.mudavym.com'], mailbox: null, senderCheck: 'failed', signedBy: null },
  { ...base, id: 'c', door: 'house_mailbox', mailbox: 'a connected mailbox', senderCheck: null, signedBy: null },
];
const sent = { ...base, id: 'd', door: 'from_house', direction: 'outbound', status: 'SENT', sentAt: '2026-11-06T10:00:00Z', receivedAt: null };
const thread = vi.hoisted(() => ({ letters: [] as unknown[] }));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?thread=gm%3At1']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** r108 g9: four letters fold the earlier ones; Details lives on a letter, so open the stack first. */
async function allLetters() {
  await screen.findAllByTestId('mail-letter');
  for (const b of [...screen.queryAllByTestId('mail-letter-stack'), ...screen.queryAllByTestId('mail-letter-folded')]) {
    fireEvent.click(within(b).getByRole('button'));
  }
  await waitFor(() => expect(screen.getAllByTestId('mail-letter')).toHaveLength(4));
  return screen.getAllByTestId('mail-letter');
}

beforeEach(() => {
  thread.letters = received;
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread')
      return {
        data: {
          key: 'gm:t1',
          subject: 'Prices',
          person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Ali' },
          order: null,
          messages: thread.letters,
          before: null,
          waiting: false,
          attachmentsRead: true,
        },
      };
    if (url === '/mail/summary')
      return {
        data: {
          waitingPeople: 0, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null,
          doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
          address: { configured: true, address: 'Kitchen@mail.mudavym.com' },
          zone: { zone: 'Europe/Istanbul', source: 'house' },
        },
      };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: [] } };
    if (url === '/mail/threads') return { data: { person: null, threads: [], next: null } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe("a received letter's Details", () => {
  it('is a quiet text button on each received letter only, closed until pressed', async () => {
    thread.letters = [received[0], received[1], sent];
    mount();
    const rows = await allLetters();
    expect(rows).toHaveLength(3);
    const toggles = rows.map((r) => within(r).queryByTestId('letter-details-toggle'));
    expect(toggles.map((t) => t?.getAttribute('aria-expanded') ?? null)).toEqual(['false', 'false', null]);
    expect(screen.queryByTestId('letter-details')).toBeNull();
    expect(toggles[0]).toHaveStyle({ minHeight: '44px' });
  });

  it('opens in place with how it came, the address and the sender check, in the house clock', async () => {
    mount();
    const [a, b, c] = await allLetters();
    const open = (r: HTMLElement) => {
      const t = within(r).getByTestId('letter-details-toggle');
      fireEvent.click(t);
      expect(t).toHaveAttribute('aria-expanded', 'true');
      const block = within(r).getByTestId('letter-details');
      expect(t.getAttribute('aria-controls')).toBe(block.id);
      expect(block).toHaveClass('mail-fade-in');
      return [...block.querySelectorAll('li')].map((li) => li.textContent);
    };
    const la = open(a);
    expect(la[0]).toMatch(/^Received .*12:00/);
    expect(la.slice(1)).toEqual(['Arrived in orders@house.example (a connected Gmail mailbox)', 'Signed by v.example, checked']);
    expect(open(b).slice(1)).toEqual(['Arrived at kitchen@mail.mudavym.com', 'Its sender could not be confirmed']);
    expect(open(c).slice(1)).toEqual([
      'Arrived in a connected mailbox',
      'Its sender check was not recorded: this letter was stored before Mail kept it',
    ]);
    fireEvent.click(within(a).getByTestId('letter-details-toggle'));
    // No exit animation: it is simply gone.
    expect(within(a).queryByTestId('letter-details')).toBeNull();
  });

  it('never says "not signed" for a check that was not kept, and says WhatsApp plainly', () => {
    const m = { ...base, door: 'whatsapp', channel: 'whatsapp', senderCheck: null } as unknown as MailMessage;
    expect(letterDetails(m, { zone: 'Europe/Istanbul' }).slice(1)).toEqual(['WhatsApp']);
    const none = letterDetails({ ...m, door: 'house_mailbox' }, {}).join(' ');
    expect(none).not.toMatch(/not signed/i);
    // A house with no zone is told the clock is this device's.
    expect(none).toMatch(/on this device's clock: the house's time zone is not set/);
    // A Mudavym letter the house address did not receive keeps the honest hedge.
    expect(letterDetails({ ...m, door: 'mudavym_mail', toAddresses: ['other@x.example'] }, { address: 'k@mail.mudavym.com' })[1]).toBe(
      "Arrived at Mudavym's mailbox or your Mudavym address",
    );
  });

  it('fades in over 160 ms and not at all under reduced motion', () => {
    expect(MAIL_MOTION_CSS).toMatch(/\.mail-fade-in \{ animation: mail-fade-in 160ms/);
    expect(MAIL_MOTION_CSS.slice(MAIL_MOTION_CSS.indexOf('prefers-reduced-motion'))).toMatch(/\.mail-fade-in[^{]*\{ animation: none !important \}/);
  });
});
