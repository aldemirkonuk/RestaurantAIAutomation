/**
 * /dishes "Menu" column (r28 recipes audit, gap 2): the price the house's
 * current menu gives a line of the dish's name, beside the dish's own, and
 * "differs" when they disagree. Only for a role that sees money, only while
 * a menu is current; an unread menu is said once.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fmtMoney } from '../receipts/next/rc2-format';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const MENU = `/recipes/${RID}/menu-prices`;

const h = vi.hoisted(() => ({ get: vi.fn(), role: 'manager', menu: null as unknown }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { userId: 'u1', role: h.role } }),
}));

import DishesPage from './DishesPage';

const full = { perServe: 300, perServeExact: 300, priced: 2, of: 2, complete: true, partial: 0 };
const row = (id: string, name: string, price: number | null) => ({
  id, name, section: null, price, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: full,
});

const answer = (dishes: unknown[], currentMenus = 1) => ({ amountsWithheld: false, currentMenus, dishes, drinks: [] });

beforeEach(() => {
  h.role = 'manager';
  h.menu = answer([
    { dishId: A, menu: { found: 'one', prices: [900], agrees: true } },
    { dishId: B, menu: { found: 'one', prices: [550], agrees: false } },
    { dishId: C, menu: { found: 'none' } },
    { dishId: D, menu: { found: 'several', lines: 2 } },
    { dishId: E, menu: { found: 'one', prices: [], agrees: null } },
    // F has no price of its own: agreement is unknown, never "differs".
    { dishId: F, menu: { found: 'one', prices: [600], agrees: null } },
  ]);
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) return { data: [row(A, 'Lamb shank', 900), row(B, 'Mezze', 500), row(C, 'Soup', 300), row(D, 'Bread', 50), row(E, 'Tea', 40), row(F, 'Pilaf', null)] };
    if (url === MENU) {
      if (h.menu instanceof Error) throw h.menu;
      return { data: h.menu };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dishes']}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const cell = (id: string) => screen.getByTestId(`dish-menu-${id}`).textContent;

describe('/dishes Menu column', () => {
  it('shows the menu price beside the dish price, and marks the one that differs', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Menu' })).toBeInTheDocument());
    expect(cell(A)).toBe(fmtMoney(900, 'TRY'));
    expect(screen.queryByTestId(`menu-differs-${A}`)).toBeNull();
    expect(cell(B)).toBe(`${fmtMoney(550, 'TRY')}differs`);
    expect(screen.getByTestId(`menu-differs-${B}`)).toHaveTextContent('differs');
  });

  it('says when the menu does not name a dish, names it twice with different prices, or gives no price', async () => {
    mount();
    await waitFor(() => expect(cell(C)).toBe('Not on the menu'));
    expect(cell(D)).toBe('2 lines differ');
    expect(cell(E)).toBe('No price on the menu');
  });

  it('a dish with no price of its own shows the menu price and is not marked as differing', async () => {
    mount();
    await waitFor(() => expect(cell(F)).toBe(fmtMoney(600, 'TRY')));
    expect(screen.queryByTestId(`menu-differs-${F}`)).toBeNull();
  });

  it('the column sits right after Price', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Menu' })).toBeInTheDocument());
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Dish', 'Section', 'Price', 'Menu', 'Cost per plate', 'Food cost', 'Allergens']);
  });

  it('with no current menu there is no column and nothing is said', async () => {
    h.menu = answer([], 0);
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(MENU));
    expect(screen.queryByRole('columnheader', { name: 'Menu' })).toBeNull();
    expect(screen.queryByTestId('dishes-menu-unread')).toBeNull();
  });

  it('an unread menu is said once above the list, with no column', async () => {
    h.menu = new Error('boom');
    mount();
    await waitFor(() => expect(screen.getByTestId('dishes-menu-unread')).toHaveTextContent('could not be read just now'));
    expect(screen.queryByRole('columnheader', { name: 'Menu' })).toBeNull();
  });

  it('a later read that fails drops the earlier answer: no column beside the notice', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mount(qc);
    await waitFor(() => expect(cell(C)).toBe('Not on the menu'));
    h.menu = new Error('boom');
    await act(() => qc.invalidateQueries());
    await waitFor(() => expect(screen.getByTestId('dishes-menu-unread')).toHaveTextContent('could not be read just now'));
    expect(screen.queryByRole('columnheader', { name: 'Menu' })).toBeNull();
    expect(screen.queryByTestId(`dish-menu-${C}`)).toBeNull();
  });

  it('staff never read the menu prices and see no column', async () => {
    h.role = 'staff';
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    expect(screen.queryByRole('columnheader', { name: 'Menu' })).toBeNull();
    expect(h.get.mock.calls.map((c) => c[0])).not.toContain(MENU);
  });
});
