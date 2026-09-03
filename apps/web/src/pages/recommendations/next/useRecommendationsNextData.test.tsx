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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid }),
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
    // Only the FEED read is held open — the digest and the exclusion list are
    // separate reads and must not be the thing this test resolves.
    api.get.mockImplementation((url: string) => {
      if (url.includes('/digest')) return Promise.resolve({ data: null });
      if (url.includes('/exclusions'))
        return Promise.resolve({ data: { items: [], readable: true, problem: null } });
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
  it('does not read goals until something asks, then reads them through apiClient', async () => {
    const { result } = renderHook(() => useRecommendationsNextData());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/analytics/goals/'));
    expect(result.current.goals).toBeUndefined();

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

    act(() => result.current.loadGoals());
    await waitFor(() => expect(Array.isArray(result.current.goals)).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/analytics/goals/r1?status=active');
    expect(result.current.goals?.[0]).toEqual({
      id: 'g0',
      name: 'September wine push',
      metricKey: 'wine_revenue',
      targetValue: 4000,
      currentValue: 1200,
      deadline: '2026-09-30',
      status: 'active',
    });
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
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.loadGoals());
    await waitFor(() => expect(result.current.goals).toBeNull());
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
