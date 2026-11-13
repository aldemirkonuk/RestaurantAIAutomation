/**
 * The remove modal says a batch the way each item in it is: a mixed batch of
 * wines and a good with no library title keeps the wines' library line, and
 * the good is zeroed with no wineId (batch review of #1024).
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ reconcile: vi.fn(), del: vi.fn() }));
vi.mock('../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  reconcileItem: api.reconcile,
  deleteInventoryItem: api.del,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RemoveFromInventoryModal } from './RemoveFromInventoryModal';
import type { InventoryItem } from '../../pages/inventory/useInventoryPage';

const item = (over: Partial<InventoryItem>) =>
  ({ id: 'w1', inventoryId: 'i1', name: 'Barolo', liveStock: 0, shadowStock: 0, openMl: 0, wac: null, price: null, ...over }) as InventoryItem;

function mount(items: InventoryItem[]) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <RemoveFromInventoryModal isOpen items={items} onClose={vi.fn()} onRemoved={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('RemoveFromInventoryModal, said per batch', () => {
  it('a mixed batch is "items" and still says the wines stay in the Wine Library', async () => {
    api.reconcile.mockResolvedValue({});
    api.del.mockResolvedValue({});
    mount([
      item({ id: 'w1', inventoryId: 'i1', name: 'Barolo', liveStock: 2 }),
      item({ id: 'w2', inventoryId: 'i2', name: 'Chablis' }),
      item({ id: 'w3', inventoryId: 'i3', name: 'Rioja' }),
      item({ id: '', inventoryId: 'i4', name: 'Flour 00', liveStock: 2250 }),
    ]);
    expect(screen.getByRole('heading', { name: 'Remove 4 items from inventory' })).toBeTruthy();
    expect(screen.getByTestId('remove-keeps').textContent).toBe(
      'Their history stays on the book, and the wines stay in your Wine Library — each can be added again',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove 4 items' }));
    });
    expect(api.reconcile).toHaveBeenCalledTimes(2);
    const byId = Object.fromEntries(api.reconcile.mock.calls.map((c) => [c[0], c[1]]));
    expect(byId.i1).toEqual(expect.objectContaining({ wineId: 'w1', actualCount: 0 }));
    expect(byId.i4).toEqual(expect.objectContaining({ actualCount: 0 }));
    expect('wineId' in byId.i4).toBe(false);
    expect(api.del).toHaveBeenCalledTimes(4);
  });

  it('a batch of wines keeps the library line, plural', () => {
    mount([item({ id: 'w1', inventoryId: 'i1' }), item({ id: 'w2', inventoryId: 'i2', name: 'Chablis' })]);
    expect(screen.getByRole('heading', { name: 'Remove 2 wines from inventory' })).toBeTruthy();
    expect(screen.getByTestId('remove-keeps').textContent).toBe('Keeps the wines in your Wine Library — re-add anytime');
  });

  it('one wine says what it always said', () => {
    mount([item({})]);
    expect(screen.getByTestId('remove-keeps').textContent).toBe('Keeps the wine in your Wine Library — re-add anytime');
  });

  it('a batch of goods with no library title never mentions the Wine Library', () => {
    mount([item({ id: '', inventoryId: 'i1', name: 'Flour 00' }), item({ id: '', inventoryId: 'i2', name: 'Napkins' })]);
    expect(screen.getByTestId('remove-keeps').textContent).toBe('Their history stays on the book — each can be added again');
  });
});
