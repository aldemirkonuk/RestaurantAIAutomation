/**
 * The transport contract, which is the whole reason this page was rebuilt.
 *
 * `/recommendations` shipped six raw `fetch` calls with no Authorization
 * header against a controller class-guarded on 2026-08-24 — every request
 * 401'd and the page could not draw one card (page note §10). Nothing caught
 * it, because no test asserted WHICH client the page used. This does:
 *
 *  1. every read goes through `apiClient` (bearer + X-Restaurant-Id stamped
 *     synchronously by its request interceptor);
 *  2. `fetch` is never touched;
 *  3. a 401 is a distinguishable fact, not "request failed";
 *  4. a tenant switch never leaves the previous restaurant's entries painted.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const auth = vi.hoisted(() => ({ rid: 'r1' as string | null }));
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const role = vi.hoisted(() => ({ current: null as string | null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid, activeRole: role.current }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/services/api/team', () => ({ getTeamMembers: vi.fn(async () => []) }));

import { useRecommendationsNextData } from './useRecommendationsNextData';

const FEED = {
  recommendations: [
    {
      ruleKey: 'stockout_imminent',
      observation: 'Chablis 2021 runs out in 3 days at the current pace.',
      recommendation: 'Draft a PO to the distributor today.',
      rationale: 'Lead time is 2 days; the cover is gone before the case lands.',
      category: 'inventory',
      urgency: 'now',
      score: 3,
    },
  ],
  rulesEvaluated: 17,
  generatedAt: '2026-09-02T19:04:00.000Z',
  stateCounts: { active: 1, snoozed: 2, dismissed: 3, done: 4 },
};

beforeEach(() => {
  auth.rid = 'r1';
  role.current = null;
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url.includes('/digest')) return { data: { digestEnabled: false, digestHour: 7 } };
    if (url.includes('/exclusions'))
      return { data: { items: [], readable: true, problem: null } };
    return { data: FEED };
  });
});

describe('useRecommendationsNextData transport', () => {
  it('reads the feed through the authenticated apiClient and never through fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(api.get).toHaveBeenCalledWith('/analytics/recommendations/r1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.rulesEvaluated).toBe(17);
    expect(result.current.counts).toEqual({ active: 1, snoozed: 2, dismissed: 3, done: 4 });
    // the stake axis is derived from the rule's own category, not invented
    expect(result.current.entries[0].stake).toBe('stock');
    // nothing has touched this entry, so "how long it has stood" is unknown
    expect(result.current.entries[0].updatedAt).toBeNull();
    expect(result.current.entries[0].firstSeenAt).toBeNull();
    fetchSpy.mockRestore();
  });

  it('reads the exclusion store through apiClient, keyed by tenant', async () => {
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.exclusions).toBeDefined());
    expect(api.get).toHaveBeenCalledWith('/analytics/exclusions/r1');
    expect(result.current.exclusions?.readable).toBe(true);
  });

  it('an unreadable exclusion store is NOT an empty one', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/exclusions')) throw { response: { status: 500 }, message: 'no table' };
      if (url.includes('/digest')) return { data: null };
      return { data: FEED };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.exclusions).toBeDefined());
    expect(result.current.exclusions).toEqual({
      items: [],
      readable: false,
      problem: 'no table',
    });
    // …and the book itself still read.
    expect(result.current.phase).toBe('ready');
  });

  it('a feed with no suppression fields is not reported as honoured', async () => {
    // An older gateway that has never heard of dismissal scopes must not have
    // its silence read as "your dismissals were applied".
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.suppressionsReadable).toBe(false);
  });

  it('dismisses at the key the gateway supplied, and excludes the day separately', async () => {
    api.post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.dismiss(result.current.entries[0], {
        reason: 'not_relevant',
        scope: 'insight',
        key: 'stockout_imminent#chablis-2021#d:2026-09-02',
        excludeDate: '2026-09-02',
        said: 'Dismissed.',
      });
    });

    expect(api.post).toHaveBeenCalledWith(
      '/analytics/recommendations/r1/action',
      expect.objectContaining({
        ruleKey: 'stockout_imminent#chablis-2021#d:2026-09-02',
        status: 'dismissed',
        reason: 'not_relevant',
      }),
    );
    // The exclusion is a SEPARATE store and a separate write.
    expect(api.post).toHaveBeenCalledWith(
      '/analytics/exclusions/r1',
      expect.objectContaining({ businessDate: '2026-09-02' }),
    );
    expect(result.current.entries).toHaveLength(0);
  });

  it('says so when the entry was dismissed but the day could not be excluded', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url.includes('/exclusions')) throw new Error('no table');
      return { data: {} };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.dismiss(result.current.entries[0], {
        reason: 'not_relevant',
        scope: 'rule',
        key: 'stockout_imminent',
        excludeDate: '2026-09-02',
        said: 'Dismissed.',
      });
    });
    expect(result.current.note).toContain('could NOT be excluded');
  });

  it('writes a disposition through apiClient with the rule key and a snapshot', async () => {
    api.post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.setDisposition(
        result.current.entries[0],
        { status: 'dismissed', reason: 'not_now' },
        'Dismissed.',
        true,
      );
    });
    expect(api.post).toHaveBeenCalledWith(
      '/analytics/recommendations/r1/action',
      expect.objectContaining({ ruleKey: 'stockout_imminent', status: 'dismissed' }),
    );
  });

  it('tells a 401 apart from any other failure', async () => {
    api.get.mockRejectedValue({ response: { status: 401 }, message: 'Request failed' });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.failure?.expired).toBe(true);
    expect(result.current.failure?.forbidden).toBe(false);
    expect(result.current.entries).toEqual([]);
  });

  it('drops the previous tenant’s entries the moment the restaurant changes', async () => {
    const { result, rerender } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    let release: (v: unknown) => void = () => {};
    // Only the FEED read is held open — the digest, the exclusion list, the
    // goal list and the till window are separate reads and must not be the
    // thing this test resolves.
    api.get.mockImplementation((url: string) => {
      if (url.includes('/digest')) return Promise.resolve({ data: null });
      if (url.includes('/exclusions'))
        return Promise.resolve({ data: { items: [], readable: true, problem: null } });
      if (url.includes('/analytics/goals/')) return Promise.resolve({ data: [] });
      if (url.includes('/pos-revenue/'))
        return Promise.resolve({ data: { posConnected: false, dailySeries: [] } });
      return new Promise((res) => {
        release = res;
      });
    });
    auth.rid = 'r2';
    rerender();
    await waitFor(() => expect(result.current.entries).toHaveLength(0));
    expect(result.current.phase).toBe('loading');

    await act(async () => {
      release({ data: { ...FEED, recommendations: [] } });
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(api.get).toHaveBeenCalledWith('/analytics/recommendations/r2');
  });
});

/**
 * Fourth pass — the goal door's transport.
 *
 * The write is a real `POST /analytics/goals/:rid` (curl-verified against the
 * local gateway on 2026-09-03: 201 on a good body, 400 "Unsupported metric …"
 * and 400 "targetValue must be > 0" on the two bad ones). What these pin is
 * that the page reaches it through the authenticated client, reads the list
 * lazily and per tenant, hands back the gateway's own refusal rather than a
 * generic one, and never claims a goal was set when it was not.
 */
