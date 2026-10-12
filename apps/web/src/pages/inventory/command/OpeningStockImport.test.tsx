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
  recordSpotCount: vi.fn(async (..._a: unknown[]) => ({ item: null, count: { costApplied: true } as { costApplied?: boolean } })),
}));
vi.mock('../../../services/api/inventory', () => api);
vi.mock('../../../lib/csvImport', async (orig) => ({
  ...(await orig<typeof import('../../../lib/csvImport')>()),
  readCsvFile: vi.fn(async () => 'Wine,Vintage,Quantity,Cost\nYakut,2020,7,300'),
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

  // F-1524: a menu-first house carries every wine with no cost. The file's
  // cost per bottle was dropped for all of them; the preview now says it is
  // used, and the count carries it.
  it('[REVERT-FAILS] says the file cost will be used for a wine with no cost, and sends it with the count', async () => {
    api.recordSpotCount.mockClear();
    render(
      <OpeningStockImport
        carried={[{ inventoryId: 'inv-1', name: 'Yakut', vintage: 2020, hasCost: false }]}
        shelves={[]}
        onDone={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Opening stock (CSV)'), {
      target: { files: [new File(['x'], 'stock.csv', { type: 'text/csv' })] },
    });
    expect(await screen.findByText(/this wine has no cost yet, so this one is used/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 wine' }));
    await waitFor(() =>
      expect(api.recordSpotCount).toHaveBeenCalledWith('inv-1', expect.objectContaining({ opening: true, costPerBottle: 300 })),
    );
  });

  it('keeps a cost the wine already has, says so, and sends no cost', async () => {
    api.recordSpotCount.mockClear();
    render(
      <OpeningStockImport
        carried={[{ inventoryId: 'inv-1', name: 'Yakut', vintage: 2020, hasCost: true }]}
        shelves={[]}
        onDone={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Opening stock (CSV)'), {
      target: { files: [new File(['x'], 'stock.csv', { type: 'text/csv' })] },
    });
    expect(await screen.findByText(/this wine already has a cost, which is kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 wine' }));
    await waitFor(() => expect(api.recordSpotCount).toHaveBeenCalled());
    expect(api.recordSpotCount.mock.calls[0][1]).not.toHaveProperty('costPerBottle');
  });

  it('says when a wine turned out to have a cost already, which was kept', async () => {
    api.recordSpotCount.mockClear();
    api.recordSpotCount.mockResolvedValueOnce({ item: null, count: { costApplied: false } });
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
    expect(await screen.findByText(/Already had a cost, which was kept: Yakut/)).toBeTruthy();
  });
});
