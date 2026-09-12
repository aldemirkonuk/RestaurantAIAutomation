/**
 * The column vocabulary, and the two rules that keep a dead column off a row.
 *
 * These are the fourth pass's named requirement — *"research what should the
 * columns represent"* — turned into assertions. A test that only checked the
 * labels would pass with the register drawing ten em dashes, which is the state
 * this pass found it in.
 */

import { describe, expect, it } from 'vitest';
import {
  HOUSE_SPINE,
  WHOLE_CELLAR_COLUMNS,
  columnAccount,
  columnsFor,
  defaultColumns,
} from './cellar-columns';
import { REGISTER_ORDER, houseNaming, type RegisterId } from './cellar-format';
import { readStockEvent } from './useCellarNextData';

describe('every register has a column set, and every column accounts for itself', () => {
  it.each(REGISTER_ORDER)('%s', (register) => {
    const cols = columnsFor(register);
    expect(cols.length).toBeGreaterThan(3);
    for (const c of cols) {
      expect(c.source.trim()).not.toBe('');
      expect(c.meaning.trim()).not.toBe('');
      // A column that is not drawn must say why. A silent omission is the
      // absence-reported-as-health fault in table form.
      if (!c.on) expect(c.why.trim()).not.toBe('');
    }
    // Ids are unique inside a register, or the header menu targets two columns.
    expect(new Set(cols.map((c) => c.id)).size).toBe(cols.length);
  });

  it('never offers a column over a NOT NULL, never-written, always-zero source', () => {
    // `restaurant_inventory.total_revenue` and `times_ordered_count` are
    // populated on all 206 rows and zero on all 206 (measured 2026-09-03). A
    // column over either renders "0" as though it had been counted.
    const banned = /total_revenue|times_ordered_count|sales_velocity/;
    for (const register of REGISTER_ORDER) {
      for (const c of columnsFor(register)) {
        expect(c.source).not.toMatch(banned);
      }
    }
  });

  it('the columns with no writer on this database are off by default, with the measurement', () => {
    const beer = columnsFor('beer');
    const abv = beer.find((c) => c.id === 'abv');
    const format = beer.find((c) => c.id === 'format');
    const style = beer.find((c) => c.id === 'style');
    expect(abv?.on).toBe(false);
    expect(abv?.fill).toBe('0 of 609.');
    expect(format?.on).toBe(false);
    expect(style?.on).toBe(false);
    // Style is the founder's first beer column and it is the one the register
    // is actually waiting on — the reason says so rather than shrugging.
    expect(style?.why).toMatch(/highest-value writer/);
  });

  it('refuses the wine Format column, because 750 ml is a constant not a measurement', () => {
    const fmt = columnsFor('wines').find((c) => c.id === 'wineformat');
    expect(fmt?.on).toBe(false);
    expect(fmt?.fill).toMatch(/4,226 of 4,226/);
    expect(fmt?.why).toMatch(/Body filter/);
  });

  it('carbonation and yeast are not columns anywhere — BJCP keeps both in prose', () => {
    const ids = REGISTER_ORDER.flatMap((r) => columnsFor(r).map((c) => c.id));
    expect(ids).not.toContain('carbonation');
    expect(ids).not.toContain('yeast');
    const ibu = columnsFor('beer').find((c) => c.id === 'ibu');
    expect(ibu?.why).toMatch(/gaz oranı/);
    expect(ibu?.why).toMatch(/maya/);
  });

  it('whisky keeps age, cask and proof in the vocabulary — they are real columns, unwritten', () => {
    const whisky = columnsFor('whiskey');
    for (const id of ['age', 'cask', 'proof']) {
      const c = whisky.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c?.on).toBe(false);
      expect(c?.why).toMatch(/beverages_table\.sql/);
    }
  });

  it('cocktails get a recipe grammar, not a bottle grammar', () => {
    const ids = columnsFor('cocktails').map((c) => c.id);
    expect(ids).toContain('method');
    expect(ids).toContain('glass');
    expect(ids).toContain('garnish');
    expect(ids).toContain('recipe');
    // A cocktail has no invoice line of its own; those would be dead columns.
    expect(ids).not.toContain('first');
    expect(ids).not.toContain('quote');
  });

  it('the house spine leads every non-cocktail register, catalogue facts after', () => {
    const cols = columnsFor('whiskey');
    expect(cols.slice(0, HOUSE_SPINE.length).map((c) => c.id)).toEqual(
      HOUSE_SPINE.map((c) => c.id),
    );
  });

  it('defaultColumns is what the table draws, and it is never empty', () => {
    for (const r of REGISTER_ORDER) {
      expect(defaultColumns(r).length).toBeGreaterThan(2);
    }
  });

  it('a column account states source, meaning and measured fill', () => {
    const quote = HOUSE_SPINE.find((c) => c.id === 'quote')!;
    const lines = columnAccount(quote);
    expect(lines.join(' ')).toMatch(/vendor_price_observations/);
    expect(lines.join(' ')).toMatch(/0 rows in the whole database/);
  });
});

