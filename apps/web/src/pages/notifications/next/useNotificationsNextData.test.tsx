/**
 * useNotificationsNextData — hook-level contract.
 *
 * The component test mocks this hook wholesale, which is exactly where the two
 * audit DEFECTs were hiding: a cross-tenant write and a paging signal that
 * could never clear. Here the hook is the subject and `apiClient` is the mock,
 * so both are pinned by a request assertion rather than by a rendered string.
 */

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
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

import {
  BOOK_PAGE,
  POLL_MS,
  mergeTopPage,
  useNotificationsNextData,
} from './useNotificationsNextData';
import type { Notification } from '@/services/api/notifications';
import { resetSharedUnreadCount } from '@/lib/mudavym/unreadCount';

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
    if (url === '/notifications/unread/count') {
      return Promise.resolve({ data: { count: total } });
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
  resetSharedUnreadCount();
});

describe('ruleOffShown — only the lines on screen (F-1659)', () => {
  it('rules off the named lines and never the restaurant’s whole book', async () => {
    serve(3);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    await act(async () => {
      result.current.ruleOffShown(['n-rest-A-0', 'n-rest-A-2']);
    });

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const urls = api.patch.mock.calls.map((c) => c[0]);
    // `read/all` ruled off pages never read and lines put to sleep, unseen.
    expect(urls).not.toContain('/notifications/read/all');
    expect(api.patch).toHaveBeenCalledWith('/notifications/read/bulk', {
      ids: ['n-rest-A-0', 'n-rest-A-2'],
    });
    // The line left out stays open.
    const left = (result.current.book.register as { rows: Notification[] }).rows.find(
      (r) => r.id === 'n-rest-A-1',
    );
    expect(left?.status).toBe('unread');
  });

  it('one line goes through the bulk route, so a crew note is not counted as opened (F-1698)', async () => {
    serve(3);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    await act(async () => {
      result.current.ruleOffShown(['n-rest-A-1']);
    });

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    // `PATCH /notifications/:id/read` records a note open; the bulk route does not.
    expect(api.patch.mock.calls.map((c) => c[0])).not.toContain('/notifications/n-rest-A-1/read');
    expect(api.patch).toHaveBeenCalledWith('/notifications/read/bulk', { ids: ['n-rest-A-1'] });
  });

  it('sends nothing when no line is named', async () => {
    serve(3);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    await act(async () => {
      result.current.ruleOffShown([]);
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
    // …plus the register's own unread count, which the standing sentence and
    // the bell both stand on (F-254, F-256).
    expect(new Set(urls)).toEqual(new Set(['/notifications', '/notifications/unread/count']));
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

/**
 * F-253 — a folded line is every row it folds. The flood that produced it:
 * hundreds of identical "Daily AI draft limit (50) reached" rows drawn as one
 * line, where "Rule it off" ruled off ONE row and the bell kept counting the
 * rest.
 */
describe('a folded line — every act reaches every row it folds', () => {
  function serveFlood(rows: Array<{ id: string; status: 'read' | 'unread' }>) {
    api.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread/count') {
        return Promise.resolve({
          data: { count: rows.filter((r) => r.status === 'unread').length },
        });
      }
      return Promise.resolve({
        data: {
          data: rows.map((r, i) => ({
            id: r.id,
            userId: 'user-1',
            restaurantId: 'rest-A',
            type: 'ai_draft_limit',
            title: 'Daily AI draft limit (50) reached',
            message: 'x',
            status: r.status,
            priority: 'low',
            metadata: {},
            timestamp: new Date(2026, 9, 7, 9, i).toISOString(),
            createdAt: new Date(2026, 9, 7, 9, i).toISOString(),
          })),
          total: rows.length,
          page: 1,
          limit: BOOK_PAGE,
          hasMore: false,
        },
      });
    });
  }

  it('rules off every open row in the fold through the bulk route', async () => {
    serveFlood([
      { id: 'f-0', status: 'unread' },
      { id: 'f-1', status: 'read' },
      { id: 'f-2', status: 'unread' },
    ]);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.stack.items).toHaveLength(1));
    const line = result.current.stack.items[0];
    expect(line.id).toBe('f-2');

    await act(async () => {
      result.current.markRead(line.id);
    });

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body] = api.patch.mock.calls[0];
    expect(url).toBe('/notifications/read/bulk');
    // The row already ruled off keeps its own stamp; only the open ones move.
    expect([...(body as { ids: string[] }).ids].sort()).toEqual(['f-0', 'f-2']);
  });

  it('is still open when only its newest row was ruled off', async () => {
    serveFlood([
      { id: 'f-0', status: 'unread' },
      { id: 'f-1', status: 'read' },
    ]);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.stack.items).toHaveLength(1));
    expect(String(result.current.stack.items[0].status)).toBe('unread');
  });

  it('deletes every row in the fold, so the next one does not take its place', async () => {
    serveFlood([
      { id: 'f-0', status: 'unread' },
      { id: 'f-1', status: 'unread' },
    ]);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.stack.items).toHaveLength(1));

    await act(async () => {
      result.current.remove('f-1');
    });

    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    const [url, config] = api.delete.mock.calls[0];
    expect(url).toBe('/notifications/bulk');
    expect([...(config as { data: { ids: string[] } }).data.ids].sort()).toEqual(['f-0', 'f-1']);
  });

  it('rules a closed single line off without counting it opened (F-1687)', async () => {
    serve(1);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.stack.items).toHaveLength(1));
    await act(async () => {
      result.current.markRead(result.current.stack.items[0].id);
    });
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls.map((c) => c[0])).not.toContain('/notifications/n-rest-A-0/read');
    expect(api.patch).toHaveBeenCalledWith('/notifications/read/bulk', { ids: ['n-rest-A-0'] });
  });

  it('leaves the opened line on the single-row route, which records the open', async () => {
    serve(1);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.stack.items).toHaveLength(1));
    await act(async () => {
      result.current.markRead(result.current.stack.items[0].id, true);
    });
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][0]).toBe('/notifications/n-rest-A-0/read');
    expect(api.patch.mock.calls).toHaveLength(1);
    // a line that folds nothing names no fold members
    expect(result.current.stack.membersById).toEqual({});
  });
});

