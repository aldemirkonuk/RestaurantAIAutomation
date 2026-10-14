/**
 * F-1514 (sim 49, integ20-new-house-30-days.md): opening stock loaded after
 * the first menu COUNTS the wines the menu seeded at 0. Sent as a plain spot
 * count, the first month close read the whole cellar as "bottles over". ADR
 * 0335 §2: it is the opening count variance is measured from, so the count
 * says it is one.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const csv = vi.hoisted(() => ({ text: 'Wine,Vintage,Quantity,Cost\nYakut,2020,7,300' }));
const api = vi.hoisted(() => ({
  bulkCreateInventoryItems: vi.fn(),
  recordSpotCount: vi.fn(async (..._a: unknown[]) => ({ item: null, count: { costApplied: true } as { costApplied?: boolean } })),
}));
vi.mock('../../../services/api/inventory', () => api);
vi.mock('../../../lib/csvImport', async (orig) => ({
  ...(await orig<typeof import('../../../lib/csvImport')>()),
  readCsvFile: vi.fn(async () => csv.text),
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
    expect(await screen.findByText(/Already had a cost before this file, which was kept: Yakut/)).toBeTruthy();
  });

  // F-1556 (integ28): one uncosted wine on two shelves. The cost went with the
  // first line, which costed the wine, so the second line's bottles landed
  // uncosted and the outcome called the first line "already had a cost".
  it('[REVERT-FAILS] costs a wine on two shelves once, with its last line, so every shelf is costed', async () => {
    api.recordSpotCount.mockClear();
    csv.text = 'Wine,Vintage,Quantity,Shelf,Cost\nYakut,2020,4,Cellar,300\nYakut,2020,2,Bar,';
    // A count sent with no cost reports no cost decision; the costed last
    // line finds no costed bottle (the first line's are uncosted) and applies.
    api.recordSpotCount
      .mockResolvedValueOnce({ item: null, count: {} })
      .mockResolvedValueOnce({ item: null, count: { costApplied: true } });
    render(
      <OpeningStockImport
        carried={[{ inventoryId: 'inv-1', name: 'Yakut', vintage: 2020, hasCost: false }]}
        shelves={[
          { id: 'shelf-c', name: 'Cellar' },
          { id: 'shelf-b', name: 'Bar' },
        ]}
        onDone={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Opening stock (CSV)'), {
      target: { files: [new File(['x'], 'stock.csv', { type: 'text/csv' })] },
    });
    expect(await screen.findAllByText(/so this one is used for its bottles on every shelf in this file/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Load 2 wines' }));
    await waitFor(() => expect(api.recordSpotCount).toHaveBeenCalledTimes(2));
    expect(api.recordSpotCount.mock.calls[0][1]).toMatchObject({ locationId: 'shelf-c', countedQty: 4 });
    expect(api.recordSpotCount.mock.calls[0][1]).not.toHaveProperty('costPerBottle');
    expect(api.recordSpotCount.mock.calls[1][1]).toMatchObject({ locationId: 'shelf-b', countedQty: 2, costPerBottle: 300 });
    // The cost was sent once, with the last line, so no line of this file is
    // reported as a cost the wine already had.
    expect(await screen.findByText(/0 received · 2 counted/)).toBeTruthy();
    expect(screen.queryByText(/Already had a cost/)).toBeNull();
    csv.text = 'Wine,Vintage,Quantity,Cost\nYakut,2020,7,300';
  });

  // F-1582: when the costed last line fails, the earlier shelf's bottles are
  // already counted uncosted. The outcome names the wine under "cost not
  // applied", says those bottles have no cost, and that a re-send applies it.
  it('[REVERT-FAILS] says the cost was not applied when the last line of a wine on two shelves fails', async () => {
    api.recordSpotCount.mockClear();
    csv.text = 'Wine,Vintage,Quantity,Shelf,Cost\nYakut,2020,4,Cellar,300\nYakut,2020,2,Bar,';
    api.recordSpotCount
      .mockResolvedValueOnce({ item: null, count: {} })
      .mockRejectedValueOnce(new Error('The count could not be saved'));
    render(
      <OpeningStockImport
        carried={[{ inventoryId: 'inv-1', name: 'Yakut', vintage: 2020, hasCost: false }]}
        shelves={[
          { id: 'shelf-c', name: 'Cellar' },
          { id: 'shelf-b', name: 'Bar' },
        ]}
        onDone={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Opening stock (CSV)'), {
      target: { files: [new File(['x'], 'stock.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Load 2 wines' }));
    const said = await screen.findByTestId('opening-stock-cost-not-applied');
    expect(said.textContent).toBe(
      'Cost not applied: Yakut. The bottles already counted on its other shelves have no cost yet. Sending the file again applies it.',
    );
    expect(screen.getByText(/Not changed: Yakut/)).toBeTruthy();
    csv.text = 'Wine,Vintage,Quantity,Cost\nYakut,2020,7,300';
  });
});
