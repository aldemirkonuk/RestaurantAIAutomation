/**
 * Staff read quantities on the list, not what the house paid (r24 walk B1):
 * no value-at-cost column, no food cost a unit, and a read sentence that says
 * nothing about cost. The selling price stays: staff sell at it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readSentence, type InvRow } from './useInventoryNextData';
import InventoryTable, { type InventoryTableProps } from './InventoryTable';

vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ wineName }: { wineName: string }) => <button type="button">Change your price for {wineName}</button>,
}));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1', wineId: 'w1', name: 'Gravner Ribolla', libraryName: null, producer: 'Gravner', type: 'orange', kind: 'wine',
    vintage: 2016, grape: null, bottleSizeMl: 750, stock: 3, shadow: 2, par: 6, reorderPoint: null, analyticsReadable: true,
    velocity: 1, runway: 3, daysSinceSale: 1, deadStock: false, bottle: 92, glass: 18, pourMl: 150, wac: 41,
    costProvenance: 'invoice', value: 123, lastCountedAt: null, openMl: 0, zones: [{ locationId: 'z1', qty: 3 }],
    providerId: null, providerName: null, standing: 'below', active: true, ...over,
  };
}
const WINE = row();
const LEMONS = row({ id: 'f1', wineId: null, name: 'Lemons', producer: null, type: null, kind: 'food', vintage: null, bottle: null, glass: null, wac: 0.0025, value: 7.5, stock: 3000, shadow: 3000, par: 5000 });

function renderTable(rows: InvRow[], over: Partial<InventoryTableProps> = {}) {
  return render(
    <MemoryRouter>
      <InventoryTable
        rows={rows}
        uomOf={(r) => (r.id === 'f1' ? 'g' : null)}
        goodOf={(r) => (r.kind === 'food' ? 'food' : 'drink')}
        grouped
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

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');

describe('the list for staff carries no cost', () => {
  it('an owner reads the value at cost and a food cost a unit', () => {
    renderTable([WINE, LEMONS]);
    expect(headers().some((h) => h.includes('at cost'))).toBe(true);
    expect(screen.getByTestId('inv-row-i1').textContent).toContain('123');
    expect(screen.getByTestId('inv-row-f1').textContent).toMatch(/cost .*2[.,]50.* a kg/);
  });

  it('staff read no value column, no value and no cost a unit, but keep the selling price', () => {
    renderTable([WINE, LEMONS], { canManage: false });
    expect(headers().some((h) => h.includes('Value'))).toBe(false);
    const wine = screen.getByTestId('inv-row-i1');
    expect(wine.querySelector('td[data-label="Value at cost"]')).toBeNull();
    expect(wine.textContent).not.toContain('123');
    expect(wine.textContent).toContain('92');
    const food = screen.getByTestId('inv-row-f1');
    expect(within(food).getByText('not shown')).toBeTruthy();
    expect(food.textContent).not.toMatch(/2[.,]50/);
    expect(food.textContent).not.toContain('€');
  });

  it('an owner reads an unknown value as the dash, never 0', () => {
    renderTable([row({ wac: null, value: null })]);
    expect(screen.getByTestId('inv-row-i1').querySelector('td[data-label="Value at cost"]')!.textContent).toBe('—');
  });

  it('a severity heading spans the columns staff actually see', () => {
    renderTable([WINE], { canManage: false });
    const cols = screen.getAllByRole('columnheader').length;
    const heading = document.querySelector('td[colspan]') as HTMLTableCellElement | null;
    expect(heading).not.toBeNull();
    expect(Number(heading!.getAttribute('colspan'))).toBe(cols);
  });
});

describe('the read sentence for staff says nothing about cost', () => {
  const eur = { state: 'recorded', code: 'EUR' } as const;

  it('an owner reads what the stock holds at cost', () => {
    const s = readSentence([WINE], eur, false, null);
    expect(s).toContain('At cost the cellar holds');
    expect(s).toContain('€');
  });

  it('staff read the counts alone: no cost, no money, no "not on the books"', () => {
    const s = readSentence([WINE], eur, false, null, () => null, false);
    expect(s).toContain('1 title');
    expect(s).not.toContain('At cost');
    expect(s).not.toContain('€');
    expect(s).not.toContain('cost on the books');
    expect(s).not.toContain('market');
  });
});
