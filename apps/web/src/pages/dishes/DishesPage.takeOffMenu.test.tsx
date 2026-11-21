/**
 * /dishes: the dishes the current menu prints no line of are counted, shown and
 * taken off the list together after one confirm (g2 menu gap). Owner and manager.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // not on the menu
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // on the menu
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // several lines: on the menu
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // not on the menu
const OFF = `/recipes/${RID}/dishes/take-off-menu`;

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: 'manager', current: 1, menuFails: false, off: false }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { userId: 'u1', role: h.role } }),
}));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));

import DishesPage from './DishesPage';

const list = (id: string, name: string, section: string | null) => ({ id, name, section, price: 100 });

beforeEach(() => {
  h.role = 'manager';
  h.current = 1;
  h.menuFails = false;
  h.off = false;
  h.post.mockReset();
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) {
      const all = [list(A, 'Lamb stew', 'Mains'), list(B, 'Lamb shank', null), list(C, 'Apple pie', null), list(D, 'Fish pie', null)];
      return { data: h.off ? all.filter((d) => d.id !== A && d.id !== D) : all };
    }
    if (url === `/recipes/${RID}/dishes/figures`) return { data: { costsUnread: false, dishes: [] } };
    if (url === `/recipes/${RID}/menu-prices`) {
      if (h.menuFails) throw new Error('down');
      return {
        data: {
          amountsWithheld: false,
          currentMenus: h.current,
          dishes: [
            { dishId: A, menu: { found: 'none' } },
            { dishId: B, menu: { found: 'one', prices: [100], agrees: true } },
            { dishId: C, menu: { found: 'several', lines: 2 } },
            { dishId: D, menu: { found: 'none' } },
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

describe("/dishes: take the dishes the menu does not print off the list", () => {
  it('counts only the dishes with no line on the menu, shows only them, and writes nothing yet', async () => {
    mount();
    expect((await screen.findByTestId('take-off-menu')).textContent).toContain('2 dishes are not on the current menu.');
    fireEvent.click(within(screen.getByTestId('take-off-menu')).getByRole('button', { name: 'Show them' }));
    await waitFor(() => expect(screen.queryByTestId(`dish-row-${B}`)).toBeNull());
    expect(screen.queryByTestId(`dish-row-${C}`)).toBeNull();
    const sheet = within(await screen.findByTestId('take-off-menu-sheet'));
    expect(within(sheet.getByTestId(`take-off-menu-row-${A}`)).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Lamb stew', 'Mains']);
    expect(within(sheet.getByTestId(`take-off-menu-row-${D}`)).getAllByRole('cell')[1].textContent).toBe('No section');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('the button takes exactly the listed dishes off, once, then says so', async () => {
    h.post.mockImplementation(async () => {
      h.off = true;
      return { data: { removed: [{ id: A, name: 'Lamb stew' }], skipped: [{ id: D, name: 'Fish pie', why: 'A line of that name is on the current menu.' }] } };
    });
    mount();
    await screen.findByTestId('take-off-menu');
    fireEvent.click(within(screen.getByTestId('take-off-menu')).getByRole('button', { name: 'Show them' }));
    const btn = await screen.findByRole('button', { name: 'Take them off the list' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post).toHaveBeenCalledWith(OFF, { ids: [A, D] });
    const said = await screen.findByTestId('take-off-menu-said');
    expect(said.textContent).toContain('1 dish is off your list.');
    expect(said.textContent).toContain('Fish pie was left on the list: A line of that name is on the current menu.');
    await waitFor(() => expect(screen.queryByTestId(`dish-row-${A}`)).toBeNull());
  });

  it('a gateway that cannot be reached is said in words, not as the transport\'s "Network Error"', async () => {
    h.post.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    mount();
    await screen.findByTestId('take-off-menu');
    fireEvent.click(within(screen.getByTestId('take-off-menu')).getByRole('button', { name: 'Show them' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Take them off the list' }));
    const said = await screen.findByTestId('take-off-menu-said');
    expect(said.textContent).toContain('Nothing was taken off: Mudavym could not be reached just now.');
    expect(said.textContent).not.toContain('Network Error');
  });

  it('a failed take-off says nothing was taken off, with the gateway\'s sentence, and keeps the list to try again', async () => {
    h.post.mockRejectedValue({ response: { data: { message: 'The menu or the dishes could not be read just now. No dish was taken off.' } } });
    mount();
    await screen.findByTestId('take-off-menu');
    fireEvent.click(within(screen.getByTestId('take-off-menu')).getByRole('button', { name: 'Show them' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Take them off the list' }));
    const said = await screen.findByTestId('take-off-menu-said');
    expect(said.textContent).toContain('Nothing was taken off: The menu or the dishes could not be read just now. No dish was taken off.');
    expect(said).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'Take them off the list' })).toBeEnabled();
  });

  it('says nothing when the menu could not be read or no menu is current, and nothing to staff', async () => {
    h.menuFails = true;
    const first = mount();
    await screen.findByTestId('dishes-menu-unread');
    expect(screen.queryByTestId('take-off-menu')).toBeNull();
    first.unmount();

    h.menuFails = false;
    h.current = 0;
    const second = mount();
    await screen.findByTestId(`dish-row-${A}`);
    expect(screen.queryByTestId('take-off-menu')).toBeNull();
    second.unmount();

    h.current = 1;
    h.role = 'staff';
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    expect(screen.queryByTestId('take-off-menu')).toBeNull();
  });
});
