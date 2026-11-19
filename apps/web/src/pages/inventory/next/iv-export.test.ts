/**
 * The inventory exports are kind-aware: every file says what each good is
 * (Kind), in what unit its quantity is (Unit) and who sells it (Vendor), the
 * count sheet is ordered by where it sits, and staff files carry no cost column.
 *
 * Fixtures are synthetic and shaped like the gateway's list row (the house
 * row spread, snake/camel as sent), read through the page's own `toRow`.
 */
import { describe, expect, it } from 'vitest';
import {
  costColumnsFor,
  countSheetColumns,
  forHouse,
  locationCell,
  sortCountSheet,
  unitWord,
  valuationColumns,
} from './iv-export';
import { goodKind, kindLabel, toRow, type InvRow } from './useInventoryNextData';

const zones: Record<string, string> = { cave: 'Cave', dry: 'Dry store' };
const zoneName = (id: string | null) => (id === null ? 'Unassigned' : (zones[id] ?? 'a zone not on the list'));

function raw(over: Record<string, unknown>): InvRow {
  return toRow({
    id: 'x',
    stockLive: 4,
    shadowStock: 0,
    thresholdMin: 2,
    // The gateway gives an unsized good 750 ml.
    bottleSizeMl: 750,
    locations: [{ locationId: 'dry', qty: 4 }],
    ...over,
  } as never);
}

const wine = () =>
  raw({
    id: 'w', kind: 'wine', uom: 'bottle', wineName: 'Fixture Rosso', wineProducer: 'Cantina Uno', wineVintage: 2019,
    libraryType: 'red', libraryKind: 'wine', providerName: 'Vino Supply', menuPriceBottle: 80, menuPriceGlass: 14,
    wac: 30, locations: [{ locationId: 'cave', qty: 4 }],
  });
const spirit = () =>
  raw({ id: 's', kind: 'spirit', uom: 'bottle', wineName: 'Fixture Gin', bottleSizeMl: 700, libraryKind: 'spirit', providerName: 'Spirits Co', wac: 20, locations: [{ locationId: 'cave', qty: 4 }] });
const flour = () =>
  raw({ id: 'f', kind: 'food', uom: 'g', displayName: 'Fixture Flour', stockLive: 2250, providerName: 'Mill Co', wac: 0.002 });
const bags = () => raw({ id: 'b', kind: 'supply', uom: 'pack', displayName: 'Fixture Bags', providerName: 'Pack Co', wac: 1 });

const nameHead = 'Title';
const obs = () => '';
const headers = (cols: { header: string }[]) => cols.map((c) => c.header);
const cell = (cols: { header: string; value: (r: InvRow) => unknown }[], h: string, r: InvRow) => cols.find((c) => c.header === h)!.value(r);
const sheet = () => countSheetColumns(nameHead, zoneName, obs);
const valuation = () => valuationColumns('USD', nameHead);

describe('kind words', () => {
  it('reads the house kind raw, before the library kind', () => {
    expect(flour().ledgerKind).toBe('food');
    expect(goodKind(flour())).toBe('food');
    // a library kind alone still answers for a row with no house kind
    expect(goodKind(raw({ libraryKind: 'beer' }))).toBe('beer');
    // the house kind wins over the library's
    expect(goodKind(raw({ kind: 'spirit', libraryKind: 'wine' }))).toBe('spirit');
  });
  it('writes a word for each kind and says so when none is recorded', () => {
    expect(['wine', 'spirit', 'whiskey', 'beer', 'sake', 'cider', 'liqueur', 'cocktail', 'non_alcoholic', 'soft_drink', 'food', 'supply', 'other'].map(kindLabel)).toEqual([
      'Wine', 'Spirit', 'Spirit', 'Beer', 'Sake', 'Cider', 'Liqueur', 'Cocktail', 'Non-alcoholic', 'Soft drink', 'Food', 'Supply', 'Other',
    ]);
    expect(kindLabel(null)).toBe('Not recorded');
    expect(kindLabel('unknown')).toBe('Not recorded');
  });
});

describe('unit', () => {
  it('says the good\'s own unit; a drink with none says bottle; neither says nothing', () => {
    expect(unitWord(flour())).toBe('g');
    expect(unitWord(raw({ kind: 'wine' }))).toBe('bottle');
    expect(unitWord(raw({ kind: 'food' }))).toBe('');
    expect(unitWord(raw({}))).toBe('');
  });
});

