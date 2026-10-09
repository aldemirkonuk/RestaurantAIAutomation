/**
 * useBellBook — the bell's half of F-253 and F-256.
 *
 * F-253: the bell folds identical lines; tapping one ruled off only the newest
 * row, so the bell kept counting the rest. F-256: the bell's count is the one
 * the rail and the /notifications page print.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'user-1' }, activeRestaurantId: 'rest-A' }),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'user-1' }, activeRestaurantId: 'rest-A' }),
}));
vi.mock('../../services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    patch: (...args: unknown[]) => api.patch(...args),
    delete: (...args: unknown[]) => api.delete(...args),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { useBellBook } from './useBellBook';
import { collapseStackedNotifications } from '../notificationStack';
import type { Notification } from '../../services/api/notifications';
import { publishUnreadCount, resetSharedUnreadCount } from './unreadCount';

function flood(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `f-${i}`,
    userId: 'user-1',
    restaurantId: 'rest-A',
    type: 'system',
    title: 'Daily AI draft limit (50) reached',
    message: 'x',
    status: 'unread',
    priority: 'low',
    metadata: {},
    timestamp: new Date(2026, 9, 7, 9, i).toISOString(),
    createdAt: new Date(2026, 9, 7, 9, i).toISOString(),
  }));
}

beforeEach(() => {
  resetSharedUnreadCount();
  api.get.mockReset().mockImplementation((url: string) =>
    url === '/notifications/unread/count'
      ? Promise.resolve({ data: { count: 3 } })
      : Promise.resolve({ data: { data: flood(3), total: 3, hasMore: false } }),
  );
  api.patch.mockReset().mockResolvedValue({ data: {} });
  api.delete.mockReset().mockResolvedValue({ data: {} });
});

describe('useBellBook', () => {
  it('rules off every row a folded line stands for', async () => {
    const { result } = renderHook(() => useBellBook(true));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const line = result.current.items[0];

    await act(async () => {
      result.current.markRead(line.id);
    });

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body] = api.patch.mock.calls[0];
    expect(url).toBe('/notifications/read/bulk');
    expect([...(body as { ids: string[] }).ids].sort()).toEqual(['f-0', 'f-1', 'f-2']);
  });

  it('prints the count another surface read last, and never another house count', async () => {
    const { result } = renderHook(() => useBellBook(false));
    await waitFor(() => expect(result.current.unread).toBe(3));

    act(() => publishUnreadCount({ restaurantId: 'rest-A', count: 0, note: null }));
    expect(result.current.unread).toBe(0);

    act(() => publishUnreadCount({ restaurantId: 'rest-B', count: 9, note: null }));
    expect(result.current.unread).toBeNull();
  });
});

/** The stacker the bell and the page share: a folded line is every row it folds. */
describe('collapseStackedNotifications — a folded line is every row it folds (F-253)', () => {
  const row = (id: string, hour: number, status: 'read' | 'unread') =>
    ({
      id,
      userId: 'user-1',
      restaurantId: 'rest-A',
      type: 'system',
      title: 'Daily AI draft limit (50) reached',
      message: 'x',
      priority: 'low',
      metadata: {},
      status,
      timestamp: `2026-10-07T${String(hour).padStart(2, '0')}:00:00.000Z`,
      createdAt: `2026-10-07T${String(hour).padStart(2, '0')}:00:00.000Z`,
    }) as Notification;

  it('names every member of the fold, winner first', () => {
    const out = collapseStackedNotifications([row('a', 9, 'unread'), row('b', 10, 'unread'), row('c', 11, 'unread')]);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe('c');
    expect(out.membersById.c).toEqual(['c', 'a', 'b']);
  });

  it('stays open while any member is unread, even when the newest was ruled off', () => {
    const out = collapseStackedNotifications([row('a', 9, 'unread'), row('b', 10, 'unread'), row('c', 11, 'read')]);
    expect(out.items[0].id).toBe('c');
    expect(String(out.items[0].status)).toBe('unread');
  });

  it('is ruled off only when every member is', () => {
    const out = collapseStackedNotifications([row('a', 9, 'read'), row('c', 11, 'read')]);
    expect(String(out.items[0].status)).toBe('read');
  });
});