/** F-254 — the page knows the register's own unread count, not just its rows. */
describe('the register’s unread count', () => {
  it('is read with the page and exposed', async () => {
    serve(3);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.unread).toBe(3));
  });

  it('is unknown, not zero, when the count cannot be read', async () => {
    api.get.mockImplementation((url: string, cfg?: { params?: Record<string, unknown> }) =>
      url === '/notifications/unread/count'
        ? Promise.reject(new Error('Network Error'))
        : Promise.resolve({ data: bookPage(Number(cfg?.params?.page ?? 1), 0, 'rest-A') }),
    );
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    expect(result.current.unread).toBeNull();
  });
});

/* ── F-451: the poll reads the top page only, one read at a time ─────────── */

function pageCalls(): number[] {
  return api.get.mock.calls
    .filter((c) => c[0] === '/notifications')
    .map((c) => Number((c[1] as { params?: Record<string, unknown> }).params?.page));
}

function row(id: string, createdAt: string) {
  return { id, createdAt } as unknown as Notification;
}

describe('the poll and the live nudges', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('re-reads page 1 only on a tick, never every page already read back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(300);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    act(() => result.current.readFurtherBack());
    await waitFor(() => expect(result.current.book.pages).toBe(2));
    act(() => result.current.readFurtherBack());
    await waitFor(() => expect(result.current.book.pages).toBe(3));
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    api.get.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    await waitFor(() => expect(pageCalls()).toEqual([1]));
    expect(result.current.book.pages).toBe(3);
  });

  it('a nudge during a read waits for it, and many nudges make one more read', async () => {
    serve(300);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    act(() => result.current.readFurtherBack());
    await waitFor(() => expect(result.current.book.pages).toBe(2));
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    api.get.mockClear();
    api.get.mockImplementation(async (_url: string, cfg?: { params?: Record<string, unknown> }) => {
      await gate;
      return { data: bookPage(Number(cfg?.params?.page ?? 1), 300, 'rest-A') };
    });
    act(() => {
      window.dispatchEvent(new Event('notification_sent'));
      window.dispatchEvent(new Event('ws:dashboard-invalidate'));
      window.dispatchEvent(new Event('notification_sent'));
    });
    expect(pageCalls()).toEqual([1]);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(pageCalls()).toEqual([1, 1]));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(pageCalls()).toEqual([1, 1]);
  });

  it('an older read that lands late never publishes over a newer one', async () => {
    serve(10);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));

    let releaseOld: () => void = () => {};
    const oldGate = new Promise<void>((r) => (releaseOld = r));
    let n = 0;
    api.get.mockImplementation(async (_url: string, cfg?: { params?: Record<string, unknown> }) => {
      n += 1;
      if (n === 1) {
        await oldGate;
        return { data: bookPage(1, 3, 'rest-A') };
      }
      return { data: bookPage(Number(cfg?.params?.page ?? 1), 7, 'rest-A') };
    });
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.book.total).toBe(7));
    await act(async () => {
      releaseOld();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.book.total).toBe(7);
  });

  it('skips its tick while the tab is hidden and reads when it is shown again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    serve(10);
    const { result } = renderHook(() => useNotificationsNextData());
    await waitFor(() => expect(result.current.book.register.state).toBe('ready'));
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    api.get.mockClear();
    state = 'hidden';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(pageCalls()).toEqual([]);
    state = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(pageCalls()).toEqual([1]));
  });
});

describe('mergeTopPage', () => {
  const page = Array.from({ length: BOOK_PAGE }, (_, i) =>
    row(`t-${i}`, new Date(Date.UTC(2026, 0, 2, 0, 0, BOOK_PAGE - i)).toISOString()),
  );

  it('keeps held rows older than the fresh page and drops ones gone from inside it', () => {
    const pushedDown = row('old-1', '2026-01-01T12:00:00.000Z');
    const gone = row('gone', page[50].createdAt);
    const merged = mergeTopPage(page, [page[0], gone, pushedDown]);
    expect(merged.map((r) => r.id)).toEqual([...page.map((r) => r.id), 'old-1']);
  });

  it('a short first page is the whole book', () => {
    const merged = mergeTopPage(page.slice(0, 3), [row('old-1', '2020-01-01T00:00:00.000Z')]);
    expect(merged.map((r) => r.id)).toEqual(['t-0', 't-1', 't-2']);
  });
});
