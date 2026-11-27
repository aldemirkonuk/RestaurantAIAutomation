import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'house-1', user: { restaurantId: 'house-1', role: 'owner' } }),
}));

import { useMailListsFollowSummary, useMailPeople, useMailThread } from './useMailData';
import { mergePeopleHead, mergeThreadHead, mergeThreadsHead } from './mail-merge';
import type { MailPeoplePage, MailSummary, MailThreadPage, MailThreadsPage } from './mail-format';

/**
 * r104 mail-gap g4: a change on the summary reads page 1 of each open list
 * once and merges it, however many pages are loaded. Before, every loaded page
 * was read again, one after another.
 */

const SUMMARY: MailSummary = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 3,
  outToday: 1,
  inLast30: 40,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: null },
};

const person = (n: number, lastAt = `2026-11-${String(30 - n).padStart(2, '0')}T10:00:00Z`, name = `Person ${n}`) => ({
  key: `guest:p${n}@x.example`,
  kind: 'guest' as const,
  providerId: null,
  name,
  lastAt,
  lastLine: null,
  lastDirection: 'inbound' as const,
  waiting: false,
  waitingSince: null,
  openThreads: 1,
  channels: ['email'],
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
  unsentStatus: null,
});

/** Five pages of two people each: p1..p10, newest first. */
const PAGES: Record<string, MailPeoplePage> = {
  '': { people: [person(1), person(2)], next: 'c1', storedKinds: ['vendor', 'guest'] },
  c1: { people: [person(3), person(4)], next: 'c2', storedKinds: [] },
  c2: { people: [person(5), person(6)], next: 'c3', storedKinds: [] },
  c3: { people: [person(7), person(8)], next: 'c4', storedKinds: [] },
  c4: { people: [person(9), person(10)], next: null, storedKinds: [] },
};

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
}
const peopleCalls = () => api.get.mock.calls.filter((c) => c[0] === '/mail/people');

beforeEach(() => {
  api.get.mockReset();
});

describe('a moved summary reads one page, however many are loaded', () => {
  it('with 5 pages of people loaded, the mark moving makes exactly 1 request, for page 1', async () => {
    api.get.mockImplementation(async (url: string, cfg?: { params?: { after?: string } }) => ({
      data: url === '/mail/people' ? PAGES[cfg?.params?.after ?? ''] : {},
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hook = renderHook(
      ({ s }: { s: MailSummary }) => {
        useMailListsFollowSummary(s);
        return useMailPeople(false, '');
      },
      { wrapper: wrap(qc), initialProps: { s: SUMMARY } },
    );
    await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(1));
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await hook.result.current.fetchNextPage();
      });
      await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(i + 2));
    }
    expect(hook.result.current.data?.pages).toHaveLength(5);
    expect(peopleCalls()).toHaveLength(5);

    // One person writes: they land on page 1, and the rest of the pages are not asked for.
    PAGES[''] = { people: [person(11, '2026-12-01T10:00:00Z', 'Jane Roe'), person(1), person(2)], next: 'c1', storedKinds: ['vendor', 'guest'] };
    api.get.mockClear();
    hook.rerender({ s: { ...SUMMARY, inToday: 4 } });
    await waitFor(() => expect(hook.result.current.data?.pages[0].people[0].name).toBe('Jane Roe'));
    expect(peopleCalls()).toHaveLength(1);
    expect(peopleCalls()[0][1]?.params?.after).toBeUndefined();
    // Nothing loaded is lost: the 5 pages are still there, with the 10 people and the new one.
    expect(hook.result.current.data?.pages).toHaveLength(5);
    expect(hook.result.current.data?.pages.flatMap((p) => p.people)).toHaveLength(11);
  });

  it('an open thread is read once too, and a page that cannot be merged is read whole', async () => {
    const letter = (id: string) => ({ id, text: id }) as never;
    api.get.mockImplementation(async (url: string, cfg?: { params?: { before?: string } }) => ({
      data:
        url === '/mail/thread'
          ? cfg?.params?.before
            ? { key: 'gm:1', subject: 's', person: null, order: null, messages: [letter('a'), letter('b')], before: null }
            : { key: 'gm:1', subject: 's', person: null, order: null, messages: [letter('c'), letter('d')], before: 'b' }
          : {},
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hook = renderHook(
      ({ s }: { s: MailSummary }) => {
        useMailListsFollowSummary(s);
        return useMailThread('gm:1');
      },
      { wrapper: wrap(qc), initialProps: { s: SUMMARY } },
    );
    await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(1));
    await act(async () => {
      await hook.result.current.fetchNextPage();
    });
    await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
    api.get.mockImplementation(async (url: string) => ({
      data: url === '/mail/thread' ? { key: 'gm:1', subject: 's', person: null, order: null, messages: [letter('c'), letter('d'), letter('e')], before: 'b' } : {},
    }));
    api.get.mockClear();
    hook.rerender({ s: { ...SUMMARY, inToday: 4 } });
    await waitFor(() => expect(hook.result.current.data?.pages[0].messages.map((m) => m.id)).toEqual(['c', 'd', 'e']));
    expect(api.get.mock.calls.filter((c) => c[0] === '/mail/thread')).toHaveLength(1);
    expect(hook.result.current.data?.pages).toHaveLength(2);
  });
});

