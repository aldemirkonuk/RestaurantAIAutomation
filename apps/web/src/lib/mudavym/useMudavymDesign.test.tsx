import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: vi.fn() },
}));

import { settingsApi } from '../../services/api/settings';
import {
  ALWAYS_ON_PAGES,
  MUDAVYM_PAGES,
  clearMudavymDesignCache,
  useMudavymDesign,
} from './useMudavymDesign';

const checkFlag = vi.mocked(settingsApi.checkFeatureFlag);

function checkResult(enabled: boolean, active: boolean) {
  return { enabled, active, feature_name: 'mudavym_design_dashboard', restaurant_id: 'r1' };
}

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  checkFlag.mockReset();
});

describe('useMudavymDesign precedence', () => {
  it('localStorage override "1"/"true"/"on" wins without spending a request', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(false, true));
    for (const value of ['1', 'true', 'on']) {
      window.localStorage.setItem('mudavym.design.dashboard', value);
      const { result, unmount } = renderHook(() => useMudavymDesign('dashboard'));
      expect(result.current).toBe(true);
      unmount();
    }
    await act(async () => {});
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('localStorage override "0"/"off" forces legacy even when the server flag is on', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    window.localStorage.setItem('mudavym.design.dashboard', 'off');
    checkFlag.mockResolvedValue(checkResult(true, true));
    const { result } = renderHook(() => useMudavymDesign('dashboard'));
    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('without an override, an active+enabled server flag turns the page on', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(true, true));
    const { result } = renderHook(() => useMudavymDesign('dashboard'));
    expect(result.current).toBe(false); // legacy while the check is in flight
    await waitFor(() => expect(result.current).toBe(true));
    expect(checkFlag).toHaveBeenCalledWith('r1', 'mudavym_design_dashboard');
  });

  it('an inactive flag (unregistered in the gateway) stays legacy', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(true, false));
    const { result } = renderHook(() => useMudavymDesign('dashboard'));
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('an API failure stays legacy rather than breaking the page', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMudavymDesign('dashboard'));
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('no active restaurant → legacy, no request', async () => {
    const { result } = renderHook(() => useMudavymDesign('dashboard'));
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('MUDAVYM_PAGES seeds the two page-team pages', () => {
    expect(MUDAVYM_PAGES).toContain('dashboard');
    expect(MUDAVYM_PAGES).toContain('orders');
  });
});

/**
 * ALWAYS_ON_PAGES — the real module, no mock of `useMudavymDesign` itself
 * (only its network dependency, `settingsApi`, above). Round-2 verifier's
 * blocking finding (r4-lanes.json, "settings" lane): this file never once
 * called `useMudavymDesign('settings')`, so `ALWAYS_ON_PAGES`'s two
 * short-circuits — the render-time `if (alwaysOn) return true` and the
 * effect's `if (alwaysOn) return` — and `'settings'`'s membership in the set
 * were all unexercised by any test. `SettingsNext.test.tsx` mocks this whole
 * module with its own literal `Set(['settings'])`, so it could not have
 * caught a real regression here either.
 *
 * Mutation results (self-verified, each applied alone then reverted):
 *  - deleting `if (alwaysOn) return true;` (useMudavymDesign.ts:184) — FAILS
 *    "settings resolves true with no restaurant known" and "…never spends a
 *    request even once a restaurant is known" (both assert `result.current
 *    === true`).
 *  - deleting the effect's `if (alwaysOn) return;` (useMudavymDesign.ts:161)
 *    — FAILS "…never spends a request even once a restaurant is known"
 *    (`checkFlag` gets called).
 *  - removing `'settings'` from `ALWAYS_ON_PAGES` (useMudavymDesign.ts:140)
 *    — FAILS both of the above, plus "a localStorage override still wins
 *    over an always-on page" no longer exercises the fork it names (the page
 *    is no longer always-on to override), making the intent of that test
 *    silently vacuous rather than merely wrong — the clearest sign this is
 *    the one mutation a passing suite could still hide.
 */
describe('useMudavymDesign — ALWAYS_ON_PAGES ("settings")', () => {
  it('settings resolves true with no restaurant known, and never fetches', async () => {
    // No activeRestaurantId anywhere — the case a fresh session/tab starts in.
    const { result } = renderHook(() => useMudavymDesign('settings'));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(result.current).toBe(true);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('settings stays true and never spends a request even once a restaurant is known', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    // A safe resolution in case a mutation reopens the fetch path this test
    // exists to refuse — the assertions below still fail either way, but the
    // hook must not throw on its way to failing them.
    checkFlag.mockResolvedValue(checkResult(false, false));
    const { result } = renderHook(() => useMudavymDesign('settings'));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(result.current).toBe(true);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('a page outside the set (contrast: "orders") still reads its own flag', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue({ enabled: true, active: true, feature_name: 'mudavym_design_orders', restaurant_id: 'r1' });
    const { result } = renderHook(() => useMudavymDesign('orders'));
    expect(result.current).toBe(false); // legacy while the check is in flight — 'orders' is NOT always-on
    await waitFor(() => expect(result.current).toBe(true));
    expect(checkFlag).toHaveBeenCalledWith('r1', 'mudavym_design_orders');
  });

  it('a localStorage override still wins over an always-on page', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    window.localStorage.setItem('mudavym.design.settings', 'off');
    const { result } = renderHook(() => useMudavymDesign('settings'));
    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('ALWAYS_ON_PAGES names settings', () => {
    expect(ALWAYS_ON_PAGES.has('settings')).toBe(true);
  });
});
