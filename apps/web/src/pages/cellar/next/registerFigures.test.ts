import { describe, expect, it } from 'vitest';
import { stripFor, stripSaid, drinkNumbers } from './registerFigures';
import type { DrinkFigureRow } from '../../../services/api/recipes';

const costed = (perServe: number): DrinkFigureRow =>
  ({ hasRecipe: true, cost: { complete: true, perServe, perServeExact: perServe } } as unknown as DrinkFigureRow);
const pct = (n: number) => `${n}%`;

describe('the figures strip on a prices-include-tax house with no rate', () => {
  const tax = { basis: 'prices_include_tax', ratePct: null } as const;
  const nums = [2, 3, 4].map((c) => drinkNumbers(10, costed(c), true, tax));

  it('counts a costed drink as costed, never as not priced', () => {
    const s = stripFor(nums, tax);
    expect(s.unpriced).toBe(0);
    expect(s.noShare).toBe(3);
    expect(s.noTaxRate).toBe(true);
  });

  it('says once that the tax rate is what is missing', () => {
    const said = stripSaid(stripFor(nums, tax), pct);
    expect(said).toContain('Pour cost not known: no tax rate recorded');
    expect(said).toContain('0 not priced');
  });

  it('still counts a drink with no cost as not priced', () => {
    const none = drinkNumbers(10, { hasRecipe: true, cost: null } as unknown as DrinkFigureRow, true, tax);
    expect(stripFor([...nums, none], tax).unpriced).toBe(1);
  });
});

describe('the figures strip on an ordinary house', () => {
  it('keeps the sentence it always had', () => {
    const tax = { basis: 'prices_exclude_tax' } as const;
    const n = [drinkNumbers(10, costed(2), true, tax)];
    expect(stripSaid(stripFor(n, tax), pct)).toBe('Average pour cost 20% over 1 priced drink · 0 not priced · 0 with no recipe');
  });
});
