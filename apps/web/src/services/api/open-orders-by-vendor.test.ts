/**
 * `getOpenOrdersByVendor` hands /vendors only a count it can read. A body in
 * any other shape throws, so the card prints a dash rather than a guessed 0
 * (r21, 2026-11-13).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiClient } from './client';
import { getOpenOrdersByVendor } from './orders';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const get = (vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn> }).get;

beforeEach(() => get.mockReset());

describe('getOpenOrdersByVendor', () => {
  it('asks the whole-book count route and returns its counts', async () => {
    get.mockResolvedValue({ data: { byVendor: { a: 3, b: 0 }, total: 4 } });
    await expect(getOpenOrdersByVendor()).resolves.toEqual({ byVendor: { a: 3, b: 0 }, total: 4 });
    expect(get).toHaveBeenCalledWith('/procurement/orders/open/by-vendor');
  });

  it.each([
    ['no body', undefined],
    ['no total', { byVendor: { a: 1 } }],
    ['no map', { total: 1 }],
    ['a list, not a map', { byVendor: [1], total: 1 }],
    ['a negative count', { byVendor: { a: -1 }, total: 0 }],
    ['a fractional count', { byVendor: { a: 1.5 }, total: 2 }],
    ['a string count', { byVendor: { a: '3' }, total: 3 }],
  ])('throws on %s', async (_label, data) => {
    get.mockResolvedValue({ data });
    await expect(getOpenOrdersByVendor()).rejects.toThrow(/cannot be read/);
  });

  it('a refused read (503) stays an error', async () => {
    // Only this route refuses: anything else the module graph reads on its own
    // timers (the sync manager) must not turn into an unhandled rejection here.
    get.mockImplementation(async (url: string) => {
      if (url === '/procurement/orders/open/by-vendor') throw new Error('503');
      return { data: null };
    });
    await expect(getOpenOrdersByVendor()).rejects.toThrow('503');
  });
});
