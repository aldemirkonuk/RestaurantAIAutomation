/**
 * F-1514 (sim 49, integ20-new-house-30-days.md): opening stock loaded after
 * the first menu COUNTS the wines the menu seeded at 0. Sent as a plain spot
 * count, the first month close read the whole cellar as "bottles over". ADR
 * 0335 §2: it is the opening count variance is measured from, so the count
 * says it is one.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  bulkCreateInventoryItems: vi.fn(),
  recordSpotCount: vi.fn(async () => ({ item: null })),
}));
vi.mock('../../../services/api/inventory', () => api);
vi.mock('../../../lib/csvImport', async (orig) => ({
  ...(await orig<typeof import('../../../lib/csvImport')>()),
  readCsvFile: vi.fn(async () => 'Wine,Vintage,Quantity\nYakut,2020,7'),
}));

import { OpeningStockImport } from './OpeningStockImport';

describe('OpeningStockImport (F-1514)', () => {
  it('[REVERT-FAILS] counts a wine already carried as its opening count', async () => {
    render(
      <OpeningStockImport
        carried={[{ inventoryId: 'inv-1', name: 'Yakut', vintage: 2020 }]}
        shelves={[]}
        onDone={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Opening stock (CSV)'), {
      target: { files: [new File(['x'], 'stock.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Load 1 wine' }));
    await waitFor(() =>
      expect(api.recordSpotCount).toHaveBeenCalledWith('inv-1', expect.objectContaining({ countedQty: 7, opening: true })),
    );
    expect(api.bulkCreateInventoryItems).not.toHaveBeenCalled();
  });
});
