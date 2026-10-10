/**
 * The bell's cadence: a hidden tab does not poll (F-450).
 * The network is mocked at apiClient; the hook is real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u-1' }, activeRestaurantId: 'r-1' }),
}));

vi.mock('../../services/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => api.get(...args) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { BELL_POLL_MS, useBellBook } from './useBellBook';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  api.get.mockReset();
});

function countReads(): number {
  return api.get.mock.calls.filter(([url]) => url === '/notifications/unread/count').length;
}

describe('the bell in a hidden tab', () => {
  it('skips its tick while hidden and reads once when the tab is shown again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    api.get.mockResolvedValue({ data: { count: 0 } });
    renderHook(() => useBellBook(false));
    await waitFor(() => expect(countReads()).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS);
    });
    await waitFor(() => expect(countReads()).toBe(2));
    state = 'hidden';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BELL_POLL_MS * 3);
    });
    expect(countReads()).toBe(2);
    state = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(countReads()).toBe(3));
  });
});
