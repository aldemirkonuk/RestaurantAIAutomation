/**
 * "Used in" (ItemUsedIn.tsx): three groups by how sure the link is, a failed
 * group said as failed, and the unlinked group never counted in usage.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ItemUsedIn, {
  DRINKS_DO_NOT_DRAW,
  DRINK_RECIPES_UNREAD,
  drinkHref,
  drinkGroups,
  foodCostShare,
  type DishesLoad,
  type DrinksLoad,
} from './ItemUsedIn';
import type { ItemDish, ItemDrink } from '../../../services/api/itemDishes';
import type { ItemUsedIn as UsedIn } from '../../../services/api/inventory';

const EUR = { state: 'recorded', code: 'EUR' } as const;
const ok = <T,>(lines: T[]) => ({ readable: true, lines, source: 's' });
const line = (id: string, name: string) => ({ menuItemId: id, menuId: 'menu', name, byGlassPrice: 18, bottlePrice: 92 });

const NO_DISHES: DishesLoad = { status: 'ready', data: { dishes: [] } };

function load(over: Partial<UsedIn> = {}) {
  return {
    status: 'ready' as const,
    data: {
      item: { id: 'i1', kind: 'spirit', displayName: null },
      soldAs: ok([line('m1', 'Rakı, single')]),
      inCocktails: ok([{ cocktailId: 'c1', name: 'Rakı sour', quantity: 40, unit: 'ml' }]),
      namedNotLinked: ok([line('m2', 'Rakı table set')]),
      recipes: { recorded: false as const, note: 'n' },
      ...over,
    },
  };
}

describe('Used in', () => {
  it('says a drink that uses the good does not take it from stock at the till yet (ADR 0360)', () => {
    render(
      <MemoryRouter>
        <ItemUsedIn
        dishes={NO_DISHES}
        onRetryDishes={vi.fn()}
          load={load({ inDrinkRecipes: ok([{ cocktailId: 'c2', name: 'Lime sour', label: 'Lime', qtyEntered: 20, unitCode: 'ml' }]) })}
          canManage
          currency={EUR}
          onRetry={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('ivd-used-cocktails').textContent).toContain(DRINKS_DO_NOT_DRAW);
    expect(screen.getByTestId('ivd-used-drink-recipes').textContent).toContain(DRINKS_DO_NOT_DRAW);
  });

  it('a drink that uses the good opens that drink, in the app and outside it', () => {
    const withRecipe = load({
      inDrinkRecipes: ok([{ cocktailId: 'c 2', name: 'Rakı highball', label: 'Rakı', qtyEntered: 40, unitCode: 'ml' }]),
    });
    const { unmount } = render(
      <MemoryRouter>
        <ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={withRecipe} canManage currency={EUR} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    expect(within(screen.getByTestId('ivd-used-cocktails')).getByRole('link', { name: 'Rakı sour' }).getAttribute('href')).toBe('/cocktails?open=c1');
    expect(
      within(screen.getByTestId('ivd-used-drink-recipes')).getByRole('link', { name: /Rakı highball/ }).getAttribute('href'),
    ).toBe(drinkHref('c 2'));
    expect(drinkHref('c 2')).toBe('/cocktails?open=c%202');
    // A menu line has no page of its own to open yet, so it is not drawn as a link.
    expect(within(screen.getByTestId('ivd-used-sold')).queryByRole('link')).toBeNull();
    unmount();
    render(<ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={withRecipe} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(within(screen.getByTestId('ivd-used-cocktails')).getByRole('link', { name: 'Rakı sour' }).getAttribute('href')).toBe('/cocktails?open=c1');
  });

  it('(d) draws the three groups, and says the unlinked one is not counted in usage', () => {
    render(<ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={load()} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(within(screen.getByTestId('ivd-used-sold')).getByText('Rakı, single')).toBeTruthy();
    expect(within(screen.getByTestId('ivd-used-cocktails')).getByText('Rakı sour')).toBeTruthy();
    const named = screen.getByTestId('ivd-used-named');
    expect(within(named).getByText('Rakı table set')).toBeTruthy();
    expect(named.textContent).toContain('not counted in usage');
    expect(screen.getByTestId('ivd-used-recipes').textContent).toContain('In dish recipes');
    expect(screen.queryByText(/Link this/)).toBeNull();
  });

  it('says a group that failed could not be read, and draws no lines for it', () => {
    render(
      <ItemUsedIn
        dishes={NO_DISHES}
        onRetryDishes={vi.fn()}
        load={load({ inCocktails: { readable: false, lines: null, source: 'permission denied for table cocktails' } })}
        canManage
        currency={EUR}
        onRetry={vi.fn()}
      />,
    );
    const g = screen.getByTestId('ivd-used-cocktails');
    expect(g.textContent).toContain('could not be read');
    expect(g.textContent).not.toContain('permission denied');
  });

  it('never says a food is used nowhere: each group says None under its own sentence, and the dish recipes say theirs', () => {
    const noMenu = 'This house has no current menu, so no line is on it. A menu that was read but never made current is not counted.';
    const notDrink = 'A cocktail recipe names a catalogue drink, and this item is not one.';
    render(
      <ItemUsedIn
        dishes={NO_DISHES}
        onRetryDishes={vi.fn()}
        load={load({
          item: { id: 'i1', kind: 'food', displayName: 'Flour' },
          soldAs: { readable: true, lines: [], source: noMenu },
          inCocktails: { readable: true, lines: [], source: notDrink },
          namedNotLinked: { readable: true, lines: [], source: noMenu },
        })}
        canManage
        currency={EUR}
        onRetry={vi.fn()}
      />,
    );
    const all = screen.getByTestId('ivd-used').textContent ?? '';
    expect(all).not.toMatch(/not on the menu|in a recipe yet|not used|used nowhere/i);
    expect(screen.getByTestId('ivd-used-sold-none').textContent).toBe('None.');
    expect(screen.getByTestId('ivd-used-sold').textContent).toContain(noMenu);
    expect(screen.getByTestId('ivd-used-cocktails-none').textContent).toBe('None.');
    expect(screen.getByTestId('ivd-used-cocktails').textContent).toContain(notDrink);
    // Nothing named and unlinked is nothing to link: that group stays out.
    expect(screen.queryByTestId('ivd-used-named')).toBeNull();
    expect(screen.getByTestId('ivd-used-recipes').textContent).toContain("No dish's current recipe uses this good.");
  });

  it('still shows the menu dish an item is sold as when it is in no cocktail', () => {
    render(<ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={load({ inCocktails: ok([]), namedNotLinked: ok([]) })} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(within(screen.getByTestId('ivd-used-sold')).getByText('Rakı, single')).toBeTruthy();
    expect(screen.queryByTestId('ivd-used-sold-none')).toBeNull();
    expect(screen.getByTestId('ivd-used-cocktails-none')).toBeTruthy();
  });

  it('says a failed group failed even when every other group is empty, and draws no None for it', () => {
    render(
      <ItemUsedIn
        dishes={NO_DISHES}
        onRetryDishes={vi.fn()}
        load={load({ soldAs: { readable: false, lines: null, source: 'x' }, inCocktails: ok([]), namedNotLinked: ok([]) })}
        canManage
        currency={EUR}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('ivd-used-sold').textContent).toContain('could not be read');
    expect(screen.queryByTestId('ivd-used-sold-none')).toBeNull();
    expect(screen.getByTestId('ivd-used-cocktails-none')).toBeTruthy();
  });

  it('says a group marked unreadable failed even if it carries an empty list, never None', () => {
    render(
      <ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={load({ inCocktails: { readable: false, lines: [], source: 'x' } })} canManage currency={EUR} onRetry={vi.fn()} />,
    );
    expect(screen.getByTestId('ivd-used-cocktails').textContent).toContain('could not be read');
    expect(screen.queryByTestId('ivd-used-cocktails-none')).toBeNull();
  });

  it('lists a cocktail that names the item twice as two lines, with no duplicate key, in written quantities', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ItemUsedIn
        dishes={NO_DISHES}
        onRetryDishes={vi.fn()}
        load={load({
          inCocktails: ok([
            { cocktailId: 'c1', name: 'Rakı sour', quantity: 0.1 + 0.2, unit: 'oz' },
            { cocktailId: 'c1', name: 'Rakı sour', quantity: 0.1 + 0.2, unit: 'oz' },
            { cocktailId: 'c2', name: 'Lion milk', quantity: 29.5735295625, unit: 'ml' },
          ]),
        })}
        canManage
        currency={EUR}
        onRetry={vi.fn()}
      />,
    );
    const items = within(screen.getByTestId('ivd-used-cocktails')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Rakı sour0.3 oz', 'Rakı sour0.3 oz', 'Lion milk29.57 ml']);
    expect(err.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    err.mockRestore();
  });

  it('shows menu prices to owners and managers only', () => {
    const { unmount } = render(<ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={load()} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(screen.getByTestId('ivd-used-sold').textContent).toMatch(/€/);
    unmount();
    render(<ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={load()} canManage={false} currency={EUR} onRetry={vi.fn()} />);
    expect(screen.getByTestId('ivd-used-sold').textContent).not.toMatch(/€/);
  });

  describe('In drink recipes', () => {
    const d = { cocktailId: 'c1', name: 'Rakı sour', label: 'Rakı', qtyEntered: 40, unitCode: 'ml' };
    const draw = (over: Partial<UsedIn>) =>
      render(<ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={load(over)} canManage currency={EUR} onRetry={vi.fn()} />);

    it('(i) draws each line as name, quantity, unit and label', () => {
      draw({ inDrinkRecipes: ok([d]) });
      const g = screen.getByTestId('ivd-used-drink-recipes');
      expect(g.textContent).toContain('In drink recipes');
      expect(within(g).getByText('Rakı sour — 40 ml (Rakı)')).toBeTruthy();
    });

    it('(ii) a group that could not be read says so and is never None', () => {
      draw({ inDrinkRecipes: { readable: false, lines: null, source: 'The drink recipes could not be read (x).' } });
      const g = screen.getByTestId('ivd-used-drink-recipes');
      expect(g.textContent).toContain(DRINK_RECIPES_UNREAD);
      expect(g.textContent).not.toContain('None');
    });

    it('(iii) a missing field from an older gateway reads as unread, never None', () => {
      draw({ inDrinkRecipes: undefined });
      const g = screen.getByTestId('ivd-used-drink-recipes');
      expect(g.textContent).toContain('could not be read here');
      expect(g.textContent).not.toContain('None');
    });
  });

  describe('the two drink groups never contradict each other (r5, R7)', () => {
    const d = (id: string, name: string) => ({ cocktailId: id, name, label: 'Rakı', qtyEntered: 40, unitCode: 'ml' });
    const c = (id: string, name: string) => ({ cocktailId: id, name, quantity: 40, unit: 'ml' });
    const draw = (over: Partial<UsedIn>) =>
      render(<ItemUsedIn dishes={NO_DISHES} onRetryDishes={vi.fn()} load={load(over)} canManage currency={EUR} onRetry={vi.fn()} />);

    it('says no "None." above a drink the recipes list', () => {
      draw({ inCocktails: ok([]), inDrinkRecipes: ok([d('c2', 'Lime sour')]) });
      expect(screen.queryByTestId('ivd-used-cocktails')).toBeNull();
      expect(screen.queryByText('None.', { selector: '[data-testid="ivd-used-cocktails-none"]' })).toBeNull();
      expect(within(screen.getByTestId('ivd-used-drink-recipes')).getByText(/Lime sour/)).toBeTruthy();
    });

    it('says no "None." under a drink its card lists', () => {
      draw({ inCocktails: ok([c('c1', 'Rakı sour')]), inDrinkRecipes: ok([]) });
      expect(within(screen.getByTestId('ivd-used-cocktails')).getByText('Rakı sour')).toBeTruthy();
      expect(screen.queryByTestId('ivd-used-drink-recipes')).toBeNull();
    });

    it('lists a drink once: its recipe line, not its card again', () => {
      draw({ inCocktails: ok([c('c1', 'Rakı sour'), c('c3', 'Old card')]), inDrinkRecipes: ok([d('c1', 'Rakı sour')]) });
      const cards = within(screen.getByTestId('ivd-used-cocktails')).getAllByRole('listitem');
      expect(cards.map((li) => li.textContent)).toEqual(['Old card40 ml']);
      expect(within(screen.getByTestId('ivd-used-drink-recipes')).getByText(/Rakı sour/)).toBeTruthy();
    });

    it('when both are empty, says one None, under the recipes', () => {
      draw({ inCocktails: ok([]), inDrinkRecipes: ok([]) });
      expect(screen.queryByTestId('ivd-used-cocktails')).toBeNull();
      expect(screen.getByTestId('ivd-used-drink-recipes-none').textContent).toBe('None.');
    });

    it('never hides a group that could not be read', () => {
      draw({ inCocktails: { readable: false, lines: null, source: 'x' }, inDrinkRecipes: ok([d('c2', 'Lime sour')]) });
      expect(screen.getByTestId('ivd-used-cocktails').textContent).toContain('could not be read');
      expect(drinkGroups(ok([c('c1', 'A')]), { readable: false, lines: null, source: 'x' }).recipes?.readable).toBe(false);
      expect(drinkGroups(ok([c('c1', 'A')]), undefined)).toEqual({ cards: ok([c('c1', 'A')]), recipes: undefined });
    });
  });
});

const dish = (over: Partial<ItemDish> = {}): ItemDish => ({
  dishId: 'd1', name: 'Pide', section: 'Mains', price: 10, hasRecipe: true, yieldServes: 8, lineCount: 3,
  cost: { perServe: 2.5, perServeExact: 2.5, priced: 3, of: 3, complete: true, partial: 0 },
  uses: [{ label: 'Flour', qtyEntered: 250, unitCode: 'g' }],
  ...over,
});
const ready = (...dishes: ItemDish[]): DishesLoad => ({ status: 'ready', data: { dishes } });
const mount = (dishes: DishesLoad, canManage = true, onRetryDishes = vi.fn()) =>
  render(
    <MemoryRouter>
      <ItemUsedIn load={load()} dishes={dishes} canManage={canManage} currency={EUR} onRetry={vi.fn()} onRetryDishes={onRetryDishes} />
    </MemoryRouter>,
  );
const recipes = () => screen.getByTestId('ivd-used-recipes');
const t = (s: string) => screen.getByTestId(`ivd-dish-d1-${s}`).textContent ?? '';

describe('In dish recipes', () => {
  it('says it is reading', () => {
    mount({ status: 'reading' });
    expect(recipes().textContent).toContain('Reading which dishes use it');
  });

  it('a failed read says why, can be read again, and never says None', () => {
    const retry = vi.fn();
    mount({ status: 'failed', reason: 'the gateway is down' }, true, retry);
    expect(recipes().textContent).toContain('Which dishes use this good could not be read — the gateway is down.');
    expect(screen.queryByTestId('ivd-used-recipes-none')).toBeNull();
    expect(recipes().textContent).not.toContain('None');
    fireEvent.click(within(recipes()).getByRole('button', { name: 'Read again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('says None, and why, when no current recipe uses the good', () => {
    mount(ready());
    expect(screen.getByTestId('ivd-used-recipes-none').textContent).toBe('None.');
    expect(recipes().textContent).toContain("No dish's current recipe uses this good.");
  });

  it('draws a dish as a link with its cards, money for managers', () => {
    mount(ready(dish()));
    const link = within(screen.getByTestId('ivd-dish-d1')).getByRole('link', { name: 'Pide' });
    expect(link.getAttribute('href')).toBe('/dishes?open=d1');
    expect(t('per-plate')).toContain('31.25 g');
    expect(t('per-plate')).toContain('in a batch of 8');
    expect(t('cost')).toContain('2.50');
    expect(t('price')).toContain('10');
    expect(t('food-cost')).toContain('25.0%');
    expect(t('food-cost')).toContain('of the price as your list has it; whether that price includes tax is not recorded');
  });

  it('an incomplete cost is Not known with how many lines are priced', () => {
    mount(ready(dish({ cost: { perServe: 1, perServeExact: 1, priced: 2, of: 3, complete: false, partial: 0 } })));
    expect(t('cost')).toContain('Not known');
    expect(t('cost')).toContain('2 of 3 lines priced');
    expect(t('food-cost')).toContain('Not known');
    expect(t('food-cost')).toContain('the cost is not complete');
  });

  it('a dish with no price says so and its food cost names the missing price', () => {
    mount(ready(dish({ price: null })));
    expect(t('price')).toContain('Not on the dish');
    expect(t('food-cost')).toContain('Not known');
    expect(t('food-cost')).toContain('the dish has no price');
  });

  it('staff see no cost, price or food cost, only the quantity', () => {
    mount(ready(dish({ price: null, cost: null })), false);
    expect(screen.getByTestId('ivd-dish-d1-per-plate')).toBeTruthy();
    expect(screen.queryByTestId('ivd-dish-d1-cost')).toBeNull();
    expect(screen.queryByTestId('ivd-dish-d1-price')).toBeNull();
    expect(screen.queryByTestId('ivd-dish-d1-food-cost')).toBeNull();
  });

  it('an unknown yield is Not known, not a guess', () => {
    mount(ready(dish({ yieldServes: null })));
    expect(t('per-plate')).toContain('Not known');
  });
});

describe('foodCostShare', () => {
  const c = (over = {}) => ({ perServe: 2.5, perServeExact: 2.5, priced: 3, of: 3, complete: true, partial: 0, ...over });
  it('is the exact cost over the price, one decimal', () => {
    expect(foodCostShare(c(), 10)).toEqual({ pct: 25 });
    expect(foodCostShare(c({ perServeExact: 1 }), 3)).toEqual({ pct: 33.3 });
  });
  it('is missing when the price is 0 or null', () => {
    expect(foodCostShare(c(), 0)).toEqual({ missing: ['the dish has no price'] });
    expect(foodCostShare(c(), null)).toEqual({ missing: ['the dish has no price'] });
  });
  it('is missing when the cost is incomplete, or null', () => {
    expect(foodCostShare(c({ complete: false }), 10)).toEqual({ missing: ['the cost is not complete'] });
    expect(foodCostShare(c({ perServeExact: null }), 10)).toEqual({ missing: ['the cost is not complete'] });
    expect(foodCostShare(null, 10)).toEqual({ missing: ['the cost is not complete'] });
  });
  it('names both when both are missing', () => {
    expect(foodCostShare(c({ complete: false }), 0)).toEqual({ missing: ['the cost is not complete', 'the dish has no price'] });
  });
});

const drink = (over: Partial<ItemDrink> = {}): ItemDrink => ({
  cocktailId: 'c1', name: 'House G&T', section: 'Highballs', price: 12, hasRecipe: true, yieldServes: 1, lineCount: 2,
  cost: { perServe: 1.5, perServeExact: 1.5, priced: 1, of: 1, complete: true, partial: 0 },
  uses: [{ label: 'Gin', qtyEntered: 50, unitCode: 'ml' }],
  ...over,
});
const drinksReady = (...drinks: ItemDrink[]): DrinksLoad => ({ status: 'ready', data: { drinks } });
const textLine = { cocktailId: 'c1', name: 'House G&T', label: 'Gin', qtyEntered: 50, unitCode: 'ml' };
const mountDrinks = (drinks: DrinksLoad | undefined, opts: { canManage?: boolean; over?: Partial<UsedIn>; onRetryDrinks?: () => void } = {}) =>
  render(
    <MemoryRouter>
      <ItemUsedIn
        load={load({ inCocktails: ok([]), inDrinkRecipes: ok([textLine]), ...opts.over })}
        dishes={NO_DISHES}
        drinks={drinks}
        canManage={opts.canManage ?? true}
        currency={EUR}
        onRetry={vi.fn()}
        onRetryDishes={vi.fn()}
        onRetryDrinks={opts.onRetryDrinks}
      />
    </MemoryRouter>,
  );
const dt = (s: string, id = 'c1') => screen.getByTestId(`ivd-drink-${id}-${s}`).textContent ?? '';

describe('In drink recipes, with their cards (the same as a dish)', () => {
  it('draws a drink as a link with this good a serve, cost a serve, price and pour cost', () => {
    mountDrinks(drinksReady(drink()));
    const g = screen.getByTestId('ivd-used-drink-recipes');
    expect(g.textContent).toContain(DRINKS_DO_NOT_DRAW);
    expect(within(screen.getByTestId('ivd-drink-c1')).getByRole('link', { name: 'House G&T' }).getAttribute('href')).toBe(drinkHref('c1'));
    expect(dt('per-serve')).toContain('This good a serve');
    expect(dt('per-serve')).toContain('50 ml');
    expect(dt('cost')).toContain('Cost a serve');
    expect(dt('cost')).toMatch(/1\.50/);
    expect(dt('price')).toContain('€12');
    expect(dt('pour-cost')).toContain('Pour cost');
    expect(dt('pour-cost')).toContain('12.5%');
    // The used-in line is not drawn a second time under the cards.
    expect(g.textContent).not.toContain('House G&T — 50 ml (Gin)');
  });

  it('a batch drink says a serve of it and the batch', () => {
    mountDrinks(drinksReady(drink({ yieldServes: 10, uses: [{ label: 'Gin', qtyEntered: 700, unitCode: 'ml' }] })));
    expect(dt('per-serve')).toContain('70 ml');
    expect(dt('per-serve')).toContain('in a batch of 10');
  });

  it('an incomplete cost and no price name both, and never show a %', () => {
    mountDrinks(drinksReady(drink({ price: null, cost: { perServe: null, perServeExact: null, priced: 1, of: 2, complete: false, partial: 0 } })));
    expect(dt('cost')).toContain('Not known');
    expect(dt('cost')).toContain('1 of 2 lines priced');
    expect(dt('price')).toContain('Not on the drink');
    expect(dt('pour-cost')).toContain('the cost is not complete and the drink has no price');
    expect(dt('pour-cost')).not.toMatch(/%/);
  });

  it('staff see only how much of the good a serve takes', () => {
    mountDrinks(drinksReady(drink({ price: null, cost: null })), { canManage: false });
    expect(dt('per-serve')).toContain('50 ml');
    expect(screen.queryByTestId('ivd-drink-c1-cost')).toBeNull();
    expect(screen.queryByTestId('ivd-drink-c1-price')).toBeNull();
    expect(screen.queryByTestId('ivd-drink-c1-pour-cost')).toBeNull();
  });

  it('while the cards are read, the drink is its used-in line', () => {
    mountDrinks({ status: 'reading' });
    expect(screen.getByTestId('ivd-used-drink-recipes').textContent).toContain('House G&T — 50 ml (Gin)');
    expect(screen.queryByTestId('ivd-drink-c1')).toBeNull();
  });

  it('a failed read keeps the used-in line, says the cards could not be read, and reads again', () => {
    const retry = vi.fn();
    mountDrinks({ status: 'failed', reason: 'the gateway is down' }, { onRetryDrinks: retry });
    const g = screen.getByTestId('ivd-used-drink-recipes');
    expect(g.textContent).toContain('House G&T — 50 ml (Gin)');
    const note = screen.getByTestId('ivd-used-drink-figures-unread');
    expect(note.textContent).toContain('could not be read — the gateway is down');
    fireEvent.click(within(note).getByRole('button', { name: 'Read again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('the figured list is the list: an empty one says one None under the recipes', () => {
    mountDrinks(drinksReady());
    expect(screen.getByTestId('ivd-used-drink-recipes-none').textContent).toBe('None.');
    expect(screen.queryByText(/House G&T/)).toBeNull();
  });

  it('a drink with cards is not listed again from its cocktail card', () => {
    mountDrinks(drinksReady(drink()), {
      over: { inCocktails: ok([{ cocktailId: 'c1', name: 'House G&T', quantity: 50, unit: 'ml' }, { cocktailId: 'c3', name: 'Old card', quantity: 1, unit: 'ml' }]) },
    });
    const cards = within(screen.getByTestId('ivd-used-cocktails')).getAllByRole('listitem');
    expect(cards.map((li) => li.textContent)).toEqual(['Old card1 ml']);
    expect(screen.getByTestId('ivd-drink-c1')).toBeTruthy();
  });
});

describe('foodCostShare for a drink', () => {
  it('names the drink when the price is missing', () => {
    expect(foodCostShare(null, null, 'drink')).toEqual({ missing: ['the cost is not complete', 'the drink has no price'] });
  });
});
