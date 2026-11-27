/**
 * r109 mail-gap g1: a house letter that did not arrive says so. Rendered for
 * real (MailTab, MailThread) against a stubbed gateway: the line under the
 * letter in the house's clock, the refused tone and Write again for a failure,
 * a delay that never sounds refused, staff who see the line but write nothing,
 * and the list row's chip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { bounceReason, unsentChipRefused, unsentChipText } from './mail-format';

const base = {
  channel: 'email', aiGenerated: false, rawDeletedAt: null, automatic: false, noReplyMarkedAt: null, kind: 'vendor',
  fromAddress: 'v@x.com', toAddresses: ['orders@house.example'], attachments: [], mailbox: null, senderCheck: null, signedBy: null,
};
const inbound = { ...base, id: 'in1', direction: 'inbound', status: 'RECEIVED', text: 'Prices for December', sentAt: null, receivedAt: '2026-11-26T09:00:00Z', createdAt: '2026-11-26T09:00:00Z', door: 'house_mailbox', delivery: null };
const failed = { state: 'did_not_arrive', at: '2026-11-27T11:02:00.000Z', recipient: 'v@x.com', status: '5.1.1', said: '550 5.1.1 no such user' };
const out = (id: string, delivery: unknown, at = '2026-11-27T11:00:00Z') => ({
  ...base, id, direction: 'outbound', status: 'SENT', text: 'Six cases for Friday', sentAt: at, receivedAt: null, createdAt: at, door: 'from_house', delivery,
});
const thread = vi.hoisted(() => ({ letters: [] as unknown[] }));
const person = vi.hoisted(() => ({ unsentStatus: null as string | null }));

function mount(at = '/communications?thread=gm%3At1') {
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

beforeEach(() => {
  thread.letters = [inbound, out('o1', failed)];
  person.unsentStatus = 'did_not_arrive';
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/thread')
      return { data: { key: 'gm:t1', subject: 'Friday order', person: { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Ali' }, order: null, messages: thread.letters, before: null, waiting: false, attachmentsRead: true } };
    if (url === '/mail/summary')
      return {
        data: {
          waitingPeople: 0, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null,
          doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
          address: { configured: false, address: null },
          zone: { zone: 'Europe/Istanbul', source: 'house' },
        },
      };
    if (url === '/mail/people')
      return {
        data: {
          people: [{ key: 'vendor:p1', kind: 'vendor', name: 'Ali', providerId: 'p1', lastAt: '2026-11-27T11:00:00Z', snippet: 'Six cases', waiting: false, openThreads: 1, channels: ['email'], newestOpenOrderNumber: null, unsentStatus: person.unsentStatus, newToYou: false }],
          next: null, storedKinds: ['vendor'],
        },
      };
    if (url === '/mail/threads') return { data: { person: null, threads: [], next: null } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('a house letter that did not arrive', () => {
  it('says whom it did not reach, when in the house clock, and why, in the refused tone', async () => {
    mount();
    const line = await screen.findByTestId('letter-delivery');
    expect(line).toHaveAttribute('data-state', 'did_not_arrive');
    // 11:02Z is 14:02 in Istanbul, whatever this machine's clock says.
    expect(line.firstElementChild?.textContent).toMatch(/^Did not reach v@x\.com on Fri, Nov 27, 2:02.PM GMT\+3 \(the address does not exist, 5\.1\.1\)$/);
    expect(line).toHaveStyle({ color: 'var(--alarm-deep, #8C3322)' });
    // Under the house's own letter, never the vendor's.
    const rows = screen.getAllByTestId('mail-letter');
    expect(within(rows[rows.length - 1]).getByTestId('letter-delivery')).toBe(line);
    expect(within(rows[0]).queryByTestId('letter-delivery')).toBeNull();
  });

  it('Write again opens the composer on the same answer as Write a reply, with a 44 px target', async () => {
    const onAnswer = mount();
    const again = await screen.findByTestId('letter-write-again');
    expect(again).toHaveStyle({ minHeight: '44px' });
    fireEvent.click(again);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenLastCalledWith({ providerId: 'p1', answers: 'o1', subject: 'Re: Friday order' });
    fireEvent.click(screen.getByTestId('write-thread-reply'));
    expect(onAnswer.mock.calls[1]).toEqual(onAnswer.mock.calls[0]);
  });

  it('a delay says Gmail is still trying, in the letter ink, with no Write again', async () => {
    thread.letters = [inbound, out('o1', { ...failed, state: 'delayed', status: '4.4.7', said: null })];
    mount();
    const line = await screen.findByTestId('letter-delivery');
    expect(line).toHaveAttribute('data-state', 'delayed');
    expect(line.textContent).toMatch(/^Delayed, Gmail is still trying to reach v@x\.com \(since Fri, Nov 27, 2:02.PM GMT\+3\)$/);
    expect(line.textContent).not.toMatch(/Did not|refused/);
    expect(line).toHaveStyle({ color: 'var(--ink-2, #4F473C)' });
    expect(screen.queryByTestId('letter-write-again')).toBeNull();
  });

  it('staff see the line but are offered nothing to write', async () => {
    auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    mount();
    expect(await screen.findByTestId('letter-delivery')).toHaveAttribute('data-state', 'did_not_arrive');
    expect(screen.queryByTestId('letter-write-again')).toBeNull();
  });

  it('a letter with no mark, or a received one carrying one, says nothing of the kind', async () => {
    thread.letters = [{ ...inbound, delivery: failed }, out('o1', null)];
    mount();
    await screen.findAllByTestId('mail-letter');
    expect(screen.queryByTestId('letter-delivery')).toBeNull();
  });
});

describe("the person's row", () => {
  it('draws the chip "Did not arrive" in the refused tone; a queued letter keeps the quiet one', async () => {
    mount('/communications?tab=mail');
    const chip = await screen.findByTestId('mail-unsent');
    expect(chip).toHaveTextContent('Did not arrive');
    expect(chip).toHaveAttribute('data-tone', 'refused');
    expect(chip).toHaveStyle({ color: 'var(--alarm-deep, #8C3322)' });
  });

  it('the words and tones, by status', () => {
    expect(unsentChipText('did_not_arrive')).toBe('Did not arrive');
    expect(unsentChipRefused('did_not_arrive')).toBe(true);
    expect(unsentChipRefused('HOUSE_FAILED')).toBe(true);
    expect(unsentChipRefused('HOUSE_QUEUED')).toBe(false);
    expect(unsentChipRefused('SENT')).toBe(false);
    expect(unsentChipRefused(null)).toBe(false);
    expect(bounceReason('5.1.1')).toBe('the address does not exist');
    expect(bounceReason('5.2.2')).toBe('the mailbox is full');
    expect(bounceReason('5.7.1')).toBe('their server refused it');
    expect(bounceReason('5.9.9')).toBe('it was sent back');
  });
});