describe('the general set — the whole cellar at once', () => {
  it('carries only columns that mean the same thing in every register', () => {
    const ids = WHOLE_CELLAR_COLUMNS.map((c) => c.id);
    expect(ids).toEqual(['name', 'register', 'books', 'listed', 'paid', 'sold', 'charged', 'quote']);
  });

  it('refuses On hand, which is real for wines and structurally absent elsewhere', () => {
    // OD-113: restaurant_inventory is keyed on master_wine_id, so a keg has no
    // stock row. As a general column it would be an em dash on most of the page.
    expect(WHOLE_CELLAR_COLUMNS.map((c) => c.id)).not.toContain('onhand');
  });

  it('every general column is drawn — the general set has no hidden members', () => {
    expect(WHOLE_CELLAR_COLUMNS.every((c) => c.on)).toBe(true);
  });
});

describe('what this house’s book is CALLED', () => {
  const cases: [RegisterId[], string][] = [
    [['wines'], 'The Cellar'],
    [['wines', 'beer', 'cocktails'], 'The Cellar'],
    [['spirits'], 'The Cellar'],
    [['whiskey'], 'The Cellar'],
    [['beer'], 'The Bar'],
    [['cocktails'], 'The Bar'],
    [['beer', 'non_alcoholic'], 'The Bar'],
    [['cocktails', 'soft_drinks', 'non_alcoholic'], 'The Bar'],
    [['non_alcoholic'], 'Drinks'],
    [['soft_drinks'], 'Drinks'],
    [['non_alcoholic', 'soft_drinks'], 'Drinks'],
  ];

  it.each(cases)('%s → %s', (carried, name) => {
    expect(houseNaming(carried).name).toBe(name);
  });

  it('an unread set keeps the route’s own name and says nothing is established', () => {
    for (const unread of [null, [] as RegisterId[]]) {
      const n = houseNaming(unread);
      expect(n.name).toBe('The Cellar');
      expect(n.unestablished).toBe(true);
      expect(n.because).toMatch(/has not been established/);
    }
  });

  it('never names the parent “Soft drinks” — that is one of its own children', () => {
    const names = cases.map(([c]) => houseNaming(c).name);
    expect(names).not.toContain('Soft drinks');
    expect(houseNaming(['soft_drinks']).because).toMatch(/name of one of the seven registers/);
  });

  it('every naming carries the sentence that explains the change', () => {
    for (const [carried] of cases) {
      expect(houseNaming(carried).because.length).toBeGreaterThan(40);
    }
  });
});

describe('a live stock event, read from two different producers', () => {
  const rid = 'r1';

  it('reads the websocket bridge’s shape (inventory_id / stock_after)', () => {
    const t = readStockEvent(
      { new: { inventory_id: 'i1', restaurant_id: rid, stock_after: 4 } },
      rid,
    );
    expect(t?.inventoryId).toBe('i1');
    expect(t?.stockAfter).toBe(4);
  });

  it('reads RealtimeContext’s shape (wineId / quantity) from the same event name', () => {
    const t = readStockEvent({ new: { type: 'stock_change', wineId: 'w1', quantity: 2 } }, rid);
    expect(t?.wineId).toBe('w1');
    expect(t?.stockAfter).toBe(2);
  });

  it('drops a payload belonging to another house', () => {
    expect(
      readStockEvent({ new: { inventory_id: 'i1', restaurant_id: 'other', stock_after: 4 } }, rid),
    ).toBeNull();
  });

  it('drops a payload that names no row at all rather than patching something', () => {
    expect(readStockEvent({ new: { restaurant_id: rid, stock_after: 4 } }, rid)).toBeNull();
    expect(readStockEvent(null, rid)).toBeNull();
    expect(readStockEvent({ new: 'nope' }, rid)).toBeNull();
  });

  it('carries no stock figure when the event carried none — never a zero', () => {
    const t = readStockEvent({ new: { inventory_id: 'i1', restaurant_id: rid } }, rid);
    expect(t?.stockAfter).toBeNull();
  });
});
