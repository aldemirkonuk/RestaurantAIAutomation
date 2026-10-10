/**
 * F-1103: `getSalesChartData` was typed `{ labels, data, total }`, a shape the
 * gateway never sends, so a point's `procurementSpendCurrency` had no type to
 * reach a reader through; and its fallback turned a failed read into a row of
 * zeros. It now returns the gateway's points, currency included, and a failed
 * read rejects.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
  getActiveRestaurantId: () => 'r-1',
}));

import { getSalesChartData, type SalesChartPoint } from './dashboard';

beforeEach(() => {
  get.mockReset();
});

describe('the spend chart keeps each point in its own currency', () => {
  it("carries a euro bucket's code to the reader", async () => {
    const points: SalesChartPoint[] = [
      { date: '2026-10-01', procurementSpend: 12000, procurementSpendCurrency: null, bottles: 4, glasses: 9 },
      { date: '2026-10-02', procurementSpend: 1200, procurementSpendCurrency: 'EUR', bottles: 2, glasses: 0 },
    ];
    get.mockResolvedValue({ data: points });
    const read = await getSalesChartData('week', 'r-1');
    expect(read.map((p) => p.procurementSpendCurrency)).toEqual([null, 'EUR']);
  });

  it('a failed read rejects instead of drawing zeros', async () => {
    get.mockRejectedValue(new Error('503'));
    await expect(getSalesChartData('week', 'r-1')).rejects.toThrow('503');
  });
});
