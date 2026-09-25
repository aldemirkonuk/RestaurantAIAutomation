/**
 * The day line's cadence and what a failure leaves on screen — the same
 * rules `useHouseCounter.test.ts` pins for the counter, mirrored here
 * because `useHouseDay` mirrors that hook's structure on purpose.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readDay = vi.hoisted(() => vi.fn());
vi.mock('../../services/api/houseDay', () => ({ readHouseDay: () => readDay() }));

import { DAY_POLL_MS, useHouseDay } from './useHouseDay';
import type { HouseDayRead } from './dayRead';

function answer(readAt: string): HouseDayRead {
  return {
    readAt,
    house: { id: 'r-1', timezone: 'America/Chicago' },
    hours: { state: 'recorded', windows: [] },
    registers: [],
  };
}

beforeEach(() => {
  readDay.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('the cadence: 60 s and on focus', () => {
  it('reads on mount, again every 60 s, and again on window focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    readDay.mockResolvedValue(answer('2026-09-21T14:00:00Z'));
    renderHook(() => useHouseDay('r-1'));
    await waitFor(() => expect(readDay).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DAY_POLL_MS);
    });
    await waitFor(() => expect(readDay).toHaveBeenCalledTimes(2));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(readDay).toHaveBeenCalledTimes(3));
    expect(DAY_POLL_MS).toBe(60_000);
  });

  it('holds its reads while the device is offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    readDay.mockResolvedValue(answer('2026-09-21T14:00:00Z'));
    const { result } = renderHook(() => useHouseDay('r-1'));
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(readDay).not.toHaveBeenCalled();
    online.mockRestore();
  });

  it('reads again once the device comes back online', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    readDay.mockResolvedValue(answer('2026-09-21T14:00:00Z'));
    const { result } = renderHook(() => useHouseDay('r-1'));
    await waitFor(() => expect(result.current.offline).toBe(true));
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.offline).toBe(false));
    expect(readDay).toHaveBeenCalledTimes(1);
    online.mockRestore();
  });
});

describe('a failed read is an error, never an empty line', () => {
  it('keeps the last answer, dated, and names the failure beside it', async () => {
    readDay.mockResolvedValueOnce(answer('2026-09-21T14:00:00Z'));
    const { result } = renderHook(() => useHouseDay('r-1'));
    await waitFor(() => expect(result.current.last?.readAt).toBe('2026-09-21T14:00:00Z'));
    readDay.mockRejectedValueOnce(Object.assign(new Error('bad gateway'), { response: { status: 502 } }));
    act(() => result.current.readNow());
    await waitFor(() => expect(result.current.failure?.status).toBe(502));
    expect(result.current.last?.readAt).toBe('2026-09-21T14:00:00Z');
  });

  it('a first read that fails leaves no answer at all — not an empty one', async () => {
    readDay.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useHouseDay('r-1'));
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.last).toBeNull();
    expect(result.current.failure?.status).toBeNull();
  });
});

describe('one house never renders under another', () => {
  it('forgets the last answer when the house changes', async () => {
    readDay.mockResolvedValueOnce(answer('2026-09-21T14:00:00Z'));
    const { result, rerender } = renderHook(({ h }) => useHouseDay(h), { initialProps: { h: 'r-1' } });
    await waitFor(() => expect(result.current.last).not.toBeNull());
    readDay.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ h: 'r-2' });
    expect(result.current.last).toBeNull();
  });
});

describe('disabled', () => {
  it('never reads when `enabled` is false', async () => {
    readDay.mockResolvedValue(answer('2026-09-21T14:00:00Z'));
    renderHook(() => useHouseDay('r-1', false));
    await new Promise((r) => setTimeout(r, 0));
    expect(readDay).not.toHaveBeenCalled();
  });
});
