/**
 * A scan is read in the background and the page polls for it (#1060-#1064), so
 * the call that sends the file ends at once and carries no read-length timeout:
 * the 10-minute stand-in (r102 menu-func-1) is gone (r104 menu-4). Putting it
 * back would hide a read that is cut off behind a wait of ten minutes.
 */
import { describe, expect, it, vi } from 'vitest';
import * as menusModule from './menus';

const post = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
  getActiveRestaurantId: () => 'r-1',
}));

import { importMenu } from './menus';

describe('importMenu', () => {
  it('sends the file with no read-length timeout of its own, since the read goes on in the background', async () => {
    post.mockResolvedValue({ data: { menuId: 'm-1' } });
    await importMenu('scan', { imageBase64: 'JVBERi0=' });
    const config = post.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(config).not.toHaveProperty('timeout');
    expect(menusModule).not.toHaveProperty('MENU_READ_TIMEOUT_MS');
  });
});
