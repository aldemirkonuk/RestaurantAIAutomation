/**
 * useNotificationsNextData — hook-level contract.
 *
 * The component test mocks this hook wholesale, which is exactly where the two
 * audit DEFECTs were hiding: a cross-tenant write and a paging signal that
 * could never clear. Here the hook is the subject and `apiClient` is the mock,
 * so both are pinned by a request assertion rather than by a rendered string.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  current: { user: { userId: 'user-1' }, activeRestaurantId: 'rest-A' } as {
    user: { userId: string } | null;
    activeRestaurantId: string | null;
  },
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    patch: (...args: unknown[]) => api.patch(...args),
    post: (...args: unknown[]) => api.post(...args),
    delete: (...args: unknown[]) => api.delete(...args),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { BOOK_PAGE, useNotificationsNextData } from './useNotificationsNextData';

/** One page of the gateway's `{ data, total, page, limit, hasMore }` envelope. */
function bookPage(page: number, total: number, restaurantId: string) {
  const from = (page - 1) * BOOK_PAGE;
  const size = Math.max(0, Math.min(BOOK_PAGE, total - from));
  return {
    data: Array.from({ length: size }, (_, i) => ({
      id: `n-${restaurantId}-${from + i}`,
      userId: 'user-1',
      restaurantId,
      type: 'system',
      // Distinct titles: the digest stacker folds rows that share one.
      title: `Line ${from + i}`,
      message: 'x',
      status: 'unread',
      priority: 'low',
      metadata: {},
      timestamp: new Date(2026, 0, 1, 0, 0, from + i).toISOString(),
      createdAt: new Date(2026, 0, 1, 0, 0, from + i).toISOString(),
    })),
    total,
    page,
    limit: BOOK_PAGE,
    // Exactly the gateway's arithmetic: `count > offset + limit`
    // (notifications.service.ts:821) — page 1's answer is the constant
    // `total > 100` and is the reason it may not be trusted after paging.
    hasMore: total > from + BOOK_PAGE,
  };
}

/**
 * Serve `total` notifications, paged. `/one-tap-actions` is still answered so
 * that a REGRESSION (the hook starting to read it again after the founder moved
 * the desk to the dashboard) surfaces as the assertion below failing rather
 * than as an unhandled rejection somewhere else.
 */
