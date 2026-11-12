/**
 * "Used in" (ItemUsedIn.tsx): three groups by how sure the link is, a failed
 * group said as failed, and the unlinked group never counted in usage.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ItemUsedIn, { DRINKS_DO_NOT_DRAW, DRINK_RECIPES_UNREAD, RECIPES_UNKNOWN, drinkHref, drinkGroups } from './ItemUsedIn';
import type { ItemUsedIn as UsedIn } from '../../../services/api/inventory';

const EUR = { state: 'recorded', code: 'EUR' } as const;
const ok = <T,>(lines: T[]) => ({ readable: true, lines, source: 's' });
const line = (id: string, name: string) => ({ menuItemId: id, menuId: 'menu', name, byGlassPrice: 18, bottlePrice: 92 });

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
        <ItemUsedIn load={withRecipe} canManage currency={EUR} onRetry={vi.fn()} />
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
    render(<ItemUsedIn load={withRecipe} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(within(screen.getByTestId('ivd-used-cocktails')).getByRole('link', { name: 'Rakı sour' }).getAttribute('href')).toBe('/cocktails?open=c1');
  });

  it('(d) draws the three groups, and says the unlinked one is not counted in usage', () => {
    render(<ItemUsedIn load={load()} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(within(screen.getByTestId('ivd-used-sold')).getByText('Rakı, single')).toBeTruthy();
    expect(within(screen.getByTestId('ivd-used-cocktails')).getByText('Rakı sour')).toBeTruthy();
    const named = screen.getByTestId('ivd-used-named');
    expect(within(named).getByText('Rakı table set')).toBeTruthy();
    expect(named.textContent).toContain('not counted in usage');
    expect(screen.getByTestId('ivd-used-recipes').textContent).toContain(RECIPES_UNKNOWN);
    expect(screen.queryByText(/Link this/)).toBeNull();
  });

  it('says a group that failed could not be read, and draws no lines for it', () => {
    render(
      <ItemUsedIn
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

  it('never says a food is used nowhere: each group says None under its own sentence, recipes are not known', () => {
    const noMenu = 'This house has no current menu, so no line is on it. A menu that was read but never made current is not counted.';
    const notDrink = 'A cocktail recipe names a catalogue drink, and this item is not one.';
    render(
      <ItemUsedIn
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
    expect(screen.getByTestId('ivd-used-recipes').textContent).toContain('not known here');
  });

  it('still shows the menu dish an item is sold as when it is in no cocktail', () => {
    render(<ItemUsedIn load={load({ inCocktails: ok([]), namedNotLinked: ok([]) })} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(within(screen.getByTestId('ivd-used-sold')).getByText('Rakı, single')).toBeTruthy();
    expect(screen.queryByTestId('ivd-used-sold-none')).toBeNull();
    expect(screen.getByTestId('ivd-used-cocktails-none')).toBeTruthy();
  });

  it('says a failed group failed even when every other group is empty, and draws no None for it', () => {
    render(
      <ItemUsedIn
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
      <ItemUsedIn load={load({ inCocktails: { readable: false, lines: [], source: 'x' } })} canManage currency={EUR} onRetry={vi.fn()} />,
    );
    expect(screen.getByTestId('ivd-used-cocktails').textContent).toContain('could not be read');
    expect(screen.queryByTestId('ivd-used-cocktails-none')).toBeNull();
  });

  it('lists a cocktail that names the item twice as two lines, with no duplicate key, in written quantities', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ItemUsedIn
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
    const { unmount } = render(<ItemUsedIn load={load()} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(screen.getByTestId('ivd-used-sold').textContent).toMatch(/€/);
    unmount();
    render(<ItemUsedIn load={load()} canManage={false} currency={EUR} onRetry={vi.fn()} />);
    expect(screen.getByTestId('ivd-used-sold').textContent).not.toMatch(/€/);
  });

  describe('In drink recipes', () => {
    const d = { cocktailId: 'c1', name: 'Rakı sour', label: 'Rakı', qtyEntered: 40, unitCode: 'ml' };
    const draw = (over: Partial<UsedIn>) =>
      render(<ItemUsedIn load={load(over)} canManage currency={EUR} onRetry={vi.fn()} />);

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
      render(<ItemUsedIn load={load(over)} canManage currency={EUR} onRetry={vi.fn()} />);

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
