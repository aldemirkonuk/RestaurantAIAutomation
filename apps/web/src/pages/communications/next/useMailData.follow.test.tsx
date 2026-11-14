import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const house = vi.hoisted(() => ({ current: 'house-1' }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: house.current, user: { restaurantId: house.current, role: 'owner' } }),
}));

import {
  MAIL_LIST_FALLBACK_MS,
  MAIL_POLL_MS,
  mailChangeMark,
  useMailListsFollowSummary,
  useMailPeople,
  useMailSummary,
  useMailThread,
  useMailThreads,
} from './useMailData';
import type { MailSummary } from './mail-format';

/**
 * r41 mail audit, gaps 4 and 5: every 30 s the people list, a person's threads
 * and an open thread were each read again, every loaded page one after
 * another, and a held search re-ran over every letter, while nothing had
 * moved. Now only the summary polls; the lists follow it.
 */

const SUMMARY: MailSummary = {
  waitingPeople: 2,
  oldestWaitAt: '2026-11-13T09:00:00Z',
  inToday: 3,
  outToday: 1,
  inLast30: 40,
  heldAtDoor: null,
  doors: {
    houseMailbox: { lastStoredAt: '2026-11-14T08:00:00Z' },
    whatsapp: { lastStoredAt: null },
    mudavymMail: { lastStoredAt: '2026-11-14T07:00:00Z' },
  },
  address: { configured: true, address: null },
};

describe('mailChangeMark', () => {
  it('is null before the summary is read', () => {
    expect(mailChangeMark(undefined)).toBeNull();
    expect(mailChangeMark(null)).toBeNull();
  });

  it('is the same for the same numbers in a new object', () => {
    expect(mailChangeMark({ ...SUMMARY, doors: { ...SUMMARY.doors } })).toBe(mailChangeMark(SUMMARY));
  });

  it('does not move for what no list shows: the address', () => {
    expect(mailChangeMark({ ...SUMMARY, address: { configured: false, address: 'x@y' } })).toBe(mailChangeMark(SUMMARY));
  });

  const moves: Array<[string, MailSummary]> = [
    ['who is waiting', { ...SUMMARY, waitingPeople: 3 }],
    ['since when', { ...SUMMARY, oldestWaitAt: '2026-11-12T09:00:00Z' }],
    ['letters in today', { ...SUMMARY, inToday: 4 }],
    ['letters out today', { ...SUMMARY, outToday: 2 }],
    ['letters in over 30 days', { ...SUMMARY, inLast30: 41 }],
    ['the house mailbox', { ...SUMMARY, doors: { ...SUMMARY.doors, houseMailbox: { lastStoredAt: '2026-11-14T08:05:00Z' } } }],
    ['WhatsApp', { ...SUMMARY, doors: { ...SUMMARY.doors, whatsapp: { lastStoredAt: '2026-11-14T08:05:00Z' } } }],
    ['Mudavym mail', { ...SUMMARY, doors: { ...SUMMARY.doors, mudavymMail: { lastStoredAt: '2026-11-14T08:05:00Z' } } }],
  ];
  it.each(moves)('moves with %s', (_what, moved) => {
    expect(mailChangeMark(moved)).not.toBe(mailChangeMark(SUMMARY));
  });
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useMailListsFollowSummary', () => {
  function setup() {
    const qc = client();
    const keys = [
      ['mail-people', 'house-1', false, ''],
      ['mail-people', 'house-1', true, 'süt'],
      ['mail-threads', 'house-1', 'vendor:v1'],
      ['mail-thread', 'house-1', 'gm:1'],
      ['mail-people', 'house-2', false, ''],
      ['house-letter-sender', 'house-1'],
    ];
    for (const k of keys) qc.setQueryData(k, { pages: [], pageParams: [] });
    const invalidated = (k: unknown[]) => qc.getQueryState(k)?.isInvalidated === true;
    const hook = renderHook(({ s }: { s: MailSummary | undefined }) => useMailListsFollowSummary(s), {
      wrapper: wrap(qc),
      initialProps: { s: undefined as MailSummary | undefined },
    });
    return { qc, keys, invalidated, hook };
  }

  it('the first summary read, and the same answer again, read no list', () => {
    const { keys, invalidated, hook } = setup();
    hook.rerender({ s: SUMMARY });
    hook.rerender({ s: { ...SUMMARY, doors: { ...SUMMARY.doors } } });
    for (const k of keys) expect(invalidated(k)).toBe(false);
  });

  it("a new letter at a door reads this house's people, threads and open thread again, and nothing else", () => {
    const { keys, invalidated, hook } = setup();
    hook.rerender({ s: SUMMARY });
    hook.rerender({
      s: { ...SUMMARY, doors: { ...SUMMARY.doors, houseMailbox: { lastStoredAt: '2026-11-14T08:05:00Z' } } },
    });
    expect(keys.filter(invalidated)).toEqual([
      ['mail-people', 'house-1', false, ''],
      ['mail-people', 'house-1', true, 'süt'],
      ['mail-threads', 'house-1', 'vendor:v1'],
      ['mail-thread', 'house-1', 'gm:1'],
    ]);
  });

  it('a vendor no longer waiting reads the lists again too', () => {
    const { invalidated, hook } = setup();
    hook.rerender({ s: SUMMARY });
    hook.rerender({ s: { ...SUMMARY, waitingPeople: 1 } });
    expect(invalidated(['mail-people', 'house-1', false, ''])).toBe(true);
  });

  it("switching house reads nothing: the other house's first summary is its first", () => {
    const { invalidated, hook } = setup();
    hook.rerender({ s: SUMMARY });
    house.current = 'house-2';
    try {
      hook.rerender({ s: { ...SUMMARY, waitingPeople: 9 } });
      expect(invalidated(['mail-people', 'house-2', false, ''])).toBe(false);
      expect(invalidated(['mail-people', 'house-1', false, ''])).toBe(false);
    } finally {
      house.current = 'house-1';
    }
  });

  it('a failed summary read (no data) reads nothing', () => {
    const { keys, invalidated, hook } = setup();
    hook.rerender({ s: SUMMARY });
    hook.rerender({ s: undefined });
    hook.rerender({ s: SUMMARY });
    for (const k of keys) expect(invalidated(k)).toBe(false);
  });
});