function serve(total: number, restaurantId = 'rest-A') {
  api.get.mockImplementation((url: string, cfg?: { params?: Record<string, unknown> }) => {
    if (url === '/notifications') {
      const page = Number(cfg?.params?.page ?? 1);
      return Promise.resolve({ data: bookPage(page, total, restaurantId) });
    }
    if (url === '/one-tap-actions') {
      return Promise.resolve({ data: { actions: [], total: 0, pending: 0, completed: 0 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  auth.current = { user: { userId: 'user-1' }, activeRestaurantId: 'rest-A' };
  api.get.mockReset();
  api.patch.mockReset().mockResolvedValue({ data: { success: true, count: 1 } });
  api.post.mockReset().mockResolvedValue({ data: {} });
  api.delete.mockReset().mockResolvedValue({ data: {} });
  window.localStorage.clear();
});

describe('markAllRead — tenant scope', () => {
  it('names the active restaurant, so it can never rule off another tenant’s book', async () => {
    serve(3);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    await act(async () => {
      result.current.markAllRead();
    });

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body, config] = api.patch.mock.calls[0];
    expect(url).toBe('/notifications/read/all');
    expect(body).toBeUndefined();
    expect(config.params).toEqual({ userId: 'user-1', restaurantId: 'rest-A' });
    // The gateway filters by tenant ONLY when the parameter is present
    // (notifications.service.ts:943-945), so its absence is the whole bug.
    expect(config.params.restaurantId).toBeDefined();
  });

  it('does not fire at all before the restaurant is known', async () => {
    auth.current = { user: { userId: 'user-1' }, activeRestaurantId: null };
    serve(0);
    const { result } = renderHook(() => useNotificationsNextData());

    await act(async () => {
      result.current.markAllRead();
    });

    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('hasMore — the “Read further back” signal', () => {
  it('retires once the last page has actually been read', async () => {
    serve(250); // three pages of 100
    const { result } = renderHook(() => useNotificationsNextData());

    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    expect(result.current.book.hasMore).toBe(true);
    expect(result.current.book.total).toBe(250);

    await act(async () => {
      result.current.readFurtherBack();
    });
    await waitFor(() => expect(result.current.book.pages).toBe(2));
    // 200 of 250 read — still more, and still honest about it.
    expect(result.current.book.hasMore).toBe(true);

    await act(async () => {
      result.current.readFurtherBack();
    });
    await waitFor(() => expect(result.current.book.pages).toBe(3));

    // Everything is on screen, so the control must retire. Taking page 1's
    // `hasMore` (the constant `total > 100`) left it offered forever.
    expect(result.current.book.hasMore).toBe(false);
    expect(
      (result.current.book.register as { state: 'ready'; rows: unknown[] }).rows,
    ).toHaveLength(250);
    expect(api.get).toHaveBeenCalledWith(
      '/notifications',
      expect.objectContaining({ params: expect.objectContaining({ page: 3 }) }),
    );
  });

  it('stays true while a page is genuinely still unread', async () => {
    serve(150);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    expect(result.current.book.hasMore).toBe(true);
    expect(
      (result.current.book.register as { state: 'ready'; rows: unknown[] }).rows,
    ).toHaveLength(100);
  });

  it('is unknown, not false, when the gateway sends no envelope', async () => {
    api.get.mockImplementation((url: string) =>
      url === '/notifications'
        ? Promise.resolve({ data: [] }) // an older build's bare array
        : Promise.resolve({ data: { actions: [] } }),
    );
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    expect(result.current.book.hasMore).toBeNull();
    expect(result.current.book.total).toBeNull();
  });
});

describe('tenant keying', () => {
  it('reads every register with the active restaurant id', async () => {
    serve(1);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    for (const [url, cfg] of api.get.mock.calls) {
      expect(cfg.params.restaurantId, `${url} must name the tenant`).toBe('rest-A');
    }
  });

  it('reads the notifications register and nothing else — one-tap moved to the dashboard', async () => {
    serve(1);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    const urls: string[] = api.get.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls).not.toContain('/one-tap-actions');
    expect(new Set(urls)).toEqual(new Set(['/notifications']));
  });
});

/**
 * FOURTH PASS — the four narrowings are the REGISTER'S, so they must leave
 * this hook as query params and come back as a filtered `total`. A filter that
 * quietly became a browser-side `.filter()` would still look right on screen
 * and would silently lie about how much of the book it had seen.
 */
describe('useNotificationsNextData — the register does the narrowing', () => {
  beforeEach(() => {
    auth.current = { user: { userId: 'user-1' }, activeRestaurantId: 'rest-A' };
    api.get.mockReset();
    api.patch.mockReset();
    api.delete.mockReset();
  });

  it('sends type, status and the day’s window to the gateway', async () => {
    serve(40);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    act(() => {
      result.current.setFilters({ type: 'report', status: 'unread', day: '2026-09-03' });
    });
    await waitFor(() => {
      const last = api.get.mock.calls.at(-1)?.[1]?.params as Record<string, unknown>;
      expect(last.type).toBe('report');
      expect(last.status).toBe('unread');
      expect(typeof last.dateFrom).toBe('string');
      expect(typeof last.dateTo).toBe('string');
    });
    // local midnight to local end-of-day, so "3 September" means the reader's
    const params = api.get.mock.calls.at(-1)?.[1]?.params as Record<string, string>;
    expect(new Date(params.dateFrom).getHours()).toBe(0);
    expect(new Date(params.dateTo).getHours()).toBe(23);
  });

  it('omits a cleared filter instead of sending an empty string', async () => {
    serve(40);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    act(() => {
      result.current.setFilters({ type: 'report', status: null, day: null });
    });
    await waitFor(() => {
      const last = api.get.mock.calls.at(-1)?.[1]?.params as Record<string, unknown>;
      expect(last.type).toBe('report');
      // `status=''` fails the DTO's @IsEnum and turns a cleared filter into a 400
      expect('status' in last).toBe(false);
      expect('dateFrom' in last).toBe(false);
      expect('dateTo' in last).toBe(false);
    });
  });

  it('starts the paging again when the book is narrowed', async () => {
    serve(260);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    act(() => result.current.readFurtherBack());
    await waitFor(() => expect(result.current.book.pages).toBe(2));

    act(() => result.current.setFilters({ type: 'report', status: null, day: null }));
    await waitFor(() => expect(result.current.book.pages).toBe(1));
    // …and page 2 is not asked for under the new filter
    const pagesAsked = api.get.mock.calls
      .filter((c) => (c[1] as { params?: Record<string, unknown> })?.params?.type === 'report')
      .map((c) => (c[1] as { params?: Record<string, unknown> }).params?.page);
    expect(pagesAsked.every((p) => p === 1)).toBe(true);
  });

  it('a restaurant switch clears the filters as well as the rows', async () => {
    serve(40);
    const { result, rerender } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    act(() => result.current.setFilters({ type: 'report', status: 'read', day: '2026-09-03' }));
    await waitFor(() => expect(result.current.filters.type).toBe('report'));

    serve(10, 'rest-B');
    auth.current = { user: { userId: 'user-1' }, activeRestaurantId: 'rest-B' };
    rerender();
    await waitFor(() => expect(result.current.filters).toEqual({
      type: null,
      status: null,
      day: null,
    }));
  });
});
