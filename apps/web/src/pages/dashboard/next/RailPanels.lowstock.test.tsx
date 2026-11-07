/**
 * "Running low" on the dashboard rail reads `GET /inventory/:id/low-stock`,
 * which serves `v_low_stock_items`. Since migration
 * 20270502100000_every_good_can_run_low that view holds every house good, not
 * only wines, and carries the good's unit (`uom`). A flour at 200 of 500 is
 * grams: the line must say so, and never call it bottles.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '@/services/api/types';
import { normalizeInventoryItem } from '@/services/api/inventory';
import { LowStockPanel, unitWord } from './RailPanels';

/** Rows as the gateway serves them: raw view columns, then the service normalizer. */
function rows(raw: Array<Record<string, unknown>>): InventoryItem[] {
  return raw.map((r) => normalizeInventoryItem(r as never));
}

function lineFor(name: string): HTMLElement {
  const li = screen.getByText(name).closest('li');
  if (!li) throw new Error(`no line for ${name}`);
  return li as HTMLElement;
}

describe('LowStockPanel — every good, in its own unit', () => {
  it('names a house beer and a flour, and says grams for the flour and bottles for the wine', () => {
    render(
      <MemoryRouter>
        <LowStockPanel
          items={rows([
            { id: 'w', wine_name: 'Barolo Cannubi', vintage: 2019, stock_live: 1, threshold_min: 6, kind: 'wine', uom: 'bottle' },
            { id: 'b', wine_name: 'House Lager', vintage: null, stock_live: 2, threshold_min: 24, kind: 'beer', uom: 'bottle' },
            { id: 'f', wine_name: 'Flour', vintage: null, stock_live: 200, threshold_min: 500, kind: 'food', uom: 'g' },
            { id: 'l', wine_name: 'Lemons', vintage: null, stock_live: 0, threshold_min: 1, kind: 'food', uom: 'each' },
          ])}
        />
      </MemoryRouter>,
    );

    const flour = lineFor('Flour');
    expect(flour.textContent).toMatch(/200\s*\/ min 500 g$/);
    expect(flour.textContent).not.toMatch(/bottle/);

    expect(lineFor('Barolo Cannubi').textContent).toMatch(/1\s*\/ min 6 bottles$/);
    expect(lineFor('House Lager').textContent).toMatch(/2\s*\/ min 24 bottles$/);
    expect(lineFor('Lemons').textContent).toMatch(/0\s*\/ min 1 unit$/);
    expect(within(lineFor('Flour')).getByRole('link').getAttribute('href')).toBe('/inventory?wine=Flour');
  });

  it('says no unit for a row from a view that does not carry one, as before', () => {
    render(
      <MemoryRouter>
        <LowStockPanel items={rows([{ id: 'w', wine_name: 'Old View Wine', stock_live: 1, threshold_min: 3 }])} />
      </MemoryRouter>,
    );
    expect(lineFor('Old View Wine').textContent).toMatch(/1\s*\/ min 3$/);
  });

  it('says nothing is running low without calling every good a cellar', () => {
    render(
      <MemoryRouter>
        <LowStockPanel items={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Nothing is running low.')).toBeInTheDocument();
    expect(screen.queryByText(/cellar/i)).toBeNull();
  });

  it('shows an unknown unit as written rather than calling it bottles', () => {
    expect(unitWord('crate', 4)).toBe('crate');
    expect(unitWord('KG', 2)).toBe('kg');
    expect(unitWord('bottle', 1)).toBe('bottle');
    expect(unitWord('bottle', 2)).toBe('bottles');
    expect(unitWord(null, 2)).toBeNull();
    expect(unitWord('  ', 2)).toBeNull();
  });
});
