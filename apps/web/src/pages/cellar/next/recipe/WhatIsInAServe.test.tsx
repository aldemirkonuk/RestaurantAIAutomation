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

  it('keeps two decimals under one gram, so 0.06 g of salt never reads 0.1 g', () => {
    const base = readable();
    if (!base.readable) throw new Error('fixture');
    const data = readable({
      figures: {
        ...base.figures,
        saltG: fig(0.06, ['Angostura'], true),
        sugarsG: fig(17, ['Angostura'], true),
        fatG: fig(0.94, [], false),
        energyKcal: fig(178.45, [], false),
      },
    });
    render(<WhatIsInAServe data={recipe(data)} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-saltG').textContent).toBe('Salt: at least 0.06 g, unknown for Angostura');
    expect(screen.getByTestId('recipe-whatisin-fatG').textContent).toBe('Fat: 0.94 g');
    expect(screen.getByTestId('recipe-whatisin-sugarsG').textContent).toBe('of which sugars: at least 17 g, unknown for Angostura');
    // kcal is not grams: one decimal as before.
    expect(screen.getByTestId('recipe-whatisin-energyKcal').textContent).toBe('Energy: 178.5 kcal');
  });
  it('says the summed figure, at least, and names the unlinked line as unknown, never 0', () => {
    render(<WhatIsInAServe data={recipe(readable())} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-energyKcal').textContent).toBe('Energy: at least 66.6 kcal, unknown for Campari');
    expect(screen.getByTestId('recipe-whatisin-saltG').textContent).toBe('Salt: unknown for Campari, Gin');
    expect(screen.getByTestId('recipe-whatisin-notcounted').textContent).toContain('Campari (it is not linked to anything on the shelf)');
    expect(screen.getByTestId('recipe-whatisin-allergens').textContent).toBe('Contains milk.');
  });

  it('puts allergens first, then the figures, then pure alcohol with its grams', () => {
    const base = readable();
    if (!base.readable) throw new Error('fixture');
    render(<WhatIsInAServe data={recipe(readable({ figures: { ...base.figures, alcoholMl: fig(20, ['Tonic'], true) } }))} unsaved={false} />);
    const card = screen.getByTestId('recipe-whatisin');
    const allergens = screen.getByTestId('recipe-whatisin-allergens');
    const energy = screen.getByTestId('recipe-whatisin-energyKcal');
    expect(allergens.compareDocumentPosition(energy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 20 ml x 0.789 g/ml = 15.78 g.
    expect(screen.getByTestId('recipe-whatisin-alcoholMl').textContent).toBe('Pure alcohol: at least 20 ml (15.8 g), unknown for Tonic');
    expect(card).toHaveAttribute('aria-label', 'What is in a serve');
  });

  it('says alcohol nobody states as unknown for those lines, never 0 ml', () => {
    const base = readable();
    if (!base.readable) throw new Error('fixture');
    render(<WhatIsInAServe data={recipe(readable({ figures: { ...base.figures, alcoholMl: fig(null, ['Gin', 'Tonic']) } }))} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-alcoholMl').textContent).toBe('Pure alcohol: unknown for Gin, Tonic');
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
