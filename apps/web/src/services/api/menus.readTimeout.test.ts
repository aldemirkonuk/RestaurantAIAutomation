/**
 * A menu read is one billed call that can take minutes; the shared client
 * gives up at 30 s while the gateway keeps reading, so a retry was billed
 * twice (r102 menu-func-1). The read names its own, longer, timeout.
 */
import { describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
  getActiveRestaurantId: () => 'r-1',
}));

import { importMenu, makeMenuCurrent, MENU_READ_TIMEOUT_MS } from './menus';

describe('importMenu', () => {
  it('outlasts the shared 30 s client timeout, since the gateway reads for minutes', async () => {
    post.mockResolvedValue({ data: { menuId: 'm-1' } });
    await importMenu('scan', { imageBase64: 'JVBERi0=' });
    expect(MENU_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(post).toHaveBeenCalledWith('/menus/import', expect.objectContaining({ method: 'scan' }), {
      timeout: MENU_READ_TIMEOUT_MS,
    });
  });

  it('making a menu current names the long timeout too: the carry runs inside that call (r102 menu-func-2)', async () => {
    post.mockResolvedValue({ data: { outcome: 'made_current' } });
    await makeMenuCurrent('m-1', 'fp-1');
    expect(post).toHaveBeenLastCalledWith('/menu-versions/m-1/make-current', { fingerprint: 'fp-1' }, { timeout: MENU_READ_TIMEOUT_MS });
  });
});
