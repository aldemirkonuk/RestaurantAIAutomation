/**
 * A recipe's nutrition is the sum of its lines: unknown stays null (never 0),
 * a partly known figure is "at least" with the missing lines named, grams and
 * millilitres are never mixed, and an allergen is free only when every line
 * says so.
 */
import { describe, expect, it } from 'vitest';
import { sumRecipe, type RecipeLine } from './nutrition-sum';

const per = (basis: '100g' | '100ml', over: Partial<NonNullable<RecipeLine['nutrition']>> = {}): RecipeLine['nutrition'] => ({
  basis,
  energyFromAbv: false,
  energyKcal: null,
  proteinG: null,
  fatG: null,
  saturatesG: null,
  carbohydrateG: null,
  sugarsG: null,
  saltG: null,
  ...over,
});

const line = (over: Partial<RecipeLine>): RecipeLine => ({
  name: 'line',
  quantity: 100,
  unit: 'g',
  nutrition: null,
  allergens: null,
  ...over,
});

describe('summing a recipe', () => {
  it('adds each line as its amount times its per-100 figure, in g and ml alike', () => {
    const s = sumRecipe([
      line({ name: 'Tulum cheese', quantity: 50, unit: 'g', nutrition: per('100g', { energyKcal: 350, proteinG: 22 }) }),
      line({ name: 'Flour', quantity: 0.2, unit: 'kg', nutrition: per('100g', { energyKcal: 364, proteinG: 10 }) }),
    ]);
    expect(s.figures.energyKcal).toEqual({ value: 175 + 728, atLeast: false, missing: [] });
    expect(s.figures.proteinG).toEqual({ value: 11 + 20, atLeast: false, missing: [] });
    expect(s.notCounted).toEqual([]);

    const drink = sumRecipe([line({ name: 'Rakı', quantity: 4, unit: 'cl', nutrition: per('100ml', { energyKcal: 250 }) })]);
    expect(drink.figures.energyKcal.value).toBe(100);
  });

  it('keeps a figure no line states as null, never 0', () => {
    const s = sumRecipe([line({ name: 'Water', quantity: 200, unit: 'ml', nutrition: per('100ml', { energyKcal: 0 }) })]);
    expect(s.figures.energyKcal.value).toBe(0);
    expect(s.figures.saltG.value).toBeNull();
    expect(s.figures.saltG.missing).toEqual(['Water']);
    expect(s.figures.saltG.atLeast).toBe(false);
  });

  it('says "at least" and names the line when some lines do not state a figure', () => {
    const s = sumRecipe([
      line({ name: 'Ayran', quantity: 200, unit: 'ml', nutrition: per('100ml', { energyKcal: 38, saltG: 0.5 }) }),
      line({ name: 'Mint', quantity: 10, unit: 'ml', nutrition: per('100ml', { energyKcal: 44 }) }),
    ]);
    expect(s.figures.saltG).toEqual({ value: 1, atLeast: true, missing: ['Mint'] });
    expect(s.figures.energyKcal).toEqual({ value: 80.4, atLeast: false, missing: [] });
  });

  it('never turns grams into millilitres: a line on the other basis is named and left out', () => {
    const s = sumRecipe([
      line({ name: 'Honey', quantity: 20, unit: 'ml', nutrition: per('100g', { energyKcal: 304 }) }),
      line({ name: 'Lemon juice', quantity: 30, unit: 'ml', nutrition: per('100ml', { energyKcal: 22 }) }),
      line({ name: 'Ice', quantity: null, unit: 'g', nutrition: per('100g', { energyKcal: 0 }) }),
      line({ name: 'Egg', quantity: 1, unit: 'each', nutrition: per('100g', { energyKcal: 143 }) }),
      line({ name: 'Bitters', quantity: 2, unit: 'ml' }),
    ]);
    expect(s.notCounted).toEqual([
      { name: 'Honey', why: 'it is measured by volume, but its figures are per 100 g' },
      { name: 'Ice', why: 'the recipe does not say how much' },
      { name: 'Egg', why: 'it is measured in each, not by weight or volume' },
      { name: 'Bitters', why: 'nothing is recorded about what is in it' },
    ]);
    expect(s.figures.energyKcal).toEqual({ value: 6.6, atLeast: true, missing: ['Honey', 'Ice', 'Egg', 'Bitters'] });
  });

  it('says energy worked out from the ABV is at least, since it is the alcohol alone', () => {
    const s = sumRecipe([line({ name: 'Rakı', quantity: 40, unit: 'ml', nutrition: per('100ml', { energyKcal: 248.5, energyFromAbv: true }) })]);
    expect(s.figures.energyKcal).toEqual({ value: 99.4, atLeast: true, missing: [] });
  });
});

describe('a recipe’s allergens', () => {
  it('contains what any line contains, and is free only when every line is stated free', () => {
    const s = sumRecipe([
      line({ name: 'Cheese', allergens: [{ allergen: 'milk', status: 'contains' }, { allergen: 'gluten', status: 'free' }] }),
      line({ name: 'Bread', allergens: [{ allergen: 'sesame', status: 'may_contain' }, { allergen: 'gluten', status: 'contains' }] }),
      line({ name: 'Oil', allergens: [{ allergen: 'milk', status: 'free' }, { allergen: 'fish', status: 'free' }] }),
    ]);
    expect(s.allergens.milk).toBe('contains');
    expect(s.allergens.gluten).toBe('contains');
    expect(s.allergens.sesame).toBe('may_contain');
    expect(s.allergens.fish).toBe('not_stated');
    const allFree = sumRecipe([
      line({ name: 'A', allergens: [{ allergen: 'fish', status: 'free' }] }),
      line({ name: 'B', allergens: [{ allergen: 'fish', status: 'free' }] }),
    ]);
    expect(allFree.allergens.fish).toBe('free');
    expect(sumRecipe([]).allergens.fish).toBe('not_stated');
  });
});
