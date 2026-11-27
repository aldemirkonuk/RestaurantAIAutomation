/**
 * The table renders with no auth or query providers.
 *
 * WHY. Row warming (a read on intent) belongs to the page, which has the
 * providers; the table only calls the `warm` it is handed. The table once
 * called useAuth and useQueryClient itself, so every test that draws it bare
 * (window, phone rows, typography, units) threw "useAuth must be used within an
 * AuthProvider" once #2312 met them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import InventoryTable from './InventoryTable';
import { type InvRow } from './useInventoryNextData';

vi.mock('../command/HousePriceCell', () => ({ HousePriceCell: () => null }));
vi.mock('./RowDropdown', () => ({ default: () => null }));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

const row = {
  id: 'i1', wineId: 'w1', name: 'Barolo', libraryName: null, producer: null, type: 'red', kind: 'wine',
  vintage: 2019, grape: null, bottleSizeMl: 750, stock: 4, shadow: 0, par: 6, reorderPoint: null,
  analyticsReadable: true, velocity: 1, runway: 4, daysSinceSale: 1, deadStock: false, abc: null,
  bottle: null, glass: null, pourMl: null, wac: null, costProvenance: null, value: null,
  lastCountedAt: null, openMl: null, zones: [], providerId: null, providerName: null,
  standing: 'ok', active: true,
} as unknown as InvRow;

const table = (warm?: (r: { id: string; name: string | null; kind: string | null }) => void) => (
  <InventoryTable
    rows={[row]}
    grouped={false}
    openId={null}
    onToggle={vi.fn()}
    advice={{ kind: 'none' } as never}
    onPriceChanged={vi.fn()}
    currency={{ code: 'USD' } as never}
    canManage
    warm={warm}
    zoneName={() => ''}
    locations={{ list: [], loading: false, unavailable: false } as never}
    locationsUnavailable={false}
    providers={[] as never}
    providersError={null}
    restaurantId="r1"
  />
);

afterEach(cleanup);

describe('the table with no providers', () => {
  it('draws, and a touch warms nothing', () => {
    render(table());
    expect(screen.getByTestId('inv-row-i1')).toBeTruthy();
    fireEvent.touchStart(screen.getByTestId('inv-row-i1'));
  });

  it('hands the row to the warm it was given on a touch', () => {
    const warm = vi.fn();
    render(table(warm));
    fireEvent.touchStart(screen.getByTestId('inv-row-i1'));
    expect(warm).toHaveBeenCalledWith({ id: 'i1', name: 'Barolo', kind: 'wine' });
  });
});
