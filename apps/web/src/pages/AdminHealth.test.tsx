/**
 * Focused regression test for the 403-toast-spam fix (wave-5 IJ confirm, R5).
 *
 * Before this pass, fetchHealth toasted on every failed poll, unconditionally, every
 * 30s for as long as the tab stayed open — for a persistent cause (most often a
 * standing 403, a manager with no operator grant, which will not change on its own)
 * that meant a fresh toast notification every half minute, forever. This locks in
 * "toast once per distinct reason", not "never toast again" or "toast every cycle".
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: (error: unknown): boolean =>
      !!error && typeof error === 'object' && (error as Record<string, unknown>).isAxiosError === true,
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import axios from 'axios';
import { toast } from 'sonner';
import AdminHealth from './AdminHealth';

const mockedGet = vi.mocked(axios.get);
const axiosError = (status: number) => Object.assign(new Error(`Request failed with status ${status}`), {
  isAxiosError: true,
  response: { status },
});
const okResponse = { data: { agents: [{ agent_name: 'inventory', version: '1', status: 'active', healthy: true, capabilities: [] }], count: 1 } };

beforeEach(() => {
  mockedGet.mockReset();
  vi.mocked(toast.error).mockClear();
});

/* No `vi.restoreAllMocks()` here: `__tests__/setup.ts` installs `matchMedia`,
   `ResizeObserver` and friends as `vi.fn()` implementations for every test in
   this file, and restoring would strip them after the first test — framer-
   motion's `motion.div` mount effect then throws on the missing `matchMedia`
   (measured: this fix). */
afterEach(() => {
  vi.useRealTimers();
});

describe('AdminHealth 403 toast', () => {
  it('toasts once for a persistent 403 across repeated 30s polls, not once per poll', async () => {
    mockedGet.mockRejectedValue(axiosError(403));
    vi.useFakeTimers();
    render(<AdminHealth />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(toast.error).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // Three fetch attempts (initial + two polls), all 403 — still one toast.
    expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('toasts again when the reason changes, and again after a recovery is followed by a new failure', async () => {
    mockedGet.mockRejectedValueOnce(axiosError(403));
    vi.useFakeTimers();
    render(<AdminHealth />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(toast.error).toHaveBeenCalledTimes(1);

    mockedGet.mockRejectedValueOnce(axiosError(401));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(toast.error).toHaveBeenCalledTimes(2); // different reason (401, not 403)

    mockedGet.mockResolvedValueOnce(okResponse);
    // `advanceTimersByTimeAsync` already flushes the promises the tick resolves,
    // so the state update lands before this call returns — a `waitFor` here would
    // poll on its own (fake, now-frozen) timers and never see it, and time out.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText('inventory')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(2); // recovered — no toast for success

    mockedGet.mockRejectedValueOnce(axiosError(403));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(toast.error).toHaveBeenCalledTimes(3); // new failure episode after a recovery
  });
});
