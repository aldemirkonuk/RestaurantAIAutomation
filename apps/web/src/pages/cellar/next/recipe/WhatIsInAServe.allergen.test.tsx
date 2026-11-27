/**
 * r110 drinks-3 (DD-r109-36): the sheet's What is in a serve says the same
 * allergen rule as the card, the list and the spec book. Free only when all 14
 * are stated free; nothing recorded is not known; a failed read says so and is
 * never free and never blank. A customer is told these words.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CocktailRecipe, WhatIsIn } from '../../../../services/api/recipes';
import WhatIsInAServe from './WhatIsInAServe';
import { ALLERGEN_KEYS, allergenVerdict } from './allergenRule';
import { cardAllergens } from './RecipeCard';
import { allergenSentence } from './ListAllergens';

const fig = { value: null, atLeast: false, missing: [] };
const figures = { energyKcal: fig, fatG: fig, saturatesG: fig, carbohydrateG: fig, sugarsG: fig, proteinG: fig, saltG: fig };
const all14 = (over: Record<string, string> = {}) =>
  ({ ...Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, 'free'])), ...over }) as Record<string, 'free'>;
const readable = (allergens: Record<string, string>, allergensUnstatedBy?: string[]): WhatIsIn =>
  ({ readable: true, figures, notCounted: [], allergens, allergensUnstatedBy }) as WhatIsIn;
const recipe = (whatIsIn: WhatIsIn | null | undefined): CocktailRecipe =>
  ({
    cocktail: { id: 'c', name: 'Negroni', price: null, glass: null, garnish: null, method: null, description: null },
    current: { versionId: 'v1', version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '', lines: [] },
    cost: null,
    whatIsIn,
    versionCount: 1,
    legacyLines: [],
  }) as CocktailRecipe;
const sheet = (w: WhatIsIn | null | undefined) => render(<WhatIsInAServe data={recipe(w)} unsaved={false} />);
const FREE = /free of the 14/i;

describe('What is in a serve: the allergen rule (r110 drinks-3)', () => {
  it('says free only when all 14 of 14 are stated free', () => {
    sheet(readable(all14(), []));
    expect(screen.getByTestId('recipe-whatisin-allergens-free').textContent).toBe('Every ingredient states it is free of the 14 allergens.');
  });

  it('13 of 14 stated free, one not stated, is not known, never free', () => {
    sheet(readable(all14({ sulphites: 'not_stated' }), []));
    expect(screen.queryByTestId('recipe-whatisin-allergens-free')).toBeNull();
    expect(screen.getByTestId('recipe-whatisin-allergens-unknown').textContent).toBe('Allergens not known: nothing is recorded.');
  });

  it('a key missing from the read is not free', () => {
    const { molluscs: _drop, ...thirteen } = all14();
    sheet(readable(thirteen, []));
    expect(screen.getByTestId('recipe-whatisin').textContent).not.toMatch(FREE);
    expect(screen.getByTestId('recipe-whatisin-allergens-unknown')).toBeInTheDocument();
  });

  it('an older gateway with no unstatedBy is not known, not blank and not free', () => {
    sheet(readable(all14(), undefined));
    expect(screen.getByTestId('recipe-whatisin-allergens-unknown')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-whatisin').textContent).not.toMatch(FREE);
  });

  it('nothing recorded (an empty status) is not known, not blank', () => {
    sheet(readable({}, []));
    expect(screen.getByTestId('recipe-whatisin-allergens-unknown')).toBeInTheDocument();
  });

  it('a failed read says allergens could not be read, never free or blank', () => {
    const { unmount } = sheet({ readable: false, sentence: 'What is in a serve could not be read just now.' });
    expect(screen.getByTestId('recipe-whatisin-allergens-unread').textContent).toBe('Allergens could not be read.');
    expect(screen.getByTestId('recipe-whatisin-unread').textContent).not.toMatch(FREE);
    unmount();
    // An empty gateway sentence still leaves words, not a blank line.
    const { unmount: u2 } = sheet({ readable: false, sentence: '' });
    expect(screen.getByTestId('recipe-whatisin-allergens-unread').textContent).toBe('Allergens could not be read.');
    expect(screen.getByTestId('recipe-whatisin-unread').textContent).toContain('was not read here');
    u2();
    sheet(undefined);
    expect(screen.getByTestId('recipe-whatisin-allergens-unread').textContent).toBe('Allergens could not be read.');
  });

  it('keeps a stated allergen beside the silent lines', () => {
    sheet(readable(all14({ milk: 'contains', eggs: 'may_contain' }), ['Campari']));
    expect(screen.getByTestId('recipe-whatisin-allergens').textContent).toBe('May contain eggs. Contains milk.');
    expect(screen.getByTestId('recipe-whatisin-allergens-unstated').textContent).toBe('No allergen can be ruled out: Campari does not say what it contains.');
  });

  it('a stated allergen outside the 14 is never dropped', () => {
    expect(allergenVerdict({ readable: true, status: { ...all14(), kiwi: 'contains' }, unstatedBy: [] })).toEqual({
      kind: 'stated',
      stated: [['kiwi', 'contains']],
      unstatedBy: [],
    });
  });

  it('the card, the list and the sheet agree on every case', () => {
    const cases: Array<[WhatIsIn | null, 'free' | 'unknown' | 'unread']> = [
      [readable(all14(), []), 'free'],
      [readable(all14({ lupin: 'not_stated' }), []), 'unknown'],
      [readable(all14(), undefined), 'unknown'],
      [{ readable: false, sentence: '' }, 'unread'],
      [null, 'unread'],
    ];
    for (const [w, want] of cases) {
      const card = cardAllergens(w);
      const list = allergenSentence(
        w && w.readable ? { readable: true, status: w.allergens, unstatedBy: w.allergensUnstatedBy as string[] } : { readable: false },
      );
      if (want === 'free') {
        expect(card).toMatch(FREE);
        expect(list).toBe('Free of all 14');
      } else {
        expect(card).not.toMatch(FREE);
        expect(list).not.toBe('Free of all 14');
        expect(card.trim()).not.toBe('');
        expect(list).toBe(want === 'unread' ? 'Could not be read' : 'Not known');
      }
    }
  });
});
