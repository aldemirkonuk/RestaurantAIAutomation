import { describe, expect, it } from 'vitest';
import { countBuilding } from './useCellarNextData';

// Browser walk 2026-11-11: a house carrying 1,750 g of sugar, 1,500 ml of
// syrup and 40 lemons read "Bottles on hand 3,456" on /cellar, when 149 of
// its rows were bottles. Bottles add only the rows counted by the bottle.
const row = (id: string, stockLive: number, uom?: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  stockLive,
  thresholdMin: 2,
  wineId: 'w-' + id,
  ...(uom === undefined ? {} : { uom }),
  ...extra,
});

describe('countBuilding — bottles on hand', () => {
  it('adds only rows counted by the bottle, never grams, millilitres or pieces', () => {
    const b = countBuilding(
      [
        row('wine', 119, 'bottle'),
        row('gin', 6, 'bottle'),
        row('sugar', 1750, 'g'),
        row('syrup', 1500, 'ml'),
        row('lemons', 40, 'each'),
        row('flour', 10, 'kg'),
        row('oil', 4, 'l'),
        row('napkins', 3, 'pack'),
        row('ale', 2, 'keg'),
        row('crate', 5, 'case'),
      ],
      new Set(),
    );
    expect(b.bottles).toBe(125);
    // Titles stay over every item (ADR 0293 F2/F3).
    expect(b.titles).toBe(10);
  });

  it('counts a row with no unit sent as bottles, as every row was before units', () => {
    const b = countBuilding([row('a', 12), row('b', 3, null), row('c', 4, '  ')], null);
    expect(b.bottles).toBe(19);
  });

  it('reads the unit without minding its case or spaces', () => {
    expect(countBuilding([row('a', 5, ' Bottle ')], null).bottles).toBe(5);
  });

  it('keeps par, no-par and off-library over every item, and null while unread', () => {
    const b = countBuilding(
      [
        row('wine', 1, 'bottle'),
        row('sugar', 100, 'g', { thresholdMin: null, wineId: null }),
      ],
      new Set(['sugar']),
    );
    expect(b.belowPar).toBe(1);
    expect(b.parUnset).toBe(1);
    expect(b.offBook).toBe(1);
    expect(countBuilding([row('wine', 1)], null).belowPar).toBeNull();
    expect(countBuilding(undefined, null)).toEqual({ titles: null, bottles: null, belowPar: null, parUnset: null, offBook: null });
  });
});
