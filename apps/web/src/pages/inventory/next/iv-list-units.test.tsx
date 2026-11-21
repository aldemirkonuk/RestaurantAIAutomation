/**
 * A weighed or poured good's quantity says its unit on the /inventory list, on
 * the desktop table and on the phone card: "2.5 kg", "750 ml", "12 bottles",
 * never a bare number the reader has to guess the unit of. A row whose unit
 * was never read (not built by toRow) keeps the plain count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import InventoryTable, { type InventoryTableProps } from './InventoryTable';
import { listFigure, listUnitTail } from './ItemCards';
import { toRow, type InvRow } from './useInventoryNextData';
import { normalizeInventoryItem } from '../../../services/api/inventory';

vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ bottle }: { bottle: number | null }) => <span data-testid="price-cell">{bottle}</span>,
}));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

const good = (id: string, uom: string | null, stock: number, par: number, shadow = stock, velocity = 0) =>
  toRow({ id, wineId: null, displayName: `Good ${id}`, uom, stockLive: stock, shadowStock: shadow, thresholdMin: par, velocityPerDay: velocity } as never, null);

const base: Omit<InventoryTableProps, 'rows'> = {
  openId: null, onToggle: vi.fn(), canManage: false, currency: { state: 'recorded', code: 'EUR' },
  zoneName: () => 'Cellar', locations: [], locationsUnavailable: false, providers: [], providersError: null,
  restaurantId: 'r1', advice: { status: 'loading' }, onPriceChanged: vi.fn(), grouped: false,
};
const draw = (rows: InvRow[]) => render(<InventoryTable {...base} rows={rows} />);
const setPhone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('767'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
};
const cell = (id: string, label: string) => screen.getByTestId(`inv-row-${id}`).querySelector(`td[data-label="${label}"]`)!.textContent;

afterEach(() => setPhone(false));

describe('the figures a list says', () => {
  it('reads a weighed or poured figure in its own unit', () => {
    expect(listFigure(2500, 'g')).toBe('2.5 kg');
    expect(listFigure(500, 'g')).toBe('500 g');
    expect(listFigure(750, 'ml')).toBe('750 ml');
    expect(listFigure(1500, 'ml')).toBe('1.5 l');
    expect(listFigure(null, 'g')).toBe('—');
  });
  it('says a counted unit once, after the line', () => {
    expect(listUnitTail('bottle', 12)).toBe('bottles');
    expect(listUnitTail(null, 1)).toBe('bottle');
    expect(listUnitTail('each', 3)).toBe('items');
    expect(listUnitTail('each', 1)).toBe('item');
    expect(listUnitTail('keg', 2)).toBe('kegs');
    expect(listUnitTail('g', 3)).toBeNull();
    expect(listUnitTail(undefined, 3)).toBeNull();
    expect(listFigure(12, undefined)).toBe('12');
  });
  it('toRow carries the good\'s unit, null when none is recorded', () => {
    expect(good('a', 'g', 1, 1).uom).toBe('g');
    expect(good('b', null, 1, 1).uom).toBeNull();
  });
});

describe('the desktop table', () => {
  it('a weighed good: every figure carries kg or g', () => {
    draw([good('flour', 'g', 12400, 5000, 12500, 2500)]);
    expect(cell('flour', 'Live / shadow · par')).toBe('12.4 kg / 12.5 kg · 5 kg');
  });
  it('a poured good reads in l and ml', () => {
    draw([good('oil', 'ml', 750, 3000)]);
    expect(cell('oil', 'Live / shadow · par')).toBe('750 ml / 750 ml · 3 l');
  });
  it('a counted good says its unit once, after par', () => {
    draw([good('wine', null, 12, 4, 12), good('eggs', 'each', 30, 24, 30)]);
    expect(cell('wine', 'Live / shadow · par')).toBe('12 / 12 · 4 bottles');
    expect(cell('eggs', 'Live / shadow · par')).toBe('30 / 30 · 24 items');
  });
  it('an unread count stays a dash with no unit after it', () => {
    draw([toRow({ id: 'x', displayName: 'X', uom: 'bottle', stockLive: null, shadowStock: null, thresholdMin: null } as never, null)]);
    expect(cell('x', 'Live / shadow · par')).toBe('— / — · —');
  });
  it('a stock the gateway did not send stays a dash through the normaliser, never "0 g" or Out', () => {
    const raw = { id: 'u', displayName: 'Unread flour', uom: 'g', stockLive: null, thresholdMin: 5000 };
    expect(normalizeInventoryItem(raw as never).stockLive).toBeNull();
    expect(normalizeInventoryItem({ ...raw, stockLive: undefined, stock_live: undefined } as never).stockLive).toBeNull();
    const row = toRow(normalizeInventoryItem(raw as never) as never, null);
    expect(row.stock).toBeNull();
    expect(row.standing).toBe('unknown');
    draw([row]);
    expect(cell('u', 'Live / shadow · par')).toContain('—');
    expect(cell('u', 'Live / shadow · par')).not.toMatch(/0 g/);
  });
  it('a counted zero is still a zero: 0 stays 0 and reads Out', () => {
    const row = toRow(normalizeInventoryItem({ id: 'z', displayName: 'Z', uom: 'g', stockLive: 0, thresholdMin: 5000 } as never) as never, null);
    expect(row.stock).toBe(0);
    expect(row.standing).toBe('out');
    expect(normalizeInventoryItem({ id: 'z', stock_live: 0 } as never).stockLive).toBe(0);
  });
  it('a pace for a weighed good says its unit a day', () => {
    draw([good('flour', 'g', 12400, 5000, 12500, 1250), good('wine', null, 12, 4, 12, 1.5)]);
    expect(cell('flour', 'Vel/day')).toBe('1.25 kg');
    expect(cell('wine', 'Vel/day')).toBe('1.5');
  });
});

describe('the phone card', () => {
  it('a weighed good: "2.5 kg live · par 5 kg"', () => {
    setPhone(true);
    draw([good('flour', 'g', 2500, 5000)]);
    expect(screen.getByTestId('inv-row-flour').textContent).toContain('2.5 kg live · par 5 kg');
  });
  it('a counted good: "12 bottles live · par 4"', () => {
    setPhone(true);
    draw([good('wine', null, 12, 4)]);
    expect(screen.getByTestId('inv-row-wine').textContent).toContain('12 bottles live · par 4');
  });
  it('one of a counted unit is singular', () => {
    setPhone(true);
    draw([good('keg', 'keg', 1, 2)]);
    expect(screen.getByTestId('inv-row-keg').textContent).toContain('1 keg live · par 2');
  });
});
