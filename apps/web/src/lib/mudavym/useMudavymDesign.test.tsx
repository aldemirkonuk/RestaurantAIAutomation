import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: vi.fn() },
}));

import { settingsApi } from '../../services/api/settings';
import {
  LIVE_PAGES,
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

  // These four exercise the FLAG path (step 3 of precedence), so — since
  // ADR 0149 row 36 (2026-09-17) resolves 'dashboard' via LIVE_PAGES without
  // ever spending a request, and settings joined LIVE_PAGES in PR #419 —
  // they run against 'cellar', a held-back page that still reads
  // restaurant_feature_flags. LIVE_PAGES' own behaviour is asserted in the
  // LIVE_PAGES describe block below.
  it('without an override, an active+enabled server flag turns the page on', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(true, true));
    const { result } = renderHook(() => useMudavymDesign('cellar'));
    expect(result.current).toBe(false); // legacy while the check is in flight
    await waitFor(() => expect(result.current).toBe(true));
    expect(checkFlag).toHaveBeenCalledWith('r1', 'mudavym_design_cellar');
  });

  it('an inactive flag (unregistered in the gateway) stays legacy', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(true, false));
    const { result } = renderHook(() => useMudavymDesign('cellar'));
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('an API failure stays legacy rather than breaking the page', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMudavymDesign('cellar'));
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('no active restaurant → legacy, no request', async () => {
    const { result } = renderHook(() => useMudavymDesign('cellar'));
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
 * ADR 0149 row 36 (2026-09-17): 16 pages go live for every house in code.
 * `settings` joined 2026-09-19 (PR #419) after its sketch review — still
 * code-side always-on, no flag read. `cellar`, `recommendations` and
 * `receiving` (the desk, not the door) stay flag-gated. `shell` (the house
 * shell, sketch 119 D, ADR 0149 row 5) is held back too: it stays behind its
 * own flag in this set (production may have flipped the column independently)
 * and is never a LIVE_PAGES entry. `arrival` (/get-started book) is held back
 * the same way — OFF until deliberately flipped.
 */
describe('LIVE_PAGES (ADR 0149 row 36, go-live 2026-09-17)', () => {
  const HELD_BACK = ['arrival', 'cellar', 'recommendations', 'receiving', 'shell'] as const;

  it('is exactly MUDAVYM_PAGES minus the five held-back pages', () => {
    const held = new Set(HELD_BACK);
    const expected = MUDAVYM_PAGES.filter((p) => !held.has(p as (typeof HELD_BACK)[number]));
    expect([...LIVE_PAGES].sort()).toEqual([...expected].sort());
    expect(LIVE_PAGES.size).toBe(18);
  });

  it('holds back exactly arrival, cellar, recommendations, receiving, shell', () => {
    for (const page of HELD_BACK) {
      expect(LIVE_PAGES.has(page)).toBe(false);
      expect(MUDAVYM_PAGES).toContain(page); // still a real page, just gated
    }
  });

  it('settings is live (always-on in code, no flag read)', () => {
    expect(LIVE_PAGES.has('settings')).toBe(true);
  });

  it.each([...LIVE_PAGES])(
    'a live page (%s) is on with no restaurant_feature_flags row (flag rejects/never resolves)',
    async (page) => {
      window.localStorage.setItem('activeRestaurantId', 'r1');
      // No row for this restaurant+flag: the gateway registry's answer for an
      // unregistered/absent flag is { enabled: false, active: false } — model
      // that, and also that the call must not even be made.
      checkFlag.mockResolvedValue(checkResult(false, false));
      const { result } = renderHook(() => useMudavymDesign(page));
      expect(result.current).toBe(true); // true on the very first render — no flash of legacy
      await act(async () => {});
      expect(result.current).toBe(true);
      expect(checkFlag).not.toHaveBeenCalled();
    },
  );

  it('a live page is on with an explicit false column too', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(false, true)); // explicit false column
    const { result } = renderHook(() => useMudavymDesign('dashboard'));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(result.current).toBe(true);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('a live page is on with no active restaurant at all', async () => {
    const { result } = renderHook(() => useMudavymDesign('orders'));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(result.current).toBe(true);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('the QA override can still force legacy on a live page', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    window.localStorage.setItem('mudavym.design.dashboard', 'off');
    const { result } = renderHook(() => useMudavymDesign('dashboard'));
    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('the QA override can force a held-back page on without a flag row', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    window.localStorage.setItem('mudavym.design.cellar', 'on');
    const { result } = renderHook(() => useMudavymDesign('cellar'));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('settings resolves true with no restaurant known, and never fetches', async () => {
    const { result } = renderHook(() => useMudavymDesign('settings'));
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(result.current).toBe(true);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it('the QA override can still force legacy on settings', async () => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    window.localStorage.setItem('mudavym.design.settings', 'off');
    const { result } = renderHook(() => useMudavymDesign('settings'));
    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(checkFlag).not.toHaveBeenCalled();
  });

  it.each(HELD_BACK)('a held-back page (%s) still follows its flag: off stays legacy', async (page) => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(false, false));
    const { result } = renderHook(() => useMudavymDesign(page));
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(checkFlag).toHaveBeenCalledWith('r1', `mudavym_design_${page}`);
  });

  it.each(HELD_BACK)('a held-back page (%s) still follows its flag: active+enabled turns it on', async (page) => {
    window.localStorage.setItem('activeRestaurantId', 'r1');
    checkFlag.mockResolvedValue(checkResult(true, true));
    const { result } = renderHook(() => useMudavymDesign(page));
    expect(result.current).toBe(false); // legacy while the check is in flight, even though held-back
    await waitFor(() => expect(result.current).toBe(true));
    expect(checkFlag).toHaveBeenCalledWith('r1', `mudavym_design_${page}`);
  });
});
