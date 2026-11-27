/**
 * r102 menu-motion-2: a read reports how much of the file the server has, as a
 * share from 0 to 1, so the drop zone's bar is determinate.
 */
import { describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
  getActiveRestaurantId: () => 'r-1',
}));

import { importMenu } from './menus';

describe('importMenu — upload progress', () => {
  it('turns axios loaded/total into a share, and says nothing when the size is unknown', async () => {
    post.mockImplementation(async (_u: string, _b: unknown, cfg?: { onUploadProgress?: (e: unknown) => void }) => {
      cfg?.onUploadProgress?.({ loaded: 50, total: 200 });
      cfg?.onUploadProgress?.({ loaded: 10 });
      return { data: { menuId: 'm-1', current: false, items: [] } };
    });
    const shares: Array<number | null> = [];
    await importMenu('scan', { imageBase64: 'JVBERi0=' }, { onUploadProgress: (s) => shares.push(s) });
    expect(shares).toEqual([0.25, null]);
  });

  it('adds no progress hook when the caller asked for none', async () => {
    post.mockResolvedValue({ data: { menuId: 'm-1', current: false, items: [] } });
    await importMenu('scan', { imageBase64: 'JVBERi0=' });
    // Neither a progress hook nor a read-length timeout rides on the call (r104 menu-4).
    expect(post.mock.calls.at(-1)?.[2]).toEqual({});
  });
});
