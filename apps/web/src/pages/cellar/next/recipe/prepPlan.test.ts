/** r109 drinks-g3: a shift's pull list. Summed exactly per (good, unit), rounded once and up; unlinked lines never summed. */
import { describe, expect, it } from 'vitest';
import type { CardComponent, DrinkCard } from '../../../../services/api/recipes';
import { makeWords, planPrep, pullWords, readServes } from './prepPlan';

type L = DrinkCard['lines'][number];
const stocked = (label: string, inventoryId: string | null, qtyBase: number, extra: Partial<L> = {}): L => ({
  label, qty: qtyBase / 10, unit: 'ml', name: inventoryId ? `${label} (shelf)` : null, role: 'stocked', inventoryId, componentId: null, qtyBase, baseUnit: 'ml10', usablePct: null, ...extra,
});
const card = (cocktailId: string, name: string, lines: L[], yieldServes = 1): DrinkCard => ({
  cocktailId, name, section: null, glass: null, method: null, garnish: null, yieldServes, version: 1, versionDate: null, lines, allergens: { readable: false },
});

const negroni = card('n', 'Negroni', [stocked('Gin', 'gin', 300), stocked('Lime juice', null, 250), stocked('Syrup', null, 100, { role: 'made', componentId: 'syr' })]);
const sling = card('s', 'Red Sling', [stocked('Gin', 'gin', 450), stocked('lime  juice', null, 200), stocked('Soda', null, 600, { role: 'untracked' })]);
const syrup: CardComponent = { id: 'syr', name: 'House syrup', yieldQtyBase: 2500, yieldBaseUnit: 'ml10' };

describe('planPrep', () => {
  it('2 drinks x 12 serves: gin summed across drinks, the syrup in whole batches', () => {
    const p = planPrep([negroni, sling], [syrup], { n: 12, s: 12 });
    expect(p.planned).toBe(24);
    expect(p.pull.map((r) => [r.name, pullWords(r.base, r.baseUnit), r.drinks])).toEqual([['Gin (shelf)', '900 ml', ['Negroni', 'Red Sling']]]);
    expect(makeWords(p.make[0])).toBe('House syrup: 1 batch (120 ml needed, one makes 250 ml)');
    expect(planPrep([negroni], [syrup], { n: 30 }).make[0].batches).toBe(2);
  });

  it('an unlinked line is never summed into a good, and is named once with its drinks', () => {
    const p = planPrep([negroni, sling], [syrup], { n: 12, s: 12 });
    expect(p.notLinked).toEqual([{ label: 'Lime juice', drinks: ['Negroni', 'Red Sling'], firstDrinkId: 'n' }]);
    expect(p.pull.every((r) => !/lime/i.test(r.name))).toBe(true);
    expect(p.notCounted).toEqual([{ label: 'Soda', drinks: ['Red Sling'], firstDrinkId: 's' }]);
  });

  it('a good in two families stays two rows', () => {
    const weighed = card('w', 'Sugar rim', [stocked('Sugar', 'sug', 5000, { baseUnit: 'mg', unit: 'g' })]);
    const poured = card('p', 'Sugar water', [stocked('Sugar', 'sug', 100)]);
    const p = planPrep([weighed, poured], [], { w: 2, p: 2 });
    expect(p.pull.map((r) => pullWords(r.base, r.baseUnit)).sort()).toEqual(['10 g', '20 ml']);
  });

  it('45% usable pulls 2.22 times the amount', () => {
    const p = planPrep([card('l', 'Gimlet', [stocked('Limes', 'lime', 250, { usablePct: 45 })])], [], { l: 4 });
    expect(p.pull[0].base / 1000).toBeCloseTo(100 / 45, 6);
    expect(pullWords(p.pull[0].base, 'ml10')).toBe('223 ml');
  });

  it('rounds once at the end and up, never per line: 10.2 ml twice is 21 ml, not 22', () => {
    const a = card('a', 'A', [stocked('Bitters', 'bit', 102)]);
    const b = card('b', 'B', [stocked('Bitters', 'bit', 102)]);
    expect(pullWords(planPrep([a, b], [], { a: 1, b: 1 }).pull[0].base, 'ml10')).toBe('21 ml');
  });

  it('a recipe making 4 is planned per serve; a component with no yield, or one in another family, says so', () => {
    const big = card('b', 'Punch', [stocked('Rum', 'rum', 4000), stocked('Syrup', null, 1000, { role: 'made', componentId: 'syr' })], 4);
    const p = planPrep([big], [{ ...syrup, yieldQtyBase: null, yieldBaseUnit: null }], { b: 12 });
    expect(pullWords(p.pull[0].base, 'ml10')).toBe('1200 ml');
    expect(makeWords(p.make[0])).toBe('House syrup: yield not set: 300 ml needed');
    expect(planPrep([big], [{ ...syrup, yieldBaseUnit: 'mg' }], { b: 12 }).make[0].batches).toBeNull();
  });

  it('a drink planned at 0 adds nothing; serves read 0 to 999', () => {
    expect(planPrep([negroni], [syrup], { n: 0 }).pull).toEqual([]);
    expect([readServes(''), readServes('12'), readServes('1000'), readServes('1.5')]).toEqual([0, 12, null, null]);
  });
});