describe('Kind, Unit and Vendor in every file', () => {
  it('both files carry them, with the cell for each good', () => {
    const rows = [wine(), spirit(), flour(), bags()];
    for (const cols of [sheet(), valuation()]) {
      expect(headers(cols)).toEqual(expect.arrayContaining(['Kind', 'Unit', 'Vendor']));
      expect(rows.map((r) => cell(cols, 'Kind', r))).toEqual(['Wine', 'Spirit', 'Food', 'Supply']);
      expect(rows.map((r) => cell(cols, 'Unit', r))).toEqual(['bottle', 'bottle', 'g', 'pack']);
      expect(rows.map((r) => cell(cols, 'Vendor', r))).toEqual(['Vino Supply', 'Spirits Co', 'Mill Co', 'Pack Co']);
    }
  });

  it('a house of goods still has no drink heading, and keeps Kind, Unit and Vendor', () => {
    for (const cols of [forHouse(true, sheet()), forHouse(true, valuation())]) {
      const h = headers(cols);
      expect(h).toEqual(expect.arrayContaining(['Kind', 'Unit', 'Vendor']));
      for (const d of ['Producer', 'Vintage', 'Bottle size (ml)', 'Your bottle price', 'Your glass price']) expect(h).not.toContain(d);
    }
  });
});

describe('count sheet order', () => {
  const at = (id: string, name: string, kind: string, zone: string | null, qty = 1) =>
    raw({ id, kind, displayName: name, stockLive: qty, locations: zone === null ? [] : [{ locationId: zone, qty }] });

  it('is Location, then Kind, then name, with stock outside any zone last', () => {
    const rows = [
      at('1', 'Zinfandel', 'wine', 'cave'),
      at('2', 'Salt', 'food', 'dry'),
      at('3', 'Loose thing', 'food', null),
      at('4', 'Anchovy', 'food', 'cave'),
      at('5', 'Amaro', 'spirit', 'cave'),
      at('6', 'Barolo', 'wine', 'cave'),
      at('7', 'Bag 10', 'supply', 'dry'),
      at('8', 'Bag 2', 'supply', 'dry'),
    ];
    const out = sortCountSheet(rows, zoneName);
    expect(out.map((r) => r.name)).toEqual(['Anchovy', 'Amaro', 'Barolo', 'Zinfandel', 'Salt', 'Bag 2', 'Bag 10', 'Loose thing']);
  });

  it('sorts on the text the Location cell shows, not the raw zone name', () => {
    // a zone literally called "Zzz" and stock outside every zone: the unassigned row is last though "Unassigned" < "Zzz"
    const named = (id: string | null) => (id === 'z' ? 'Zzz' : 'Unassigned');
    const a = raw({ id: 'a', kind: 'food', displayName: 'A', stockLive: 1, locations: [{ locationId: 'z', qty: 1 }] });
    const b = raw({ id: 'b', kind: 'food', displayName: 'B', stockLive: 1, locations: [{ locationId: null, qty: 1 }] });
    expect(locationCell(b, named)).toBe('Unassigned');
    expect(sortCountSheet([b, a], named).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('orders by the zone\'s name as shown, not by its id', () => {
    const named = (id: string | null) => (id === 'z9' ? 'Alpha room' : id === 'a1' ? 'Zulu room' : 'Unassigned');
    const inA1 = raw({ id: 'x', kind: 'food', displayName: 'X', locations: [{ locationId: 'a1', qty: 1 }] });
    const inZ9 = raw({ id: 'y', kind: 'food', displayName: 'Y', locations: [{ locationId: 'z9', qty: 1 }] });
    expect(sortCountSheet([inA1, inZ9], named).map((r) => r.id)).toEqual(['y', 'x']);
  });

  it('keeps the input order for rows that tie, and does not mutate its input', () => {
    const rows = [at('a', 'Same', 'food', 'dry'), at('b', 'Same', 'food', 'dry'), at('c', 'Same', 'food', 'dry')];
    const copy = [...rows];
    expect(sortCountSheet(rows, zoneName).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual(copy);
  });

  it('puts a kind nobody recorded after the kinds that sort before the words', () => {
    const rows = [at('1', 'N', 'wine', 'dry'), raw({ id: '2', displayName: 'M', locations: [{ locationId: 'dry', qty: 1 }] })];
    expect(sortCountSheet(rows, zoneName).map((r) => r.id)).toEqual(['2', '1']); // "Not recorded" < "Wine"
  });
});

describe('what staff see, and that no figure moves', () => {
  it('staff files have no WAC or Value columns but keep Kind and Unit', () => {
    for (const cols of [sheet(), valuation()]) {
      const h = headers(costColumnsFor(cols, false));
      for (const x of ['WAC', 'Value', 'Value at cost']) expect(h).not.toContain(x);
      expect(h).toEqual(expect.arrayContaining(['Kind', 'Unit']));
      const m = headers(costColumnsFor(cols, true));
      expect(m).toContain('WAC');
    }
  });

  it('Value and WAC cells are the stock times the cost, as before, and Unit does not change them', () => {
    const f = flour();
    const c = countSheetColumns(nameHead, zoneName, obs);
    expect(cell(c, 'WAC', f)).toBe(0.002);
    expect(cell(c, 'Value', f)).toBe((2250 * 0.002).toFixed(2));
    expect(cell(c, 'System qty (live)', f)).toBe(2250);
    const v = valuationColumns('USD', nameHead);
    expect(cell(v, 'Value at cost', f)).toBe((2250 * 0.002).toFixed(2));
    expect(cell(v, 'Live', f)).toBe(2250);
  });
});
