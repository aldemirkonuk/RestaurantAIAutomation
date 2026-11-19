/**
 * The inventory exports are kind-aware: every file says what each good is
 * (Kind), in what unit its quantity is (Unit) and who sells it (Vendor), and a
 * detail column only a drink fills is left out of a file no drink is in.
 *
 * Fixtures are synthetic and shaped like the gateway's list row (the house
 * row spread, snake/camel as sent), read through the page's own `toRow`.
 */
import { describe, expect, it } from 'vitest';
import {
  bottleSizeCell,
  costColumnsFor,
  countSheetColumns,
  dropEmptyDetail,
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
const DRINK_HEADS = ['Producer', 'Vintage', 'Bottle size (ml)', 'Your bottle price', 'Your glass price'];
const sheet = (rows: InvRow[]) => dropEmptyDetail(rows, countSheetColumns(nameHead, zoneName, obs));
const valuation = (rows: InvRow[]) => dropEmptyDetail(rows, valuationColumns('USD', nameHead));

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

describe('unit and bottle size', () => {
  it('says the good\'s own unit; a drink with none says bottle; neither says nothing', () => {
    expect(unitWord(flour())).toBe('g');
    expect(unitWord(raw({ kind: 'wine' }))).toBe('bottle');
    expect(unitWord(raw({ kind: 'food' }))).toBe('');
    expect(unitWord(raw({}))).toBe('');
  });
  it('leaves the bottle size blank for a food even when the gateway sent 750', () => {
    expect(flour().bottleSizeMl).toBe(750);
    expect(bottleSizeCell(flour())).toBe('');
    expect(bottleSizeCell(wine())).toBe(750);
    expect(bottleSizeCell(spirit())).toBe(700);
  });
  it('for a good of unknown kind keeps only a size someone recorded', () => {
    expect(bottleSizeCell(raw({ bottle_size_ml: null }))).toBe('');
    expect(bottleSizeCell(raw({ bottle_size_ml: 500, bottleSizeMl: 500 }))).toBe(500);
  });
});

describe('detail columns follow the rows', () => {
  it('a file of foods has Good-style detail but no drink heading, even with a gateway 750', () => {
    const rows = [flour(), bags()];
    for (const cols of [sheet(rows), valuation(rows)]) {
      const h = headers(cols);
      expect(h).toEqual(expect.arrayContaining(['Kind', 'Unit', 'Vendor']));
      for (const d of DRINK_HEADS) expect(h).not.toContain(d);
    }
    const c = sheet(rows);
    expect(rows.map((r) => cell(c, 'Kind', r))).toEqual(['Food', 'Supply']);
    expect(rows.map((r) => cell(c, 'Unit', r))).toEqual(['g', 'pack']);
    expect(rows.map((r) => cell(c, 'Vendor', r))).toEqual(['Mill Co', 'Pack Co']);
  });

  it('a mixed file keeps every heading, with blank drink cells on the food rows', () => {
    const rows = [wine(), spirit(), flour(), bags()];
    const c = sheet(rows);
    expect(headers(c)).toEqual(expect.arrayContaining(DRINK_HEADS.filter((d) => d !== 'Your bottle price' && d !== 'Your glass price')));
    const v = valuation(rows);
    expect(headers(v)).toEqual(expect.arrayContaining(['Producer', 'Your bottle price', 'Your glass price']));
    for (const f of [flour(), bags()]) {
      expect(cell(c, 'Producer', f)).toBe('');
      expect(cell(c, 'Vintage', f)).toBe('');
      expect(cell(c, 'Bottle size (ml)', f)).toBe('');
    }
    expect(cell(c, 'Kind', flour())).toBe('Food');
    expect(cell(c, 'Kind', wine())).toBe('Wine');
    expect(cell(c, 'Kind', spirit())).toBe('Spirit');
    expect(cell(c, 'Bottle size (ml)', wine())).toBe(750);
    expect(cell(c, 'Producer', wine())).toBe('Cantina Uno');
  });

  it('a wine-only file keeps Producer, Vintage and Bottle size', () => {
    const c = sheet([wine()]);
    expect(headers(c)).toEqual(expect.arrayContaining(['Producer', 'Vintage', 'Bottle size (ml)', 'Kind', 'Unit']));
    expect(cell(c, 'Kind', wine())).toBe('Wine');
    expect(cell(c, 'Unit', wine())).toBe('bottle');
  });

  it('keeps every column when there is nothing to judge from', () => {
    expect(headers(sheet([]))).toEqual(expect.arrayContaining(DRINK_HEADS.slice(0, 3)));
  });

  it('one food row alone has no drink heading', () => {
    const h = headers(valuation([flour()]));
    for (const d of ['Producer', 'Your bottle price', 'Your glass price']) expect(h).not.toContain(d);
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
    const rows = [wine(), flour()];
    for (const cols of [sheet(rows), valuation(rows)]) {
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
