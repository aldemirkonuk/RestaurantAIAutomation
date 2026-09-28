/**
 * useHeldLowStock — the held queue's read (founder, 2026-09-26, round 8).
 *
 * Pinned: it reads the CALLER's house (the active house id, which the gateway
 * then checks against the token), it waits for identity instead of failing
 * once and sticking, a failed read is `unreadable` (not an empty queue), and a
 * house switch never leaves the previous house's wines on screen.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const auth = vi.hoisted(() => ({ current: { activeRestaurantId: 'house-a' as string | null } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));

const fetchHeld = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/notifications', () => ({ fetchHeldLowStock: fetchHeld }));

import { useHeldLowStock } from './useHeldLowStock';

const VIEW = {
  restaurant_id: 'house-a',
  held: [
    { inventory_id: 'i1', wine_name: 'A', level: 'critical', held_at: '2026-09-26T09:00:00Z', reason: 'prefs' },
    { inventory_id: 'i2', wine_name: 'B', level: 'low', held_at: '2026-09-26T08:00:00Z', reason: null },
  ],
  summary: { count: 99, critical: 99, oldest_held_at: '2026-09-26T08:00:00Z' },
  digest: { low_stock_enabled: true, frequency: 'daily', hour: 12, timezone: 'America/New_York' },
};

beforeEach(() => {
  fetchHeld.mockReset();
  auth.current = { activeRestaurantId: 'house-a' };
});

describe('useHeldLowStock', () => {
  it('reads the active house and counts from the rows it will draw', async () => {
    fetchHeld.mockResolvedValue(VIEW);
    const { result } = renderHook(() => useHeldLowStock());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(fetchHeld).toHaveBeenCalledWith('house-a');
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current.view.summary).toEqual({
      count: 2,
      critical: 1,
      oldest_held_at: '2026-09-26T08:00:00Z',
    });
    expect(result.current.view.digest?.hour).toBe(12);
  });

  it('an older gateway without `digest` reads as "not known", never a default', async () => {
    const { digest: _omit, ...older } = VIEW;
    fetchHeld.mockResolvedValue(older);
    const { result } = renderHook(() => useHeldLowStock());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current.view.digest).toBeNull();
  });

  it('a failed read is unreadable, and says whether it was a refusal', async () => {
    fetchHeld.mockRejectedValue({ response: { status: 403 }, message: 'Forbidden' });
    const { result } = renderHook(() => useHeldLowStock());
    await waitFor(() => expect(result.current.state).toBe('unreadable'));
    if (result.current.state !== 'unreadable') throw new Error('not unreadable');
    expect(result.current.failure.forbidden).toBe(true);
  });

  it('waits for identity instead of failing once and sticking', async () => {
    auth.current = { activeRestaurantId: null };
    const { result } = renderHook(() => useHeldLowStock());
    await act(async () => {});
    expect(fetchHeld).not.toHaveBeenCalled();
    expect(result.current.state).toBe('loading');
  });

  it("a house switch drops the previous house's wines and reads the new house", async () => {
    fetchHeld.mockResolvedValue(VIEW);
    const { result, rerender } = renderHook(() => useHeldLowStock());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    let resolveB: (v: unknown) => void = () => {};
    fetchHeld.mockReturnValue(new Promise((r) => (resolveB = r)));
    auth.current = { activeRestaurantId: 'house-b' };
    rerender();
    expect(result.current.state).toBe('loading');
    expect(fetchHeld).toHaveBeenLastCalledWith('house-b');
    await act(async () => resolveB({ ...VIEW, restaurant_id: 'house-b', held: [] }));
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current.view.held).toEqual([]);
  });
});