describe('useRecommendationsNextData — goals', () => {
  it('reads the goal list for the tenant, through apiClient, without being asked', async () => {
    // The rework made this read EAGER. It was lazy while its only use was a
    // duplicate warning inside a sheet; since `source_rule_key` a goal is a
    // fact about an entry — "this one is being watched" — and an entry cannot
    // wait for someone to open a sheet before it tells the truth about itself.
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/analytics/goals/'))
        return {
          data: [
            {
              id: 'g0',
              name: 'September wine push',
              metric_key: 'wine_revenue',
              // PostgREST hands numerics back as strings often enough that the
              // reader must parse rather than trust the type.
              target_value: '4000.00',
              current_value: '1200.00',
              deadline: '2026-09-30',
              status: 'active',
            },
          ],
        };
      if (url.includes('/digest')) return { data: null };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      return { data: FEED };
    });

    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(api.get).toHaveBeenCalledWith('/analytics/goals/r1?status=active');
    await waitFor(() => expect(Array.isArray(result.current.goals)).toBe(true));
    expect(result.current.goals?.[0]).toEqual({
      id: 'g0',
      name: 'September wine push',
      metricKey: 'wine_revenue',
      targetValue: 4000,
      currentValue: 1200,
      deadline: '2026-09-30',
      status: 'active',
      // A goal a person typed records no source. NULL is "set by hand", and it
      // must never be read as "unknown" or filled in from the metric.
      sourceRuleKey: null,
    });
  });

  it('reads a goal’s source rule back, so an entry can say it is being watched', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/analytics/goals/'))
        return {
          data: [
            {
              id: 'g1',
              name: 'Hold purchasing spend',
              metric_key: 'purchase_spend',
              target_value: '9000.00',
              current_value: '4000.00',
              deadline: '2026-09-10',
              status: 'active',
              source_rule_key: 'spend_acceleration',
            },
          ],
        };
      if (url.includes('/digest')) return { data: null };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      return { data: FEED };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(Array.isArray(result.current.goals)).toBe(true));
    expect(result.current.goals?.[0].sourceRuleKey).toBe('spend_acceleration');
  });

  it('reads the till window and keeps its daily series SPARSE — an absent day is not a zero', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/pos-revenue/'))
        return {
          data: {
            posConnected: true,
            from: '2026-08-13',
            to: '2026-09-03',
            dailySeries: [{ date: '2026-08-14', revenue: 612 }],
          },
        };
      if (url.includes('/analytics/goals/')) return { data: [] };
      if (url.includes('/digest')) return { data: null };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      return { data: FEED };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.pos).toBeTruthy());
    // 31 on arrival — the longest a calendar month can be, so the first
    // render of the current month never has to ask twice. The page raises it
    // when the ribbon is walked back to an earlier month (`posDaysFor`).
    expect(api.get).toHaveBeenCalledWith('/analytics/pos-revenue/r1?days=31');
    expect(result.current.pos?.connected).toBe(true);
    // Exactly one key. Every other day in the window is ABSENT from the map,
    // which is how the ribbon can hatch it instead of drawing a bar of zero.
    expect(Object.keys(result.current.pos?.byDay ?? {})).toEqual(['2026-08-14']);
  });

  it('an unreadable till window is null with the reason, never an empty one', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/pos-revenue/'))
        throw { response: { status: 500, data: { message: 'Failed to load POS revenue' } } };
      if (url.includes('/analytics/goals/')) return { data: [] };
      if (url.includes('/digest')) return { data: null };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      return { data: FEED };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.pos).toBeNull());
    expect(result.current.posProblem).toBe('Failed to load POS revenue');
  });

  it('an unreadable goal list is null, not an empty list', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/analytics/goals/')) throw { response: { status: 500 }, message: 'boom' };
      if (url.includes('/digest')) return { data: null };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      return { data: FEED };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.goals).toBeNull());
    // Null, not []. An empty array would tell every entry "no goal watches you",
    // which is a claim; null says the page does not know.
    expect(result.current.goals).not.toEqual([]);
  });

  it('posts a goal through apiClient and says so in words', async () => {
    api.post.mockResolvedValue({
      data: {
        id: 'g9',
        name: 'Wednesday wine revenue back to baseline',
        metric_key: 'wine_revenue',
        target_value: 2500,
        current_value: 0,
        deadline: '2026-09-10',
        status: 'active',
      },
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    let answer: unknown;
    await act(async () => {
      answer = await result.current.createGoal({
        name: 'Wednesday wine revenue back to baseline',
        metricKey: 'wine_revenue',
        targetValue: 2500,
        direction: 'at_least',
        period: 'week',
        deadline: '2026-09-10',
      });
    });
    expect(api.post).toHaveBeenCalledWith('/analytics/goals/r1', {
      name: 'Wednesday wine revenue back to baseline',
      metricKey: 'wine_revenue',
      targetValue: 2500,
      direction: 'at_least',
      period: 'week',
      deadline: '2026-09-10',
    });
    expect((answer as { ok: boolean }).ok).toBe(true);
    expect(result.current.note).toMatch(/Goal set/);
  });

  it("hands back the gateway's own 400, and never claims the goal was set", async () => {
    api.post.mockRejectedValue({
      response: { status: 400, data: { message: 'targetValue must be > 0' } },
      message: 'Request failed with status code 400',
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    let answer: { ok: boolean; message?: string } = { ok: true };
    await act(async () => {
      answer = (await result.current.createGoal({
        name: 'x',
        metricKey: 'wine_revenue',
        targetValue: 0,
        direction: 'at_least',
        period: 'week',
        deadline: '2026-09-10',
      })) as { ok: boolean; message?: string };
    });
    expect(answer.ok).toBe(false);
    expect(answer.message).toBe('targetValue must be > 0');
    expect(result.current.note).toBe('No goal was set (targetValue must be > 0).');
  });

  it('a restaurant switch drops the previous house’s goals', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/analytics/goals/'))
        return { data: [{ id: 'g0', name: 'theirs', metric_key: 'checks', status: 'active' }] };
      if (url.includes('/digest')) return { data: null };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      return { data: FEED };
    });
    const { result, rerender } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.loadGoals());
    await waitFor(() => expect(result.current.goals).toHaveLength(1));

    auth.rid = 'r2';
    rerender();
    await waitFor(() => expect(result.current.goals).toBeUndefined());
  });
});

