/**
 * /dishes: an opened dish whose price differs from the current menu's, or has
 * none, takes the menu's price through the dish's own PATCH after a confirm
 * (r28 recipes audit, gap 2, slice 2). Owner and manager only.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fmtMoney } from '../receipts/next/rc2-format';

const RID = '11111111-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MENU = `/recipes/${RID}/menu-prices`;

const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), role: 'manager', price: 500 as number | null, currentMenus: 1 }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: h.patch, delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { userId: 'u1', role: h.role } }),
}));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));

import DishesPage from './DishesPage';

const full = { perServe: 300, perServeExact: 300, priced: 2, of: 2, complete: true, partial: 0 };
const row = (id: string, name: string, price: number | null) => ({
  id, name, section: null, price, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: full,
});

beforeEach(() => {
  h.role = 'manager';
  h.price = 500;
  h.currentMenus = 1;
  h.patch.mockReset();
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) return { data: [row(B, 'Mezze', h.price), row(A, 'Lamb shank', 900)] };
    if (url === MENU) {
      return {
        data: {
          amountsWithheld: false,
          currentMenus: h.currentMenus,
          dishes: [
            { dishId: B, menu: { found: 'one', prices: [550], agrees: h.price == null ? null : h.price === 550 } },
            { dishId: A, menu: { found: 'one', prices: [900], agrees: true } },
          ],
          drinks: [],
        },
      };
    }
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

describe('/dishes: use the menu\'s price', () => {
  it('a dish that differs takes the menu price after a confirm, and the list reads it back', async () => {
    h.patch.mockImplementation(async () => {
      h.price = 550;
      return { data: { id: B, name: 'Mezze', section: null, price: 550 } };
    });
    mount();
    fireEvent.click(await screen.findByTestId(`dish-row-${B}`));
    expect((await screen.findByTestId('use-menu-price')).textContent).toContain(
      `Your current menu prices Mezze at ${lira(550)}; this list says ${lira(500)}.`,
    );
    fireEvent.click(screen.getByRole('button', { name: `Use ${lira(550)}` }));
    expect(h.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `Yes, use ${lira(550)}` }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${B}`, { price: 550 }));
    expect(await screen.findByText(`Mezze is now ${lira(550)}, as on your menu.`)).toBeTruthy();
    // The price box shows the price now kept, so Save has nothing to send.
    await waitFor(() => expect(screen.queryByTestId(`menu-differs-${B}`)).toBeNull());
    const details = within(screen.getByTestId(`dish-details-${B}`));
    await waitFor(() => expect((details.getByLabelText('Price') as HTMLInputElement).value).toBe('550'));
    expect((details.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a dish with no price of its own is offered the menu\'s', async () => {
    h.price = null;
    mount();
    fireEvent.click(await screen.findByTestId(`dish-row-${B}`));
    expect((await screen.findByTestId('use-menu-price')).textContent).toContain('it has no price here');
  });

  it('a dish that agrees is offered nothing', async () => {
    mount();
    fireEvent.click(await screen.findByTestId(`dish-row-${A}`));
    await screen.findByTestId(`dish-details-${A}`);
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(MENU));
    expect(screen.queryByTestId('use-menu-price')).toBeNull();
  });

  it('with no current menu nothing is offered, as no Menu column shows', async () => {
    h.currentMenus = 0;
    mount();
    fireEvent.click(await screen.findByTestId(`dish-row-${B}`));
    await screen.findByTestId(`dish-details-${B}`);
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(MENU));
    expect(screen.queryByRole('columnheader', { name: 'Menu' })).toBeNull();
    expect(screen.queryByTestId('use-menu-price')).toBeNull();
  });

  it('staff are offered nothing and never read the menu', async () => {
    h.role = 'staff';
    mount();
    fireEvent.click(await screen.findByTestId(`dish-row-${B}`));
    await screen.findByTestId('sheet');
    expect(screen.queryByTestId('use-menu-price')).toBeNull();
    expect(h.get.mock.calls.map((c) => c[0])).not.toContain(MENU);
  });
});
