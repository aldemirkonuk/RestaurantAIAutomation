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
