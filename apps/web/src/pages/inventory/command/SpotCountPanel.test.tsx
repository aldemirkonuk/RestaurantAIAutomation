/**
 * SpotCountPanel is a dialog (F-321): it says so to a screen reader, takes
 * focus when it opens, closes on Escape, and its close button has a name.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpotCountPanel } from './SpotCountPanel';
import type { InventoryItem } from '../useInventoryPage';

vi.mock('../../../lib/spotCountOutbox', () => ({
  submitSpotCount: vi.fn(),
  newClientCountId: () => 'c-1',
}));

const item = { inventoryId: 'inv-1', name: 'Produttori Barbaresco', liveStock: 6 } as unknown as InventoryItem;

describe('SpotCountPanel as a dialog', () => {
  it('is a named modal dialog that takes focus', () => {
    render(<SpotCountPanel item={item} onClose={vi.fn()} onCommitted={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Spot count' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
  });

  it('closes on Escape and from a named close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SpotCountPanel item={item} onClose={onClose} onCommitted={vi.fn()} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
