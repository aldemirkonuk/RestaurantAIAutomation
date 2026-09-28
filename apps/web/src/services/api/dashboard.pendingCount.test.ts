/**
 * `getDashboardStats`'s fallback used to turn a failed pending-order count
 * into 0 — `ordersApi.getPendingOrdersCount(id).catch(() => 0)` — so "we could
 * not read the approvals queue" printed as "nothing is waiting on you". The
 * counter (sketch 119 D) retires that catch rather than inheriting it: a failed
 * read now rejects, and the callers (which already `settle` it) show it as
 * unread.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const pendingCount = vi.hoisted(() => vi.fn());
const summary = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
  getActiveRestaurantId: () => 'r-1',
}));
vi.mock('./orders', () => ({ ordersApi: { getPendingOrdersCount: (...a: unknown[]) => pendingCount(...a) } }));
vi.mock('./inventory', () => ({ inventoryApi: { getInventorySummary: (...a: unknown[]) => summary(...a) } }));

import { getDashboardStats } from './dashboard';

beforeEach(() => {
  get.mockReset();
  pendingCount.mockReset();
  summary.mockReset();
  get.mockRejectedValue(new Error('stats route failed'));
  summary.mockResolvedValue({ totalItems: 10, totalBottles: 120, lowStockCount: 2 });
});

describe('the fallback never prints a failed count as zero', () => {
  it('rejects when the pending count cannot be read', async () => {
    pendingCount.mockRejectedValue(new Error('503'));
    await expect(getDashboardStats('r-1')).rejects.toThrow('503');
  });

  it('a count that WAS read is still the count, zero included', async () => {
    pendingCount.mockResolvedValue(0);
    await expect(getDashboardStats('r-1')).resolves.toMatchObject({ pendingOrders: 0 });
    pendingCount.mockResolvedValue(4);
    await expect(getDashboardStats('r-1')).resolves.toMatchObject({ pendingOrders: 4 });
  });
});
