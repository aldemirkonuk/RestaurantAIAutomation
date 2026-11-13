/**
 * The recipe's "What is in it" (sumRecipe wired, #940): a line with no figures
 * is named "unknown for X" and never counted as 0.
 *
 * The cocktail register no longer mounts this component: the recipe stack's
 * sheet (cellar/next/recipe/RecipeSheet.tsx) shows a drink's own "What is in a
 * serve" card instead, and its inline Recipe is gone (r21 merge-readiness,
 * resolve/r21-cocktail-recipe-meets-inventory).
 */
import { describe, expect, it } from 'vitest';
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
