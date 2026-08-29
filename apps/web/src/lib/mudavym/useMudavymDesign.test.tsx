import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: vi.fn() },
}));

import { settingsApi } from '../../services/api/settings';
import {
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
