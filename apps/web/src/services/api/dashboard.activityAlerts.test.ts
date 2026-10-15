/**
 * `getRecentActivity` and `getAlerts` used to catch a failed read to `[]`, so
 * the dashboard printed "Quiet. Activity lands here as the day moves." and
 * "No alerts carry this date." over reads it never got (DASH-W3, DASH-W11).
 * A failed read now rejects, like the stats path; the one caller `settle`s it
 * and shows the read as not reached.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
  getActiveRestaurantId: () => 'r-1',
}));

import { getAlerts, getRecentActivity } from './dashboard';

beforeEach(() => {
  get.mockReset();
});

describe('a failed activity or alerts read is never an empty list', () => {
  it('rejects when the activity read fails', async () => {
    get.mockRejectedValue(new Error('503'));
    await expect(getRecentActivity(12, 'r-1')).rejects.toThrow('503');
  });

  it('rejects when the alerts read fails', async () => {
    get.mockRejectedValue(new Error('503'));
    await expect(getAlerts('r-1')).rejects.toThrow('503');
  });

  it('a list that WAS read is still the list, empty included', async () => {
    get.mockResolvedValue({ data: [] });
    await expect(getRecentActivity(12, 'r-1')).resolves.toEqual([]);
    await expect(getAlerts('r-1')).resolves.toEqual([]);
  });
});
