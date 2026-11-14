import { describe, expect, it } from 'vitest';
import { bottleSizeCell, countUnit, inCountUnit, paceInCountUnit, valuationColumns, wacInCountUnit } from './iv-export';
import type { InvRow } from './useInventoryNextData';

/**
 * Inventory r28, gap 3. The book keeps whole grams and millilitres (ADR 0070),
 * so a file that prints the book's number with no unit invites a thousandfold
 * slip from anyone who weighs in kilograms. The exports say the unit on every
 * row and write weighed and poured goods in kg and l.
 */
describe('the unit an export counts a good in', () => {
  it('reads grams in kg, milligrams in g, millilitres in l, and leaves the rest alone', () => {
    expect(countUnit('g')).toEqual({ unit: 'kg', per: 1000 });
    expect(countUnit('mg')).toEqual({ unit: 'g', per: 1000 });
    expect(countUnit('ml')).toEqual({ unit: 'l', per: 1000 });
    expect(countUnit('kg')).toEqual({ unit: 'kg', per: 1 });
    expect(countUnit('each')).toEqual({ unit: 'each', per: 1 });
    expect(countUnit('case')).toEqual({ unit: 'case', per: 1 });
  });

  it('calls a good with no recorded unit a bottle, as the page does', () => {
    expect(countUnit(null)).toEqual({ unit: 'bottle', per: 1 });
    expect(countUnit(undefined)).toEqual({ unit: 'bottle', per: 1 });
    expect(countUnit('bottle')).toEqual({ unit: 'bottle', per: 1 });
  });

  it('turns a book quantity into the counted unit exactly, and keeps an unread one blank', () => {
    expect(inCountUnit(12400, 'g')).toBe(12.4);
    expect(inCountUnit(12401, 'g')).toBe(12.401);
    expect(inCountUnit(750, 'ml')).toBe(0.75);
    expect(inCountUnit(12, null)).toBe(12);
    expect(inCountUnit(0, 'g')).toBe(0);
    expect(inCountUnit(null, 'g')).toBe('');
  });

  it('writes a pace in the counted unit, with three places for kg and l', () => {
    expect(paceInCountUnit(290, 'g')).toBe('0.290');
    expect(paceInCountUnit(0.5, null)).toBe('0.50');
    expect(paceInCountUnit(null, 'g')).toBe('');
  });

  it('prices a weighed good per kg, not per gram', () => {
    expect(wacInCountUnit(0.0125, 'g')).toBe(12.5);
    expect(wacInCountUnit(30, null)).toBe(30);
    expect(wacInCountUnit(null, 'g')).toBe('');
  });

  it('gives a bottle size only to goods kept in containers', () => {
    const r = { bottleSizeMl: 750 } as InvRow;
    expect(bottleSizeCell(r, 'g')).toBe('');
    expect(bottleSizeCell(r, 'ml')).toBe('');
    expect(bottleSizeCell(r, 'each')).toBe('');
    expect(bottleSizeCell(r, null)).toBe(750);
    expect(bottleSizeCell(r, 'bottle')).toBe(750);
    expect(bottleSizeCell({ bottleSizeMl: null } as InvRow, null)).toBe('');
  });
});

describe('the valuation file and "Export this row"', () => {
  const flour = {
    name: 'Flour',
    producer: null,
    type: null,
    stock: 12400,
    shadow: 0,
    par: 5000,
    velocity: 290,
    runway: 42.7,
    wac: 0.0125,
    bottle: null,
    glass: null,
    value: 155,
  } as unknown as InvRow;
  const value = (cols: ReturnType<typeof valuationColumns>, h: string) => cols.find((c) => c.header === h)!.value(flour);

  it('names the unit and writes quantities and cost in it', () => {
    const cols = valuationColumns('TRY', () => 'g');
    expect(['Unit', 'Live', 'Shadow', 'Par', 'Velocity/day', 'WAC', 'Value at cost'].map((h) => value(cols, h))).toEqual([
      'kg',
      12.4,
      0,
      5,
      '0.290',
      12.5,
      '155.00',
    ]);
  });

  it('with no unit told, reads every row as a bottle, as before', () => {
    const cols = valuationColumns('TRY');
    expect(['Unit', 'Live', 'WAC'].map((h) => value(cols, h))).toEqual(['bottle', 12400, 0.0125]);
  });
});
