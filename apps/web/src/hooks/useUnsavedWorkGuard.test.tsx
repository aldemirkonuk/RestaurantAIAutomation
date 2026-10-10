/**
 * The unsaved-work guard (F-712): a reload asks the browser, Back asks the
 * person, and a guard that stands down leaves no dead Back behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useUnsavedWorkGuard } from './useUnsavedWorkGuard';

const MARK = '__mdvUnsavedWork';
const onGuardEntry = () => Boolean((window.history.state as Record<string, unknown> | null)?.[MARK]);

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({ key: 'page' }, '', '/receiving/o1/door');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const reload = () => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

/** What the browser does on Back from the guard entry: the page's own entry shows, then popstate. */
const pressBack = () => {
  window.history.replaceState({ key: 'page' }, '', window.location.href);
  window.dispatchEvent(new PopStateEvent('popstate', { state: { key: 'page' } }));
};

describe('useUnsavedWorkGuard', () => {
  it('[REVERT-FAILS] asks before a reload only while work is open', () => {
    const { rerender } = renderHook(({ on }) => useUnsavedWorkGuard(on, 'Leave?'), {
      initialProps: { on: false },
    });
    expect(reload()).toBe(false);
    rerender({ on: true });
    expect(reload()).toBe(true);
    rerender({ on: false });
    expect(reload()).toBe(false);
  });

  it('[REVERT-FAILS] puts a guard entry on the same address, carrying the router state', () => {
    const push = vi.spyOn(window.history, 'pushState');
    renderHook(() => useUnsavedWorkGuard(true, 'Leave?'));
    expect(push).toHaveBeenCalledWith({ key: 'page', [MARK]: true }, '', window.location.href);
    expect(onGuardEntry()).toBe(true);
  });

  it('[REVERT-FAILS] Back asks; staying puts the guard back', () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    renderHook(() => useUnsavedWorkGuard(true, 'This count is not saved. Leave?'));

    act(() => pressBack());
    expect(ask).toHaveBeenCalledWith('This count is not saved. Leave?');
    expect(back).not.toHaveBeenCalled();
    expect(onGuardEntry()).toBe(true);
  });

  it('[REVERT-FAILS] Back asks; leaving steps back once more', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    renderHook(() => useUnsavedWorkGuard(true, 'Leave?'));

    act(() => pressBack());
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('takes its guard entry off when the work is saved, so the next Back is not dead', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { rerender } = renderHook(({ on }) => useUnsavedWorkGuard(on, 'Leave?'), {
      initialProps: { on: true },
    });
    rerender({ on: false });
    act(() => {
      vi.runAllTimers();
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('re-arming at once reuses the entry instead of stepping back across it', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const push = vi.spyOn(window.history, 'pushState');
    const { rerender } = renderHook(({ on }) => useUnsavedWorkGuard(on, 'Leave?'), {
      initialProps: { on: true },
    });
    rerender({ on: false });
    rerender({ on: true });
    act(() => {
      vi.runAllTimers();
    });
    expect(back).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
  });
});
