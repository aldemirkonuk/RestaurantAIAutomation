import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { InventoryItem } from '../useInventoryPage';

const m = vi.hoisted(() => ({
  photo: vi.fn(),
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../../stores', () => ({ useNotificationStore: () => m.toast }));
vi.mock('../../../services/api/inventory', () => ({ estimateCountFromPhoto: m.photo }));
vi.mock('../../../lib/spotCountOutbox', () => ({ submitSpotCount: vi.fn(), newClientCountId: () => 'c1' }));

import { SpotCountPanel } from './SpotCountPanel';

const shoot = () => {
  render(
    <SpotCountPanel
      item={{ inventoryId: 'i1', name: 'House lager', liveStock: 4 } as unknown as InventoryItem}
      onClose={() => {}}
      onCommitted={() => {}}
    />,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'shelf.jpg', { type: 'image/jpeg' })] } });
};

describe('SpotCountPanel photo toast (inventory walk #7, I2: G11, ADR 0104)', () => {
  it('says what the photo suggests with no confidence word', async () => {
    m.photo.mockResolvedValue({ suggestedQty: 9, confidence: 'medium', note: 'Nine on the shelf.' });
    shoot();
    await waitFor(() => expect(m.toast.info).toHaveBeenCalled());
    const said = m.toast.info.mock.calls[0].join(' ');
    expect(said).toContain('Photo suggests 9');
    expect(said.toLowerCase()).not.toContain('confidence');
    expect(said).not.toContain('medium');
  });

  it('says the photo gave no count, and its note once, beside the photo (QA round 10b)', async () => {
    m.photo.mockResolvedValue({ suggestedQty: null, confidence: 'low', note: 'Too blurry.' });
    shoot();
    await waitFor(() => expect(m.toast.error).toHaveBeenCalled());
    expect(m.toast.error).toHaveBeenCalledWith('The photo gave no count');
    await waitFor(() => expect(document.body.textContent).toContain('Too blurry.'));
  });
});
