/**
 * A good (food or supply) on the list reads in its own unit: a type word, the
 * unit it is kept in, and its cost a unit. Never btl, glass, a price to change.
 * A drink row is drawn exactly as before.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InvRow } from './useInventoryNextData';
import InventoryTable, { goodUnit, type InventoryTableProps } from './InventoryTable';

vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ wineName }: { wineName: string }) => <button type="button">Change your price for {wineName}</button>,
}));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1', wineId: 'w1', name: 'Gravner Ribolla', libraryName: null, producer: 'Gravner', type: 'orange', kind: 'wine',
    vintage: 2016, grape: null, bottleSizeMl: 750, stock: 3, shadow: 2, par: 6, reorderPoint: null, analyticsReadable: true,
    velocity: 1, runway: 3, daysSinceSale: 1, deadStock: false, usageSource: null, usageSince: null, usageUntil: null, usageQty: null, bottle: 92, glass: 18, pourMl: 150, wac: 40,
    costProvenance: 'invoice', value: 120, lastCountedAt: null, openMl: 0, zones: [{ locationId: 'z1', qty: 3 }],
    providerId: null, providerName: null, standing: 'below', active: true, ...over,
  };
}
const WINE = row();
const LEMONS = row({ id: 'f1', wineId: null, name: 'Lemons', producer: null, type: null, kind: 'food', vintage: null, bottle: null, glass: null, wac: 2.5, value: 7.5, stock: 3000, shadow: 3000, par: 5000 });

function renderTable(rows: InvRow[], over: Partial<InventoryTableProps> = {}) {
  const goods = new Map(rows.map((r) => [r.id, r.kind === 'food' || r.kind === 'supply' ? r.kind : 'drink'] as const));
  return render(
    <MemoryRouter>
      <InventoryTable
        rows={rows}
        uomOf={(r) => (r.id === 'f1' ? 'g' : null)}
        goodOf={(r) => goods.get(r.id) ?? 'drink'}
        grouped={false}
        openId={null}
        onToggle={() => {}}
        advice={{ status: 'loading' }}
        onPriceChanged={() => {}}
        canManage
        currency={{ state: 'recorded', code: 'EUR' }}
        zoneName={() => 'Cellar'}
        locations={[]}
        locationsUnavailable={false}
        providers={null}
        providersError={null}
        restaurantId="r1"
        {...over}
      />
    </MemoryRouter>,
  );
}

describe('InventoryTable: goods read in their own unit', () => {
  it('a food row shows Food, its unit and cost a unit, and nothing wine-shaped', () => {
    renderTable([LEMONS]);
    const tr = screen.getByTestId('inv-row-f1');
    expect(within(tr).getByText('Food')).toBeTruthy();
    expect(tr.textContent).toContain('kept in kg');
    expect(tr.textContent).toContain('cost');
    expect(tr.textContent).toContain('a kg');
    for (const bad of ['btl', 'glass', 'Change your price', 'Add a bottle', 'not recorded']) {
      expect(tr.textContent).not.toContain(bad);
    }
  });

  it('a cost per gram is shown per kg', () => {
    renderTable([LEMONS]);
    expect(screen.getByTestId('inv-row-f1').textContent).toMatch(/2,500.*a kg/);
  });

  it('a drink row keeps its type, producer and the price cell', () => {
    renderTable([WINE]);
    const tr = screen.getByTestId('inv-row-i1');
    expect(tr.textContent).toContain('Gravner · 2016');
    expect(within(tr).getByText(/Change your price for Gravner Ribolla/)).toBeTruthy();
    expect(tr.textContent).not.toContain('kept in');
  });

  it('heads the price column for drinks only as before, and plainly over a mixed list', () => {
    const { unmount } = renderTable([WINE]);
    expect(screen.getByRole('columnheader', { name: /Your price btl · glass/ })).toBeTruthy();
    unmount();
    renderTable([WINE, LEMONS]);
    expect(screen.queryByText(/btl · glass/)).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Price or cost a unit/ })).toBeTruthy();
  });

  it('a food with no cost known shows a dash, not 0', () => {
    renderTable([row({ ...LEMONS, wac: null, value: null })]);
    const cell = screen.getByTestId('inv-row-f1').querySelector('[data-label="Your price"]')!;
    expect(cell.textContent).toBe('—');
    expect(cell.textContent).not.toContain('0');
  });

  it('says a counted good "each" and a poured one "a litre", never "a item" or "a l"', () => {
    expect(goodUnit('each')).toEqual({ factor: 1, kept: 'kept by the piece', per: 'each' });
    expect(goodUnit('ml')).toEqual({ factor: 1000, kept: 'kept in litres', per: 'a litre' });
    expect(goodUnit('g')).toEqual({ factor: 1000, kept: 'kept in kg', per: 'a kg' });
    expect(goodUnit('case').per).toBe('a case');
  });

  it('says a good stored in kg, l or mg "kept in kg" / "a litre", never "by the kg" or "a l"', () => {
    expect(goodUnit('kg')).toEqual({ factor: 1, kept: 'kept in kg', per: 'a kg' });
    expect(goodUnit('l')).toEqual({ factor: 1, kept: 'kept in litres', per: 'a litre' });
    expect(goodUnit('mg')).toEqual({ factor: 1_000_000, kept: 'kept in kg', per: 'a kg' });
  });
});