describe('merging page 1 into the pages held', () => {
  const held = (pages: MailPeoplePage[]) => ({ pages, pageParams: pages.map(() => null) });

  it('a new person lands on top; a row of the same age updates in place, with no reorder', () => {
    const cur = held([
      { people: [person(1), person(2)], next: 'c1', storedKinds: [] },
      { people: [person(3)], next: null, storedKinds: [] },
    ]);
    const fresh: MailPeoplePage = {
      people: [person(9, '2026-12-01T10:00:00Z'), person(1, person(1).lastAt, 'Jane Roe'), person(2)],
      next: 'c1',
      storedKinds: ['vendor', 'guest'],
    };
    const out = mergePeopleHead(cur, fresh);
    expect(out.pages[0].people.map((p) => p.key)).toEqual(['guest:p9@x.example', 'guest:p1@x.example', 'guest:p2@x.example']);
    expect(out.pages[0].people[1].name).toBe('Jane Roe');
    expect(out.pages[1].people.map((p) => p.key)).toEqual(['guest:p3@x.example']);
    expect(out.pages[0].storedKinds).toEqual(['vendor', 'guest']);
    // Cursors are the held pages' own.
    expect(out.pages.map((p) => p.next)).toEqual(['c1', null]);
  });

  it('a person deep in the list who wrote again moves to the top, once', () => {
    const cur = held([
      { people: [person(1), person(2)], next: 'c1', storedKinds: [] },
      { people: [person(3), person(4)], next: null, storedKinds: [] },
    ]);
    const out = mergePeopleHead(cur, { people: [person(4, '2026-12-01T10:00:00Z'), person(1), person(2)], next: 'c1', storedKinds: [] });
    expect(out.pages.flatMap((p) => p.people.map((x) => x.key))).toEqual(
      ['guest:p4@x.example', 'guest:p1@x.example', 'guest:p2@x.example', 'guest:p3@x.example'],
    );
  });

  it("a person's threads merge the same way", () => {
    const t = (k: string, lastAt: string) => ({ key: k, subject: k, messageCount: 1, letterCount: 1, lastAt, lastDirection: 'inbound' as const, waiting: false, orderId: null, orderNumber: null });
    const cur = { pages: [{ person: null, threads: [t('a', '2026-11-01T00:00:00Z')], next: null } as MailThreadsPage], pageParams: [null] };
    const out = mergeThreadsHead(cur, { person: null, threads: [t('n', '2026-11-02T00:00:00Z'), t('a', '2026-11-01T00:00:00Z')], next: null });
    expect(out.pages[0].threads.map((x) => x.key)).toEqual(['n', 'a']);
  });

  it('an open thread joins what arrived to what is held, and says so when there is a gap', () => {
    const m = (id: string) => ({ id }) as never;
    const page = (ids: string[], before: string | null) => ({ key: 'k', subject: null, person: null, order: null, messages: ids.map(m), before }) as MailThreadPage;
    const cur = { pages: [page(['b', 'c'], 'a')], pageParams: [null] };
    expect(mergeThreadHead(cur, page(['c', 'd'], 'b'))?.pages[0].messages.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect(mergeThreadHead(cur, page(['c', 'd'], 'b'))?.pages[0].before).toBe('a');
    expect(mergeThreadHead(cur, page(['x', 'y'], 'w'))).toBeNull();
  });
});