/*
 * ADR 0191, the founder's answers of 2026-09-21: one shared per-item state,
 * and rule-wide acts that are owner/manager only and audited. The hook is
 * where the page's words about a write come from, so the receipts are here.
 */
describe('useRecommendationsNextData — the shared state and the house log', () => {
  it('writes a snooze at the key it is given, and offers the undo at that key', async () => {
    api.post.mockResolvedValue({ data: { audit: null } });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    const LATER = new Date(Date.now() + 86_400_000).toISOString();
    await act(async () => {
      await result.current.setDisposition(
        result.current.entries[0],
        { status: 'snoozed', snoozeUntil: LATER },
        'Snoozed until tomorrow.',
        true,
        'stockout_imminent#chablis-2021#*',
      );
    });
    expect(api.post).toHaveBeenCalledWith(
      '/analytics/recommendations/r1/action',
      expect.objectContaining({ ruleKey: 'stockout_imminent#chablis-2021#*', status: 'snoozed' }),
    );
    expect(result.current.undo?.ruleKey).toBe('stockout_imminent#chablis-2021#*');
  });

  it('says so when a whole-rule write held but its house-log row did not', async () => {
    api.post.mockResolvedValue({
      data: { audit: { recorded: false, reason: 'permission denied' } },
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.restore('stockout_imminent');
    });
    expect(result.current.note).toMatch(/not written to the house log \(permission denied\)/);
  });

  it('a bulk write that stored fewer than it was sent says how many, never the full count', async () => {
    api.post.mockResolvedValue({ data: { updated: 0, audit: { recorded: 0, missed: 0 } } });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.bulk(
        result.current.entries,
        { status: 'snoozed', snoozeUntil: new Date(Date.now() + 86_400_000).toISOString() },
        'Snoozed 1 entries for a week.',
        true,
      );
    });
    expect(result.current.note).toMatch(/Only 0 of 1 were saved/);
  });

  it('staff may not act rule-wide, nor may the platform admin (round 4, answer 7); an owner or a manager may', async () => {
    const { result, rerender } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.canActRuleWide).toBe(false);
    for (const r of ['staff', 'admin']) {
      role.current = r;
      rerender();
      expect(result.current.canActRuleWide).toBe(false);
    }
    for (const r of ['owner', 'manager']) {
      role.current = r;
      rerender();
      expect(result.current.canActRuleWide).toBe(true);
    }
  });

  it("reads the gateway's undoableByYou off a tab row — only a boolean counts (round 4, answer 5)", async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/digest')) return { data: { digestEnabled: false, digestHour: 7 } };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      if (url.includes('/actions'))
        return {
          data: {
            items: [
              { ruleKey: 'a#*#fire:week:2026-W39', status: 'dismissed', undoableByYou: false },
              { ruleKey: 'b#*#fire:week:2026-W39', status: 'dismissed', undoableByYou: true },
              { ruleKey: 'c#*#fire:week:2026-W39', status: 'dismissed', undoableByYou: null },
              { ruleKey: 'd#*#fire:week:2026-W39', status: 'dismissed', undoableByYou: 'no' },
            ],
          },
        };
      return { data: FEED };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.setLeaf('dismissed'));
    await waitFor(() => expect(result.current.entries).toHaveLength(4));
    expect(result.current.entries.map((e) => e.undoableByYou)).toEqual([
      false,
      true,
      null,
      null,
    ]);
  });

  it('reads the gateway\'s own "this row is a whole rule" off an actions row', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('/digest')) return { data: { digestEnabled: false, digestHour: 7 } };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      if (url.includes('/actions'))
        return {
          data: {
            items: [
              { ruleKey: 'stockout_imminent', status: 'dismissed', ruleWide: true },
              { ruleKey: 'staff_spread#ada#*', status: 'dismissed', ruleWide: false },
            ],
          },
        };
      return { data: FEED };
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.setLeaf('dismissed'));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.entries.map((e) => e.ruleWide)).toEqual([true, false]);
  });
});

