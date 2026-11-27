/**
 * /dishes: the dishes the current menu prices apart from the list are counted,
 * shown, and taken together after one confirm (g1 menu gap). Owner and manager.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { formatMoney } from '../../lib/currency';
import { houseNumberLocale } from '../../lib/house-number';
/** What the page prints: money in the house's own number form (r104). */
const fmtMoney = (n: number, c: string) => formatMoney(n, c, { locale: houseNumberLocale(c) });

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // 500 -> 550, differs
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // agrees
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // several lines
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // no price, menu 40
const TAKE = `/recipes/${RID}/dishes/take-menu-prices`;

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: 'manager', priceA: 500 as number, taken: false, noRecipe: false }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { userId: 'u1', role: h.role } }),
}));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));

import DishesPage from './DishesPage';

const cost = (per: number) => ({ perServe: per, perServeExact: per, priced: 2, of: 2, complete: true, partial: 0 });
const list = (id: string, name: string, price: number | null) => ({ id, name, section: null, price });
const fig = (id: string, per: number) => ({ dishId: id, price: null, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: cost(per), allergens: null });

beforeEach(() => {
  h.role = 'manager';
  h.priceA = 500;
  h.taken = false;
  h.noRecipe = false;
  h.post.mockReset();
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) {
      return { data: [list(A, 'Mezze', h.priceA), list(B, 'Lamb shank', 900), list(C, 'Apple pie', 80), list(D, 'Bread', null)] };
    }
    if (url === `/recipes/${RID}/dishes/figures`) {
      return { data: { costsUnread: false, dishes: h.noRecipe ? [] : [fig(A, 100), fig(B, 300), fig(C, 20), fig(D, 10)] } };
    }
    if (url === `/recipes/${RID}/menu-prices`) {
      return {
        data: {
          amountsWithheld: false,
          currentMenus: 1,
          dishes: [
            { dishId: A, menu: { found: 'one', prices: [550], agrees: h.priceA === 550 } },
            { dishId: B, menu: { found: 'one', prices: [900], agrees: true } },
            { dishId: C, menu: { found: 'several', lines: 2 } },
            { dishId: D, menu: { found: 'one', prices: [40], agrees: null } },
          ],
          drinks: [],
        },
      };
    }
    if (url === `/recipes/${RID}/dishes/from-menu`) return { data: { currentMenus: 1, dishes: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/dishes']}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const lira = (n: number) => fmtMoney(n, 'TRY');

describe('/dishes: take the menu\'s prices together', () => {
  it('says a food cost share that is not known once, not "not known to not known"', async () => {
    h.noRecipe = true;
    mount();
    await screen.findByTestId('take-menu-prices');
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    const sheet = within(await screen.findByTestId('take-menu-prices-sheet'));
    const a = within(sheet.getByTestId(`take-menu-prices-row-${A}`)).getAllByRole('cell').map((c) => c.textContent);
    expect(a[3]).toBe('not known');
  });

  it('counts the dishes that differ, shows only them, and lists old price, new price and food cost share', async () => {
    mount();
    expect((await screen.findByTestId('take-menu-prices')).textContent).toContain('2 dishes are priced differently on the current menu.');
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    // Only the two that differ remain on the list: the agreeing and the "several" dish are hidden.
    await waitFor(() => expect(screen.queryByTestId(`dish-row-${B}`)).toBeNull());
    expect(screen.queryByTestId(`dish-row-${C}`)).toBeNull();
    const sheet = within(await screen.findByTestId('take-menu-prices-sheet'));
    const a = within(sheet.getByTestId(`take-menu-prices-row-${A}`)).getAllByRole('cell').map((c) => c.textContent);
    expect(a[0]).toBe('Mezze');
    expect(a[1]).toBe(lira(500));
    expect(a[2]).toBe(lira(550));
    // 100 over 500 is 20 %, over 550 is 18.2 %.
    expect(a[3]).toMatch(/20[.,]0.* to .*18[.,]2/);
    expect(within(sheet.getByTestId(`take-menu-prices-row-${D}`)).getAllByRole('cell')[1].textContent).toBe('No price');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('the button writes once, for exactly the listed dishes, then says what changed', async () => {
    h.post.mockImplementation(async () => {
      h.priceA = 550;
      return { data: { changed: [{ id: A, name: 'Mezze', from: 500, to: 550 }], skipped: [{ id: D, name: 'Bread', why: 'It was taken off your list while this ran.' }] } };
    });
    mount();
    await screen.findByTestId('take-menu-prices');
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    const btn = await screen.findByRole('button', { name: 'Use the menu’s prices' });
    fireEvent.click(btn);
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post).toHaveBeenCalledWith(TAKE, { ids: [A, D] });
    const said = await screen.findByTestId('take-menu-prices-said');
    expect(said.textContent).toContain('1 dish now uses the menu’s price.');
    expect(said.textContent).toContain('Bread was left as it was: It was taken off your list while this ran.');
  });

  it('a refused write says nothing was changed, in the gateway\'s words', async () => {
    h.post.mockRejectedValue({ response: { data: { message: 'The menu or the dishes could not be read just now. No price was changed.' } } });
    mount();
    await screen.findByTestId('take-menu-prices');
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use the menu’s prices' }));
    const said = await screen.findByTestId('take-menu-prices-said');
    expect(said.getAttribute('role')).toBe('alert');
    expect(said.textContent).toContain('Nothing was changed: The menu or the dishes could not be read just now.');
  });

  it('with no dish differing nothing is offered', async () => {
    h.priceA = 550;
    mount();
    await screen.findByTestId(`dish-row-${B}`);
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(`/recipes/${RID}/menu-prices`));
    // Bread has no price and the menu gives one, so it still differs: one dish.
    expect((await screen.findByTestId('take-menu-prices')).textContent).toContain('1 dish is priced differently');
  });

  it('staff are offered nothing and never read the menu', async () => {
    h.role = 'staff';
    mount();
    await screen.findByTestId(`dish-row-${B}`);
    expect(screen.queryByTestId('take-menu-prices')).toBeNull();
    expect(h.get.mock.calls.map((c) => c[0])).not.toContain(`/recipes/${RID}/menu-prices`);
  });
});
