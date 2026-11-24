/**
 * The /inventory register's typography (critic N-18): a column that says only
 * a dash is hidden behind a "Columns" control, the live count is the figure the
 * eye lands on, the par bar grows with transform, and a status is a dot and a
 * word.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import InventoryTable, { type InventoryTableProps } from './InventoryTable';
import { emptyColumns } from './iv-columns';
import type { InvRow } from './useInventoryNextData';

vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ bottle }: { bottle: number | null }) => <span data-testid="price-cell">{bottle}</span>,
}));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1', wineId: null, name: 'Arborio rice', libraryName: null, producer: null, type: null, kind: 'wine',
    vintage: null, grape: null, bottleSizeMl: null, stock: 8, shadow: 0, par: 10, reorderPoint: null,
    analyticsReadable: true, velocity: null, runway: null, daysSinceSale: null, deadStock: false,
    usageSource: null, usageSince: null, usageUntil: null, usageQty: null, bottle: null, glass: null,
    pourMl: null, wac: null, costProvenance: null, value: null, lastCountedAt: null, openMl: null,
    zones: null, providerId: null, providerName: null, standing: 'below', active: true, ...over,
  } as InvRow;
}

const base: Omit<InventoryTableProps, 'rows'> = {
  openId: null, onToggle: vi.fn(), canManage: false, currency: { state: 'recorded', code: 'EUR' },
  zoneName: () => 'Cellar', locations: [], locationsUnavailable: false, providers: [], providersError: null,
  restaurantId: 'r1', advice: { status: 'loading' }, onPriceChanged: vi.fn(), grouped: false,
};
const draw = (rows: InvRow[], over: Partial<InventoryTableProps> = {}) =>
  render(<InventoryTable {...base} rows={rows} {...over} />);
const heads = () => Array.from(document.querySelectorAll('th')).map((t) => t.textContent);
const input = { canManage: false, libraryUnread: false, locationsUnavailable: false };

afterEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
});

describe('which columns say nothing', () => {
  it('names every column that is a dash for every row', () => {
    expect([...emptyColumns({ rows: [row(), row({ id: 'i2' })], ...input })].sort()).toEqual(
      ['Runway', 'Type', 'Used in', 'Value', 'Vel/day', 'Your price', 'Zone'].sort(),
    );
  });
  it('one row with a figure keeps its column', () => {
    const out = emptyColumns({ rows: [row(), row({ id: 'i2', velocity: 2, value: 30 })], ...input });
    expect(out.has('Vel/day')).toBe(false);
    expect(out.has('Value')).toBe(false);
    expect(out.has('Runway')).toBe(true);
  });
  it('never hides a failed read or the manager\'s price editor', () => {
    const out = emptyColumns({ rows: [row()], canManage: true, libraryUnread: true, locationsUnavailable: true });
    expect([...out]).not.toContain('Type');
    expect([...out]).not.toContain('Zone');
    expect([...out]).not.toContain('Your price');
  });
  it('hides nothing while any stock is unread: the dashes mean not read', () => {
    expect(emptyColumns({ rows: [row(), row({ id: 'u', stock: null, standing: 'unknown' })], ...input }).size).toBe(0);
  });
  it('a stocked good with no zone says Unassigned, so the Zone column stays', () => {
    expect(emptyColumns({ rows: [row({ zones: [] })], ...input }).has('Zone')).toBe(false);
  });
});

describe('the register', () => {
  it('hides the empty columns and offers them back from one Columns control', () => {
    draw([row(), row({ id: 'i2', name: 'Olive oil' })]);
    expect(heads()).toEqual(['Title', 'Live / shadow · par', 'Status']);
    fireEvent.click(screen.getByTestId('inv-columns'));
    expect(heads()).toContain('Zone');
    expect(heads()).toContain('Runway');
    expect(screen.getByTestId('inv-columns').textContent).toBe('Hide empty columns');
  });
  it('draws no control and no hiding when every column has something', () => {
    draw([row({ type: 'red', zones: [{ locationId: 'z', qty: 3 }], velocity: 1, runway: 4, bottle: 9, value: 5, usedIn: 2 })]);
    expect(screen.queryByTestId('inv-columns')).toBeNull();
    expect(heads()).toContain('Vel/day');
  });
  it('r105 g5: the Used in count opens the good, an unread count says unread and never 0', () => {
    const onUsedIn = vi.fn();
    const onToggle = vi.fn();
    draw([row({ id: 'u1', usedIn: 3 }), row({ id: 'u2', usedIn: null })], { onUsedIn, onToggle });
    expect(heads()).toContain('Used in');
    fireEvent.click(screen.getByRole('button', { name: /Used in 3 recipes/ }));
    expect(onUsedIn).toHaveBeenCalledWith('u1');
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByTestId('inv-usedin-u2').textContent).toBe('unread');
  });
  it('a row with no producer or vintage draws no bare dash line', () => {
    draw([row()]);
    expect(document.querySelector('.iv-producer')).toBeNull();
  });
  it('the live count is its own element and the cell text is unchanged', () => {
    draw([row({ stock: 1240, shadow: 1250, par: 1200 })]);
    const cell = screen.getByTestId('inv-row-i1').querySelector('td[data-label="Live / shadow · par"]')!;
    expect(cell.querySelector('.iv-live')!.textContent).toBe('1,240');
    expect(cell.textContent).toBe('1,240 / 1,250 · 1,200');
  });
  it('a status is a coloured dot and a word', () => {
    draw([row({ standing: 'out', stock: 0 })]);
    const st = within(screen.getByTestId('inv-row-i1')).getByText('Out').closest('td')!;
    expect(st.querySelector('.iv-dot')).not.toBeNull();
    expect(st.getAttribute('data-standing')).toBe('out');
  });
  it('the par bar is a scaleX of stock over par, never a width', () => {
    draw([row({ stock: 5, par: 10 })]);
    const fill = document.querySelector('.iv-parbar > i') as HTMLElement;
    expect(fill.style.transform).toBe('scaleX(0.5)');
    expect(fill.style.width).toBe('');
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/inventory/next/inventory-next.css'), 'utf8');
  it('rows are 56 px, the bar is 6 px and fills over 400 ms from scaleX(0)', () => {
    expect(css).toMatch(/\.iv-row\s*\{\s*height:\s*56px/);
    expect(css).toMatch(/\.iv-parbar\s*\{[^}]*height:\s*6px/);
    expect(css).toMatch(/animation:\s*iv-parfill 400ms/);
    expect(css).toMatch(/@keyframes iv-parfill\s*\{\s*from\s*\{\s*transform:\s*scaleX\(0\)/);
  });
  it('animates no layout property and no transition-all', () => {
    const block = css.slice(css.indexOf('.iv-parbar'), css.indexOf('.iv-openrow'));
    expect(block).not.toMatch(/transition:\s*all/);
    expect(block).not.toMatch(/animation:[^;]*width/);
  });
  it('reduced motion switches the page\'s animation off', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.iv-page \*/);
  });
});