describe('the lists poll slowly; the summary polls every 30 s', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    api.get.mockReset().mockImplementation(async (url: string) => ({
      data: url === '/mail/summary' ? SUMMARY : { people: [], threads: [], letters: [], next: null, before: null },
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const calls = (url: string) => api.get.mock.calls.filter((c) => c[0] === url).length;

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('across two summary polls with nothing moving, no list is read again', async () => {
    const qc = client();
    renderHook(
      () => {
        const summary = useMailSummary(true);
        useMailListsFollowSummary(summary.data);
        useMailPeople(false, '');
        useMailThreads('vendor:v1');
        useMailThread('gm:1');
      },
      { wrapper: wrap(qc) },
    );
    await advance(0);
    expect([calls('/mail/summary'), calls('/mail/people'), calls('/mail/threads'), calls('/mail/thread')]).toEqual([1, 1, 1, 1]);
    await advance(2 * MAIL_POLL_MS + 1_000);
    expect(calls('/mail/summary')).toBe(3);
    expect([calls('/mail/people'), calls('/mail/threads'), calls('/mail/thread')]).toEqual([1, 1, 1]);
  });

  it('when a summary poll sees a new letter, each list is read once more', async () => {
    const qc = client();
    renderHook(
      () => {
        const summary = useMailSummary(true);
        useMailListsFollowSummary(summary.data);
        useMailPeople(false, '');
        useMailThreads('vendor:v1');
        useMailThread('gm:1');
      },
      { wrapper: wrap(qc) },
    );
    await advance(0);
    const moved = { ...SUMMARY, doors: { ...SUMMARY.doors, mudavymMail: { lastStoredAt: '2026-11-14T08:10:00Z' } } };
    api.get.mockImplementation(async (url: string) => ({
      data: url === '/mail/summary' ? moved : { people: [], threads: [], letters: [], next: null, before: null },
    }));
    await advance(MAIL_POLL_MS + 1_000);
    expect(calls('/mail/summary')).toBe(2);
    expect([calls('/mail/people'), calls('/mail/threads'), calls('/mail/thread')]).toEqual([2, 2, 2]);
    // The next quiet poll reads no list.
    await advance(MAIL_POLL_MS);
    expect([calls('/mail/people'), calls('/mail/threads'), calls('/mail/thread')]).toEqual([2, 2, 2]);
  });

  it('with nothing moving, a list is still read again after the fallback', async () => {
    const qc = client();
    renderHook(() => useMailPeople(false, 'süt'), { wrapper: wrap(qc) });
    await advance(0);
    expect(calls('/mail/people')).toBe(1);
    await advance(MAIL_LIST_FALLBACK_MS - 1_000);
    expect(calls('/mail/people')).toBe(1);
    await advance(2_000);
    expect(calls('/mail/people')).toBe(2);
    expect(MAIL_LIST_FALLBACK_MS).toBe(120_000);
  });
});
