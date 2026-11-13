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
import { LowStockPanel, stockAgainstMin, unitWord } from './RailPanels';

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

  it('ranks by how far each good has run down, not by a shortfall in mixed units', () => {
    // Raw shortfall (stock - min) would put Rice (-4000 g) first and push the
    // empty Barolo (-12 bottles) and the Lager (-23) below the fold.
    render(
      <MemoryRouter>
        <LowStockPanel
          items={rows([
            { id: '1', wine_name: 'Rice', stock_live: 1000, threshold_min: 5000, kind: 'food', uom: 'g' },
            { id: '2', wine_name: 'Milk', stock_live: 900, threshold_min: 2000, kind: 'food', uom: 'ml' },
            { id: '3', wine_name: 'Olive oil', stock_live: 500, threshold_min: 1000, kind: 'food', uom: 'ml' },
            { id: '4', wine_name: 'Flour', stock_live: 200, threshold_min: 500, kind: 'food', uom: 'g' },
            { id: '5', wine_name: 'Sugar', stock_live: 100, threshold_min: 400, kind: 'food', uom: 'g' },
            { id: '6', wine_name: 'Butter', stock_live: 50, threshold_min: 250, kind: 'food', uom: 'g' },
            { id: '7', wine_name: 'House Lager', stock_live: 1, threshold_min: 24, kind: 'beer', uom: 'bottle' },
            { id: '8', wine_name: 'Barolo Cannubi', vintage: 2019, stock_live: 0, threshold_min: 12, kind: 'wine', uom: 'bottle' },
          ])}
        />
      </MemoryRouter>,
    );

    const shown = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/inventory?'))
      .map((a) => a.textContent);
    expect(shown).toEqual([
      'Barolo Cannubi 2019',
      'House Lager',
      'Butter',
      'Rice',
      'Sugar',
      'Flour',
    ]);
    expect(lineFor('Barolo Cannubi').textContent).toMatch(/0\s*\/ min 12 bottles$/);
    expect(screen.getByText('and 2 more below minimum')).toBeInTheDocument();
    expect(screen.queryByText('Milk')).toBeNull();
    expect(screen.queryByText('Olive oil')).toBeNull();
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

describe('LowStockPanel — a good nobody has counted is not running low (OD-161)', () => {
  it('says "not counted yet" instead of a figure, and ranks it after the counted ones', () => {
    render(
      <MemoryRouter>
        <LowStockPanel
          items={rows([
            { id: 'u', wine_name: 'Barolo Cannubi', vintage: null, stock_live: 0, threshold_min: 6, kind: 'wine', uom: 'bottle', last_counted_at: null },
            { id: 'f', wine_name: 'Flour', vintage: null, stock_live: 200, threshold_min: 500, kind: 'food', uom: 'g', last_counted_at: '2026-11-01T00:00:00Z' },
          ])}
        />
      </MemoryRouter>,
    );
    expect(lineFor('Barolo Cannubi').textContent).toMatch(/not counted yet$/);
    expect(lineFor('Barolo Cannubi').textContent).not.toMatch(/min/);
    expect(lineFor('Flour').textContent).toMatch(/200\s*\/ min 500 g$/);
    const lines = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(lines[0]).toMatch(/^Flour/);
  });
});

describe('LowStockPanel — a kilo reads as a kilo, as on the list and in Lately', () => {
  /** The figures on a line, as one string: "2.5 / min 5 kg". */
  const said = (stock: number | null, min: number | null, uom: string | null) => {
    const r = stockAgainstMin(stock, min, uom);
    return `${r.stock}${r.stockUnit ? ` ${r.stockUnit}` : ''} / min ${r.min}${r.unit ? ` ${r.unit}` : ''}`;
  };

  it('reads 1,000 or more g, ml or mg a unit up, and keeps every gram', () => {
    expect(said(2500, 5000, 'g')).toBe('2.5 / min 5 kg');
    expect(said(1500, 3000, 'ml')).toBe('1.5 / min 3 l');
    expect(said(1001, 2000, 'g')).toBe('1.001 / min 2 kg');
    expect(said(1750, 2000, 'G')).toBe('1.75 / min 2 kg');
  });

  it('gives the stock its own unit only when it reads in a different one', () => {
    expect(said(800, 2000, 'g')).toBe('800 g / min 2 kg');
    expect(said(999, 1000, 'g')).toBe('999 g / min 1 kg');
    expect(said(2500, 500, 'mg')).toBe('2.5 g / min 500 mg');
    expect(said(200, 500, 'g')).toBe('200 / min 500 g');
  });

  it('leaves bottles, units and unknown units as they are', () => {
    expect(said(1250, 1500, 'bottle')).toBe('1,250 / min 1,500 bottles');
    expect(said(0, 1, 'each')).toBe('0 / min 1 unit');
    expect(said(1200, 2400, 'crate')).toBe('1,200 / min 2,400 crate');
    expect(said(1, 3, null)).toBe('1 / min 3');
  });

  it('a missing figure is a dash and the line keeps the other figure\'s unit', () => {
    expect(said(null, 2000, 'g')).toBe('— / min 2 kg');
    expect(said(2500, null, 'g')).toBe('2.5 / min — kg');
  });

  it('draws the scaled line in the panel', () => {
    render(
      <MemoryRouter>
        <LowStockPanel
          items={rows([
            { id: 'f', wine_name: 'Bread Flour', stock_live: 2500, threshold_min: 5000, kind: 'food', uom: 'g' },
            { id: 'o', wine_name: 'Olive Oil', stock_live: 800, threshold_min: 2000, kind: 'food', uom: 'ml' },
          ])}
        />
      </MemoryRouter>,
    );
    expect(lineFor('Bread Flour').textContent).toMatch(/2\.5\s*\/ min 5 kg$/);
    expect(lineFor('Olive Oil').textContent).toMatch(/800 ml\s*\/ min 2 l$/);
    expect(lineFor('Bread Flour').textContent).not.toMatch(/2,500|5,000/);
  });

  it('never takes a word from the object prototype for a unit', () => {
    expect(unitWord('constructor', 2)).toBe('constructor');
    expect(unitWord('__proto__', 2)).toBe('__proto__');
    expect(said(1500, 3000, 'constructor')).toBe('1,500 / min 3,000 constructor');
  });
});
