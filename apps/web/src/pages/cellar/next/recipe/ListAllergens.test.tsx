/** The allergen column's words and the check's rule (r36 recipes audit, gap 8). */
import { describe, expect, it } from 'vitest';
import { ALLERGEN_KEYS, allergenSentence, keptFor } from './ListAllergens';
import type { RowAllergens } from '../../../../services/api/recipes';

const all = (s: string) => Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, s]));
const row = (status: Record<string, string>, unstatedBy: string[] = []): RowAllergens =>
  ({ readable: true, status: { ...all('free'), ...status }, unstatedBy }) as RowAllergens;

describe('allergenSentence', () => {
  it('names what it contains and may contain, in the sheet’s words', () => {
    expect(allergenSentence(row({ gluten: 'contains', tree_nuts: 'contains', sesame: 'may_contain' }))).toBe(
      'Contains gluten, tree nuts; May contain sesame',
    );
  });

  it('a line that states nothing is named, never read as free', () => {
    expect(allergenSentence(row({ milk: 'not_stated' }, ['Lemons']))).toBe('Not known: Lemons says nothing');
    expect(allergenSentence(row({ milk: 'not_stated' }, ['Lemons', 'Ice']))).toBe('Not known: Lemons, Ice say nothing');
    expect(allergenSentence(row({ gluten: 'contains', milk: 'not_stated' }, ['Lemons']))).toBe('Contains gluten; not known for Lemons');
  });

  it('free of all 14 only when every one is stated free', () => {
    expect(allergenSentence(row({}))).toBe('Free of all 14');
    // No line names itself, yet one allergen is not stated (a recipe with no lines).
    expect(allergenSentence(row({ lupin: 'not_stated' }))).toBe('Not known');
  });

  it('a failed read says so; no recipe says nothing', () => {
    expect(allergenSentence({ readable: false })).toBe('Could not be read');
    expect(allergenSentence(null)).toBeNull();
    expect(allergenSentence(undefined)).toBeNull();
  });
});

describe('keptFor', () => {
  it('hides only a row that states the allergen free', () => {
    expect(keptFor(row({}), 'milk')).toBe(false);
    expect(keptFor(row({ milk: 'contains' }), 'milk')).toBe(true);
    expect(keptFor(row({ milk: 'may_contain' }), 'milk')).toBe(true);
    expect(keptFor(row({ milk: 'not_stated' }, ['Lemons']), 'milk')).toBe(true);
  });

  it('keeps a row with no recipe, an unread row and every row when nothing is checked', () => {
    expect(keptFor(null, 'milk')).toBe(true);
    expect(keptFor(undefined, 'milk')).toBe(true);
    expect(keptFor({ readable: false }, 'milk')).toBe(true);
    expect(keptFor(row({}), '')).toBe(true);
  });
});
