import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CocktailRecipe, WhatIsIn } from '../../../../services/api/recipes';
import WhatIsInAServe from './WhatIsInAServe';

const fig = (value: number | null, missing: string[] = [], atLeast = false) => ({ value, atLeast, missing });
const readable = (over: Partial<Extract<WhatIsIn, { readable: true }>> = {}): WhatIsIn => ({
  readable: true,
  figures: {
    energyKcal: fig(66.6, ['Campari'], true),
    fatG: fig(null, ['Campari', 'Gin']),
    saturatesG: fig(null, ['Campari', 'Gin']),
    carbohydrateG: fig(0, ['Campari'], true),
    sugarsG: fig(null, ['Campari', 'Gin']),
    proteinG: fig(null, ['Campari', 'Gin']),
    saltG: fig(null, ['Campari', 'Gin']),
  },
  notCounted: [{ label: 'Campari', why: 'it is not linked to anything on the shelf' }],
  allergens: { milk: 'contains', eggs: 'not_stated', gluten: 'free' },
  ...over,
});
const recipe = (whatIsIn: WhatIsIn | null | undefined): CocktailRecipe =>
  ({
    cocktail: { id: 'c', name: 'Negroni', price: null, glass: null, garnish: null, method: null, description: null },
    current: { versionId: 'v1', version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '', lines: [] },
    cost: null,
    whatIsIn,
    versionCount: 1,
    legacyLines: [],
  }) as CocktailRecipe;

describe('WhatIsInAServe', () => {
  it('says the summed figure, at least, and names the unlinked line as unknown, never 0', () => {
    render(<WhatIsInAServe data={recipe(readable())} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-energyKcal').textContent).toBe('Energy: at least 66.6 kcal, unknown for Campari');
    expect(screen.getByTestId('recipe-whatisin-saltG').textContent).toBe('Salt: unknown for Campari, Gin');
    expect(screen.getByTestId('recipe-whatisin-notcounted').textContent).toContain('Campari (it is not linked to anything on the shelf)');
    expect(screen.getByTestId('recipe-whatisin-allergens').textContent).toBe('Contains milk.');
  });

  it('says a failed read in the gateway sentence, not as an empty card', () => {
    render(<WhatIsInAServe data={recipe({ readable: false, sentence: 'What is in a serve could not be read just now.' })} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-unread').textContent).toBe('What is in a serve could not be read just now.');
    expect(screen.queryByTestId('recipe-whatisin')).toBeNull();
  });

  it('says not read when an older gateway sends nothing; tells an editor the sum is of the saved recipe', () => {
    const { unmount } = render(<WhatIsInAServe data={recipe(undefined)} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-unread').textContent).toContain('was not read here');
    unmount();
    render(<WhatIsInAServe data={recipe(readable())} unsaved />);
    expect(screen.getByTestId('recipe-whatisin').textContent).toContain('Save to count your changes.');
  });
  it('names the lines that state no allergens, so the card never reads as allergen-free', () => {
    const { unmount } = render(<WhatIsInAServe data={recipe(readable({ allergens: {}, allergensUnstatedBy: ['Campari', 'Orange twist'] }))} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-allergens-unstated').textContent).toBe(
      'No allergen can be ruled out: Campari, Orange twist do not say what they contain.',
    );
    unmount();
    render(<WhatIsInAServe data={recipe(readable({ allergens: { milk: 'free' }, allergensUnstatedBy: [] }))} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-allergens-free')).toBeInTheDocument();
    expect(screen.queryByTestId('recipe-whatisin-allergens-unstated')).toBeNull();
  });
});
