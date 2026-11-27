/**
 * A dish's recipe sheet says plate and goods, never serve, drink or bottle,
 * and carries no "pure alcohol" line for a dish with none. The drink's wording
 * is unchanged (r55 recipes audit: the dish sheet spoke the bar's words).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CocktailRecipe, WhatIsIn } from '../../../../services/api/recipes';
import DrinkCards from './DrinkCards';
import WhatIsInAServe from './WhatIsInAServe';
import { rowNote, type DraftRow } from './LineRow';
import { whyBlocked } from './RecipeSheet';

const fig = (value: number | null, missing: string[] = [], atLeast = false) => ({ value, atLeast, missing });
const say = (n: number) => `$${n.toFixed(2)}`;

const readable = (alcohol: ReturnType<typeof fig> | undefined): WhatIsIn => ({
  readable: true,
  figures: {
    energyKcal: fig(120),
    fatG: fig(3),
    saturatesG: fig(1),
    carbohydrateG: fig(10),
    sugarsG: fig(2),
    proteinG: fig(8),
    saltG: fig(0.5),
    ...(alcohol ? { alcoholMl: alcohol } : {}),
  },
  notCounted: [],
  allergens: {},
});

const recipe = (kind: 'dish' | 'cocktail', whatIsIn: WhatIsIn | null | undefined, over: Partial<CocktailRecipe> = {}): CocktailRecipe =>
  ({
    kind,
    cocktail: { id: 'c', name: 'X', price: 12, glass: null, garnish: null, method: null, description: null },
    current: { versionId: 'v1', version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '', lines: [] },
    cost: { perServe: 2, perServeExact: 2, priced: 1, of: 1, complete: true, partial: 1 },
    whatIsIn,
    versionCount: 1,
    legacyLines: [],
    ...over,
  }) as CocktailRecipe;

const row = (over: Partial<DraftRow>): DraftRow => ({
  key: 'r', role: 'stocked', inventoryId: null, itemName: null, itemKind: null, label: 'Flour', qtyText: '30', unit: 'g', saved: null, ...over,
});
const saved = (costBasis: string, costPerServe: number | null = null) =>
  ({ status: 'linked', costPerServe, costPerServeExact: costPerServe, costBasis }) as DraftRow['saved'];

describe('the line notes', () => {
  it('say dish and goods on a dish, and drink and bottle on a drink', () => {
    expect(rowNote(row({}), null, true)?.text).toBe("This dish won't take stock until 'Flour' is linked to something on your shelf.");
    expect(rowNote(row({}), null)?.text).toBe("This drink won't take stock until 'Flour' is linked to something on your shelf.");
    const linked = { inventoryId: 'i', itemName: 'Flour 1 kg' };
    const partial = rowNote(row({ ...linked, saved: saved('invoice_lot_wac_partial', 1.5) }), say, true)?.text;
    expect(partial).toBe('$1.50 a plate, from the goods that have an invoice; some on hand have none yet.');
    expect(rowNote(row({ ...linked, saved: saved('invoice_lot_wac', 1.5) }), say, true)?.text).toBe('$1.50 a plate');
    expect(rowNote(row({ ...linked, saved: saved('invoice_lot_wac', 1.5) }), say)?.text).toBe('$1.50 a serve');
  });

  it('say pack, not bottle, when a dish line has no size, and do not send a cook to pour', () => {
    const linked = { inventoryId: 'i', itemName: 'Flour' };
    expect(rowNote(row({ ...linked, saved: saved('size_not_known') }), say, true)?.text).toContain('how much one pack of Flour holds');
    expect(rowNote(row({ ...linked, saved: saved('size_not_known') }), say)?.text).toContain('how much one bottle of Flour holds');
    const pack = rowNote(row({ ...linked, unit: 'ml', saved: saved('pack_size_not_known') }), say, true)?.text ?? '';
    expect(pack).toContain('Link the line to the single pack you buy it in.');
    expect(pack).not.toMatch(/bottle|pour/);
    const mismatch = rowNote(row({ ...linked, saved: saved('unit_mismatch') }), say, true)?.text ?? '';
    expect(mismatch).toContain('Change the unit, or link the item it is bought as.');
    expect(mismatch).not.toMatch(/pour/);
    expect(rowNote(row({ ...linked, unit: 'ml', saved: saved('pack_size_not_known') }), say)?.text).toContain('single bottle you pour from');
  });
});

describe('the save refusal', () => {
  it('asks how many plates a dish makes, and how many serves a drink', () => {
    const r = [row({ inventoryId: 'i' })];
    expect(whyBlocked(r, 0, true)).toBe('Say how many plates it makes: a whole number from 1 to 1,000.');
    expect(whyBlocked(r, 0)).toBe('Say how many serves it makes: a whole number from 1 to 1,000.');
  });
});

describe('the cards', () => {
  it('say a plate under the price, and goods under a part-invoiced cost, on a dish', () => {
    render(<DrinkCards data={recipe('dish', undefined)} sayMoney={say} unsaved={false} />);
    expect(screen.getByTestId('drink-card-price')).toHaveTextContent('A plate, as your list has it.');
    expect(screen.getByTestId('drink-card-cost')).toHaveTextContent('priced from the goods with an invoice only');
    expect(screen.getByTestId('drink-card-cost')).not.toHaveTextContent('bottles');
  });

  it('say a plate when what is in it could not be read, on a dish', () => {
    render(<DrinkCards data={recipe('dish', undefined)} sayMoney={say} unsaved={false} />);
    expect(screen.getByTestId('drink-card-energy')).toHaveTextContent('What is in a plate could not be read here');
  });

  it('keep the drink’s own words', () => {
    render(<DrinkCards data={recipe('cocktail', undefined)} sayMoney={say} unsaved={false} />);
    expect(screen.getByTestId('drink-card-price')).toHaveTextContent('A serve, as your list has it.');
    expect(screen.getByTestId('drink-card-cost')).toHaveTextContent('priced from the bottles with an invoice only');
    expect(screen.getByTestId('drink-card-energy')).toHaveTextContent('What is in a serve could not be read here');
  });
});

describe('what is in it', () => {
  it('is headed "a plate" on a dish and "a serve" on a drink', () => {
    const { unmount } = render(<WhatIsInAServe data={recipe('dish', readable(undefined))} unsaved={false} />);
    expect(screen.getByRole('heading', { name: 'What is in a plate' })).toBeInTheDocument();
    expect(screen.getByLabelText('What is in a plate')).toBeInTheDocument();
    unmount();
    render(<WhatIsInAServe data={recipe('cocktail', readable(undefined))} unsaved={false} />);
    expect(screen.getByRole('heading', { name: 'What is in a serve' })).toBeInTheDocument();
  });

  it('says a plate when it was not read', () => {
    render(<WhatIsInAServe data={recipe('dish', undefined)} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-unread')).toHaveTextContent('What is in a plate was not read here');
  });

  it('shows no pure-alcohol line on a dish with none, or none stated, and shows one that has some', () => {
    const { unmount } = render(<WhatIsInAServe data={recipe('dish', readable(fig(0)))} unsaved={false} />);
    expect(screen.queryByTestId('recipe-whatisin-alcoholMl')).toBeNull();
    unmount();
    const { unmount: u2 } = render(<WhatIsInAServe data={recipe('dish', readable(fig(null, ['Flour'])))} unsaved={false} />);
    expect(screen.queryByTestId('recipe-whatisin-alcoholMl')).toBeNull();
    u2();
    const { unmount: u3 } = render(<WhatIsInAServe data={recipe('dish', readable(fig(8, ['Flour'], true)))} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-alcoholMl')).toHaveTextContent('at least 8 ml');
    u3();
    render(<WhatIsInAServe data={recipe('cocktail', readable(fig(0)))} unsaved={false} />);
    expect(screen.getByTestId('recipe-whatisin-alcoholMl')).toBeInTheDocument();
  });
});
