/**
 * useLogsNextData — hook-level contract.
 *
 * The component test mocks this hook wholesale; here the hook is the subject
 * and `apiClient` is the mock, so the window walk is pinned by the requests it
 * makes rather than by a rendered string: the cap it sends, the cursor it
 * passes back, the boundary row it de-duplicates, the stall it refuses to
 * loop on, and the `null` it keeps for a gateway that never said `hasMore`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const auth = vi.hoisted(() => ({
  current: { activeRestaurantId: 'rest-A' } as { activeRestaurantId: string | null },
}));

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));

vi.mock('@/services/api/client', () => ({
  apiClient: { get: (...args: unknown[]) => api.get(...args) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { LOGS_SERVER_WINDOWS, useLogsNextData } from './useLogsNextData';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function row(id: string, occurredAt: string | null, source = 'decision_log') {
  return { id, source, occurredAt, correlationId: null, summary: id, detail: {} };
}

const SIX = [
  'pos_checks',
  'decision_log',
  'inventory_transactions',
  'procurement_documents',
  'system_audit_log',
  'event_store',
];

beforeEach(() => {
  api.get.mockReset();
  auth.current = { activeRestaurantId: 'rest-A' };
});

describe('useLogsNextData — the window', () => {
  it('asks the house path for the declared window and reads hasMore from the answer', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        events: [row('a', '2026-09-10T10:00:00.000Z')],
        correlationId: null,
        sourcesQueried: SIX.slice(0, 5),
        failedSources: [],
        window: 100,
        hasMore: false,
        nextCursor: null,
      },
    });

    const { result } = renderHook(() => useLogsNextData(null), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    expect(api.get).toHaveBeenCalledTimes(1);
    const [path, opts] = api.get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(path).toBe('/logs/timeline/rest-A');
    expect(opts.params.limit).toBe(LOGS_SERVER_WINDOWS.TIMELINE);
    expect(opts.params.before).toBeUndefined();
    expect(result.current.hasMore).toBe(false);
    expect(result.current.window).toBe(100);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.counts).toEqual({ decision_log: 1 });
    expect(result.current.sourcesQueried).toEqual(SIX.slice(0, 5));
  });

  it('walks the cursor, de-duplicates the boundary row, and unions the failed registers', async () => {
    api.get
      .mockResolvedValueOnce({
        data: {
          events: [row('a', '2026-09-10T10:00:00.000Z'), row('b', '2026-09-10T09:00:00.000Z')],
          correlationId: null,
          sourcesQueried: SIX.slice(0, 5),
          failedSources: ['pos_checks'],
          window: 2,
          hasMore: true,
          nextCursor: '2026-09-10T09:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        data: {
          // The inclusive cursor re-reads `b`; the hook must show it once.
          events: [row('b', '2026-09-10T09:00:00.000Z'), row('c', '2026-09-10T08:00:00.000Z')],
          correlationId: null,
          sourcesQueried: SIX.slice(0, 5),
          failedSources: ['system_audit_log'],
          window: 2,
          hasMore: false,
          nextCursor: null,
        },
      });

    const { result } = renderHook(() => useLogsNextData(null), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.stalled).toBe(false);

    act(() => result.current.readMore());
    await waitFor(() => expect(result.current.pagesRead).toBe(2));

    const second = api.get.mock.calls[1] as [string, { params: Record<string, unknown> }];
    expect(second[1].params.before).toBe('2026-09-10T09:00:00.000Z');
    expect(result.current.events?.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.failedSources?.sort()).toEqual(['pos_checks', 'system_audit_log']);
  });

  it('stalls — and says so — when the cursor cannot advance, rather than looping', async () => {
    api.get
      .mockResolvedValueOnce({
        data: {
          events: [row('a', '2026-09-10T10:00:00.000Z'), row('b', '2026-09-10T10:00:00.000Z')],
          correlationId: null,
          window: 2,
          hasMore: true,
          nextCursor: '2026-09-10T10:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        data: {
          // Every row on the page shares the boundary timestamp: the gateway
          // hands back the same cursor it was given.
          events: [row('a', '2026-09-10T10:00:00.000Z'), row('b', '2026-09-10T10:00:00.000Z')],
          correlationId: null,
          window: 2,
          hasMore: true,
          nextCursor: '2026-09-10T10:00:00.000Z',
        },
      });

    const { result } = renderHook(() => useLogsNextData(null), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => result.current.readMore());
    await waitFor(() => expect(result.current.pagesRead).toBe(2));

    expect(result.current.stalled).toBe(true);
    // A third read is refused: there is no next page to ask for.
    act(() => result.current.readMore());
    await new Promise((r) => setTimeout(r, 20));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('keeps hasMore and window null for a gateway that never said', async () => {
    api.get.mockResolvedValueOnce({
      data: { events: [row('a', '2026-09-10T10:00:00.000Z')], correlationId: null },
    });
    const { result } = renderHook(() => useLogsNextData(null), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.hasMore).toBeNull();
    expect(result.current.window).toBeNull();
    expect(result.current.sourcesQueried).toBeNull();
    expect(result.current.failedSources).toBeNull();
    expect(result.current.stalled).toBe(false);
  });

  it('passes the thread to the gateway and keys the cache by house and thread', async () => {
    api.get.mockResolvedValue({ data: { events: [], correlationId: 'corr-1', hasMore: false, nextCursor: null } });
    const { result } = renderHook(() => useLogsNextData('corr-1'), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const [, opts] = api.get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(opts.params.correlationId).toBe('corr-1');
  });
});

describe('useLogsNextData — honesty', () => {
  it('tells a refusal apart from a breakage', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 403 }, message: 'Access denied to this restaurant' });
    const { result } = renderHook(() => useLogsNextData(null), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('unreadable'));
    expect(result.current.failure).toEqual({
      status: 403,
      message: 'Access denied to this restaurant',
      forbidden: true,
    });
    expect(result.current.events).toBeNull();
    expect(result.current.counts).toBeNull();
  });

  it('reports a broken read with the gateway’s own words and a null status', async () => {
    api.get.mockRejectedValueOnce(new Error('Network Error'));
    const { result } = renderHook(() => useLogsNextData(null), { wrapper });
    await waitFor(() => expect(result.current.state).toBe('unreadable'));
    expect(result.current.failure?.forbidden).toBe(false);
    expect(result.current.failure?.message).toBe('Network Error');
  });

  it('makes no request and says so when no house is selected', async () => {
    auth.current = { activeRestaurantId: null };
    const { result } = renderHook(() => useLogsNextData(null), { wrapper });
    expect(result.current.state).toBe('unreadable');
    expect(result.current.failure?.message).toMatch(/No house is selected/);
    expect(api.get).not.toHaveBeenCalled();
  });
});
