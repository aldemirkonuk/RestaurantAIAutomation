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
import { ROLE_RECHECK_EVENT } from '../roleRecheck';

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
  it('rules off every row a folded line stands for, past the page too (F-1125)', async () => {
    // A burst of 60: the bell's page holds 25 of it; the fold is ruled off on
    // the server by its key, never by the 25 ids this page happened to hold.
    api.get.mockImplementation((url: string) =>
      url === '/notifications/unread/count'
        ? Promise.resolve({ data: { count: 60 } })
        : Promise.resolve({ data: { data: flood(60).slice(35).reverse(), total: 60, hasMore: true } }),
    );
    const { result } = renderHook(() => useBellBook(true));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const line = result.current.items[0];

    await act(async () => {
      result.current.markRead(line.id);
    });

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledTimes(1);
    const [url, body] = api.patch.mock.calls[0];
    expect(url).toBe(`/notifications/${line.id}/read/fold`);
    expect(body).toBeUndefined();
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

describe('the "your role changed" notice (F-930)', () => {
  it('asks the session to read its role again, once per notice', async () => {
    const roleNotice = {
      ...flood(1)[0],
      id: 'role-1',
      title: 'Your role in this restaurant changed',
      metadata: { action: 'member_role_changed', changes: { role: { from: 'manager', to: 'staff' } } },
    };
    api.get.mockImplementation((url: string) =>
      url === '/notifications/unread/count'
        ? Promise.resolve({ data: { count: 1 } })
        : Promise.resolve({ data: { data: [roleNotice], total: 1, hasMore: false } }),
    );
    const heard = vi.fn();
    window.addEventListener(ROLE_RECHECK_EVENT, heard);
    try {
      const { result } = renderHook(() => useBellBook(true));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(heard).toHaveBeenCalledTimes(1);
      // The same unread notice read again on the next poll does not ask again.
      await act(async () => {
        window.dispatchEvent(new Event('notification_sent'));
      });
      await waitFor(() => expect(api.get.mock.calls.filter((c) => c[0] === '/notifications').length).toBeGreaterThan(1));
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(ROLE_RECHECK_EVENT, heard);
    }
  });

  it('other notices do not ask', async () => {
    const heard = vi.fn();
    window.addEventListener(ROLE_RECHECK_EVENT, heard);
    try {
      const { result } = renderHook(() => useBellBook(true));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      expect(heard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(ROLE_RECHECK_EVENT, heard);
    }
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
    // a ruled-off fold still names both rows, so archiving it reaches both
    expect(out.membersById.c).toEqual(['c', 'a']);
  });
});