/**
 * ADR 0191 round 3 (founder, 2026-09-21): a staff snooze is "Only them" —
 * the person's own snoozes are counted to them, listed on their Snoozed leaf,
 * woken there, and an unreadable list of them is said; every house act is
 * kept in the history, and a history row that missed is said.
 */
describe('useRecommendationsNextData — round 3, the person’s own snoozes', () => {
  function serveWith(extra: (url: string) => unknown | undefined) {
    api.get.mockImplementation(async (url: string) => {
      const hit = extra(url);
      if (hit !== undefined) {
        if (hit instanceof Error) throw hit;
        return { data: hit };
      }
      if (url.includes('/digest')) return { data: { digestEnabled: false, digestHour: 7 } };
      if (url.includes('/exclusions'))
        return { data: { items: [], readable: true, problem: null } };
      return { data: FEED };
    });
  }

  it('reads how many are hidden just for this person, and only a true read counts', async () => {
    serveWith((url) =>
      url === '/analytics/recommendations/r1'
        ? { ...FEED, hiddenForYou: 2, personalSnoozesReadable: true }
        : undefined,
    );
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.hiddenForYou).toBe(2);
    expect(result.current.personalSnoozesReadable).toBe(true);
  });

  it('an older gateway that sends no flag is never read as "your snoozes were read"', async () => {
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.personalSnoozesReadable).toBe(false);
  });

  it('the Snoozed leaf lists the house’s snoozes and this person’s own, marked personal', async () => {
    serveWith((url) => {
      if (url.includes('/snoozed-for-me'))
        return {
          items: [{ ruleKey: 'vendor_concentration#*#fire:month:2026-09', snoozeUntil: '2026-09-28T00:00:00.000Z', observation: 'Mine.' }],
        };
      if (url.includes('/actions?status=snoozed'))
        return { items: [{ ruleKey: 'staff_spread#ada#*', status: 'snoozed' }] };
      return undefined;
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.setLeaf('snoozed'));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.entries.map((e) => [e.ruleKey, !!e.personal])).toEqual([
      ['vendor_concentration#*#fire:month:2026-09', true],
      ['staff_spread#ada#*', false],
    ]);
    expect(result.current.personalProblem).toBeNull();
  });

  it('when this person’s own snoozes cannot be read, the leaf says so and still lists the house’s', async () => {
    serveWith((url) => {
      if (url.includes('/snoozed-for-me'))
        return Object.assign(new Error('timeout'), { response: { status: 500, data: { message: 'timeout' } } });
      if (url.includes('/actions?status=snoozed'))
        return { items: [{ ruleKey: 'staff_spread#ada#*', status: 'snoozed' }] };
      return undefined;
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.setLeaf('snoozed'));
    await waitFor(() => expect(result.current.personalProblem).toBe('timeout'));
    expect(result.current.entries.map((e) => e.ruleKey)).toEqual(['staff_spread#ada#*']);
  });

  it('wakes a card for this person through the wake route', async () => {
    api.post.mockResolvedValue({ data: { woke: true } });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.wake('vendor_concentration#*#fire:month:2026-09');
    });
    expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/snoozed-for-me/wake', {
      ruleKey: 'vendor_concentration#*#fire:month:2026-09',
    });
    expect(result.current.note).toBe('Back in your standing book.');
  });

  it('a write that became the person’s own snooze offers an undo that wakes it', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'snoozed_for_you', audit: null, history: null } });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.setDisposition(
        result.current.entries[0],
        { status: 'snoozed', snoozeFor: 'me', snoozeUntil: new Date(Date.now() + 86_400_000).toISOString() },
        'Snoozed until tomorrow, for you alone.',
        true,
        'stockout_imminent#*#fire:day:2026-09-21',
      );
    });
    expect(result.current.undo).toEqual({
      ruleKey: 'stockout_imminent#*#fire:day:2026-09-21',
      label: 'Snoozed until tomorrow, for you alone.',
      personal: true,
    });
  });

  it('says so when a house act held but its history row did not', async () => {
    api.post.mockResolvedValue({
      data: { audit: null, history: { recorded: false, reason: 'timeout' } },
    });
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.setDisposition(
        result.current.entries[0],
        { status: 'done' },
        'Ruled off, and sealed.',
        true,
        'stockout_imminent#*#fire:day:2026-09-21',
      );
    });
    expect(result.current.note).toMatch(/Saved, but not kept in the history \(timeout\)/);
  });

  it('snooze for everyone: owners and managers only', async () => {
    const { result, rerender } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    role.current = 'staff';
    rerender();
    expect(result.current.canSnoozeForEveryone).toBe(false);
    for (const r of ['owner', 'manager']) {
      role.current = r;
      rerender();
      expect(result.current.canSnoozeForEveryone).toBe(true);
    }
  });
});
