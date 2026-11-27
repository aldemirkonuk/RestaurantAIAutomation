/**
 * r103: the 94 px answered-height hold belongs to the figure cards that say "Reading…" and then fill in
 * (ItemCards.tsx, grid data-testid="ivd-cards"), not to the static "Used in" recipe cards, which share
 * the .ivd-card class and would each grow 58 -> 94 px for nothing. jsdom draws no CSS, so the rule's
 * selector is read from the stylesheet and matched against real markup.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ItemUsedIn, { type DishesLoad } from './ItemUsedIn';
import type { ItemDish } from '../../../services/api/itemDishes';

const css = readFileSync(resolve(__dirname, 'item-drawer.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const hold = /([^{}]+)\{[^{}]*min-height: 94px;[^{}]*\}/.exec(css);

const dish: ItemDish = {
  dishId: 'd1', name: 'Pide', section: 'Mains', price: 10, hasRecipe: true, yieldServes: 8, lineCount: 3,
  cost: { perServe: 2.5, perServeExact: 2.5, priced: 3, of: 3, complete: true, partial: 0 },
  uses: [{ label: 'Flour', qtyEntered: 250, unitCode: 'g' }],
};
const dishes: DishesLoad = { status: 'ready', data: { dishes: [dish] } };
const ok = <T,>(lines: T[]) => ({ readable: true, lines, source: 's' });

describe('the 94 px hold is for the figure cards only (r103)', () => {
  it('the stylesheet has one hold rule, and it is not the bare .ivd-card', () => {
    expect(hold).not.toBeNull();
    expect(css.match(/min-height: 94px/g)).toHaveLength(1);
    expect(hold![1].trim()).not.toBe('.ivd-card');
  });

  it('it matches a card inside the figure grid', () => {
    document.body.innerHTML = '<div class="ivd-cards" data-testid="ivd-cards"><div class="ivd-card" id="fig"></div></div>';
    expect(document.getElementById('fig')!.matches(hold![1].trim())).toBe(true);
  });

  it('it does not match a recipe DishCard in Used in', () => {
    document.body.innerHTML = '';
    render(
      <MemoryRouter>
        <ItemUsedIn
          load={{ status: 'ready', data: { item: { id: 'i1', kind: 'spirit', displayName: null }, soldAs: ok([]), inCocktails: ok([]), namedNotLinked: ok([]) } }}
          dishes={dishes}
          canManage
          currency={{ state: 'recorded', code: 'EUR' }}
          onRetry={vi.fn()}
          onRetryDishes={vi.fn()}
        />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('ivd-dish-d1-price');
    expect(card.className).toBe('ivd-card');
    expect(card.matches(hold![1].trim())).toBe(false);
  });
});
