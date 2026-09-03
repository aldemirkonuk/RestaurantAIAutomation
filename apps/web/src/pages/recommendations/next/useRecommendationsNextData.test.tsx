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
  api.get.mockImplementation(async (url: string) =>
    url.includes('/digest') ? { data: { digestEnabled: false, digestHour: 7 } } : { data: FEED },
  );
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
    fetchSpy.mockRestore();
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
    api.get.mockImplementation(
      (url: string) =>
        url.includes('/digest')
          ? Promise.resolve({ data: null })
          : new Promise((res) => {
              release = res;
            }),
    );
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
