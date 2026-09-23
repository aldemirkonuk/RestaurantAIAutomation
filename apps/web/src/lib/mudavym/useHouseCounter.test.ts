/**
 * The counter's cadence and what a failure leaves on screen.
 * The network is mocked at the counter's one read; the hook is real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readCounter = vi.hoisted(() => vi.fn());
vi.mock('../../services/api/houseCounter', () => ({ readHouseCounter: () => readCounter() }));

import { COUNTER_POLL_MS, useHouseCounter } from './useHouseCounter';
import { getHouseSaid, resetHouseSaid } from './houseSaid';
import type { HouseCounterRead } from './counterRead';

function answer(readAt: string): HouseCounterRead {
  return { readAt, house: { id: 'r-1', currency: { state: 'recorded', code: 'USD' } }, role: 'owner', registers: [] };
}

beforeEach(() => {
  resetHouseSaid();
  readCounter.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('the cadence: 60 s and on focus', () => {
  it('reads on mount, again every 60 s, and again on window focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    readCounter.mockResolvedValue(answer('2026-09-21T14:00:00Z'));
    renderHook(() => useHouseCounter('r-1'));
    await waitFor(() => expect(readCounter).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTER_POLL_MS);
    });
    await waitFor(() => expect(readCounter).toHaveBeenCalledTimes(2));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(readCounter).toHaveBeenCalledTimes(3));
    expect(COUNTER_POLL_MS).toBe(60_000);
  });

  it('holds its reads while the device is offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    readCounter.mockResolvedValue(answer('2026-09-21T14:00:00Z'));
    const { result } = renderHook(() => useHouseCounter('r-1'));
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(readCounter).not.toHaveBeenCalled();
    online.mockRestore();
  });
});

describe('a failed read is an error, never an empty counter', () => {
  it('keeps the last answer, dated, and names the failure beside it', async () => {
    readCounter.mockResolvedValueOnce(answer('2026-09-21T14:00:00Z'));
    const { result } = renderHook(() => useHouseCounter('r-1'));
    await waitFor(() => expect(result.current.last?.readAt).toBe('2026-09-21T14:00:00Z'));
    readCounter.mockRejectedValueOnce(Object.assign(new Error('bad gateway'), { response: { status: 502 } }));
    act(() => result.current.readNow());
    await waitFor(() => expect(result.current.failure?.status).toBe(502));
    expect(result.current.last?.readAt).toBe('2026-09-21T14:00:00Z');
    expect(getHouseSaid()[0]).toMatchObject({ kind: 'not_read' });
  });

  it('a first read that fails leaves no answer at all — not an empty one', async () => {
    readCounter.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useHouseCounter('r-1'));
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.last).toBeNull();
    expect(result.current.failure?.status).toBeNull();
  });

  it('files one line per run of failures, not one per poll', async () => {
    readCounter.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useHouseCounter('r-1'));
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    act(() => result.current.readNow());
    await waitFor(() => expect(readCounter).toHaveBeenCalledTimes(2));
    expect(getHouseSaid().filter((e) => e.kind === 'not_read')).toHaveLength(1);
  });
});

describe('one house never renders under another', () => {
  it('forgets the last answer when the house changes', async () => {
    readCounter.mockResolvedValueOnce(answer('2026-09-21T14:00:00Z'));
    const { result, rerender } = renderHook(({ h }) => useHouseCounter(h), { initialProps: { h: 'r-1' } });
    await waitFor(() => expect(result.current.last).not.toBeNull());
    readCounter.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ h: 'r-2' });
    expect(result.current.last).toBeNull();
  });
});
