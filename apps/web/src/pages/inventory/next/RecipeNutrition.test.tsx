/**
 * The recipe's "What is in it" (sumRecipe wired, #940): a line with no figures
 * is named "unknown for X" and never counted as 0; the recipe on the cocktail
 * register shows it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RecipeNutrition from './RecipeNutrition';
import type { RecipeLine } from './nutrition-sum';

const per100ml = { basis: '100ml' as const, energyFromAbv: false, energyKcal: 40, proteinG: 0, fatG: 0, saturatesG: null, carbohydrateG: 10, sugarsG: 10, saltG: null };
const line = (name: string, nutrition: RecipeLine['nutrition'], quantity: number | null = 30): RecipeLine => ({
  name,
  quantity,
  unit: 'ml',
  nutrition,
  allergens: null,
});

describe('RecipeNutrition', () => {
  it('names the line with no figures as unknown, and never reads it as 0', () => {
    render(<RecipeNutrition lines={[line('Campari', per100ml), line('Gin', null)]} />);
    expect(screen.getByTestId('recipe-nutrition-energyKcal').textContent).toBe('Energy: at least 12 kcal, unknown for Gin');
    // Nobody states salt: not 0, and not a number at all.
    expect(screen.getByTestId('recipe-nutrition-saltG').textContent).toBe('Salt: unknown for Gin, Campari');
  });

  it('says unknown for every line when none has figures', () => {
    render(<RecipeNutrition lines={[line('Gin', null), line('Orange peel', null, null)]} />);
    const t = screen.getByTestId('recipe-nutrition-energyKcal').textContent;
    expect(t).toBe('Energy: unknown for Gin, Orange peel');
    expect(t).not.toMatch(/\b0\b/);
  });

  it('shows nothing for a recipe with no lines', () => {
    const { container } = render(<RecipeNutrition lines={[]} />);
    expect(container.textContent).toBe('');
  });
});

const hooks = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('../../cellar/next/useCellarNextData', () => ({
  useCocktailRecipe: () => ({ data: { cocktailId: 'c1', rows: hooks.rows, count: hooks.rows.length, writable: true }, loading: false, error: null }),
  useCocktailWrites: () => ({ setRecipe: { mutateAsync: vi.fn(), isPending: false } }),
}));

describe('the cocktail recipe shows it', () => {
  it('sums the recipe lines on the cocktail register', async () => {
    hooks.rows = [
      { id: 'a', free_text: 'gin', quantity: 30, unit: 'ml' },
      { id: 'b', free_text: 'orange peel', quantity: null, unit: null },
    ];
    const { Recipe } = await import('../../cellar/next/CocktailRegister');
    render(<Recipe cocktailId="c1" />);
    expect(screen.getByTestId('recipe-nutrition-energyKcal').textContent).toBe('Energy: unknown for gin, orange peel');
  });
});
