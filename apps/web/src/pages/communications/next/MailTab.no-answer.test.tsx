/**
 * No answer yet (r108 mail-gap g7): the house wrote and nobody answered.
 * A person's row says "No answer · 4 days" after 72 h; an owner or manager can
 * keep only those people, and is told plainly when there are none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { MAIL_MOTION_CSS } from './mail-motion';
import { noAnswerWords } from './mail-format';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const H = 3_600_000;
const ago = (h: number) => new Date(NOW - h * H).toISOString();

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};

const person = (n: number, extra: Record<string, unknown>) => ({
  key: `vendor:p${n}`,
  kind: 'vendor',
  providerId: `p${n}`,
  name: `Vendor ${n}`,
  lastLine: `Line ${n}`,
  lastAt: ago(100),
  lastDirection: 'outbound',
  waiting: false,
  waitingSince: null,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
  unsentStatus: null,
  awaitingSince: ago(100),
  ...extra,
});

let peopleCalls: Array<Record<string, string>> = [];
let awaitingPeople: unknown[] = [];

function mount(role: string) {
  auth.current = { user: { role, restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: role };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  peopleCalls = [];
  awaitingPeople = [];
  api.get.mockReset();
  api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    if (url === '/mail/people') {
      const params = cfg?.params ?? {};
      peopleCalls.push(params);
      return {
        data: {
          people:
            params.awaiting === '1'
              ? awaitingPeople
              : [
                  person(1, {}),
                  person(2, { lastDirection: 'inbound' }),
                  person(3, { awaitingSince: ago(71) }),
                  person(4, { waiting: true }),
                  person(5, { unsentStatus: 'HOUSE_QUEUED' }),
                  person(6, { awaitingSince: undefined }),
                  person(7, { awaitingSince: ago(72) }),
                ],
          next: null,
          storedKinds: ['vendor'],
        },
      };
    }
    const routes: Record<string, () => unknown> = {
      '/mail/summary': () => SUMMARY,
      '/communications/letters/sender': () => ({ address: null, words: null }),
    };
    const h = routes[url];
    if (!h) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    return { data: h() };
  });
});

describe('a person the house wrote to last, with no answer for 72 h, says so on the row', () => {
  it('draws "No answer · N days" only when the house wrote last, it left, no one waits, and 72 h have passed', async () => {
    mount('owner');
    const rows = await screen.findAllByTestId('mail-person');
    const chip = (r: HTMLElement) => within(r).queryByTestId('mail-no-answer')?.textContent ?? null;
    expect(rows.map(chip)).toEqual(['No answer · 4 days', null, null, null, null, null, 'No answer · 3 days']);
  });

  it('counts elapsed time, never the house calendar, so a house with no time zone still counts', () => {
    const row = { lastDirection: 'outbound' as const, waiting: false, unsentStatus: null, awaitingSince: ago(72 + 0.5) };
    expect(noAnswerWords(row, NOW)).toBe('No answer · 3 days');
    expect(noAnswerWords({ ...row, awaitingSince: ago(71.9) }, NOW)).toBeNull();
    expect(noAnswerWords({ ...row, awaitingSince: 'not a time' }, NOW)).toBeNull();
  });
});

describe('the "No answer yet" chip', () => {
  it('sits beside "Waiting on you" for an owner and asks the list for awaiting=1', async () => {
    awaitingPeople = [person(1, {})];
    mount('manager');
    const group = await screen.findByRole('group', { name: 'Show' });
    const chips = within(group).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['All', 'Waiting on you', 'No answer yet']);
    await screen.findAllByTestId('mail-person');
    expect(peopleCalls.every((p) => p.awaiting === undefined)).toBe(true);
    fireEvent.click(within(group).getByRole('button', { name: 'No answer yet' }));
    await waitFor(() => expect(peopleCalls.some((p) => p.awaiting === '1')).toBe(true));
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    expect(within(group).getByRole('button', { name: 'No answer yet' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    // No count is tallied on the chip.
    expect(within(group).getByRole('button', { name: 'No answer yet' }).textContent).toBe('No answer yet');
  });

  it('says plainly when every letter has had an answer', async () => {
    mount('owner');
    fireEvent.click(await screen.findByRole('button', { name: 'No answer yet' }));
    expect(await screen.findByTestId('people-empty-awaiting')).toHaveTextContent(
      'Every letter the house sent has had an answer, or is less than 3 days old.',
    );
  });

  it('is not offered to staff, who never ask for it', async () => {
    mount('staff');
    const group = await screen.findByRole('group', { name: 'Show' });
    expect(within(group).queryByRole('button', { name: 'No answer yet' })).toBeNull();
    await screen.findAllByTestId('mail-person');
    expect(peopleCalls.some((p) => p.awaiting !== undefined)).toBe(false);
  });

  it('changes colour in one 160 ms step, and not at all under reduced motion', () => {
    expect(MAIL_MOTION_CSS).toMatch(/\.mail-chip \{ transition: background-color 160ms[^}]*\}/);
    const reduced = MAIL_MOTION_CSS.slice(MAIL_MOTION_CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.mail-chip \{ transition: none !important \}/);
  });
});
