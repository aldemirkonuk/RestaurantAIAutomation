/**
 * /cocktails: an opened drink whose price differs from the current menu's
 * takes the menu's price through the drink's own PATCH after a confirm (r28
 * recipes audit, gap 2, slice 2). Owner and manager only; not while the
 * drink's own form is open.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fmtMoney } from '../../receipts/next/rc2-format';

const RID = '11111111-1111-4111-8111-111111111111';
const GT = '22222222-2222-4222-8222-222222222221';
const SOUR = '22222222-2222-4222-8222-222222222222';
const FIGURES = `/recipes/${RID}/drinks/figures`;
const MENU = `/recipes/${RID}/menu-prices`;

const h = vi.hoisted(() => ({ get: vi.fn(), amend: vi.fn(), role: 'manager' }));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { role: h.role } }),
}));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    data: {
      rows: [
        { id: GT, name: 'House G&T', display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: 12 },
        { id: SOUR, name: 'Gin Sour', display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: 10 },
      ],
      count: 2, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '',
    },
    loading: false,
    error: null,
  }),
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: h.amend, isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

beforeEach(() => {
  h.role = 'manager';
  h.amend.mockReset().mockResolvedValue({});
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
    if (url === FIGURES) return { data: { drinks: [] } };
    if (url === MENU) {
      return {
        data: {
          amountsWithheld: false,
          currentMenus: 1,
          dishes: [],
          drinks: [
            { cocktailId: GT, menu: { found: 'one', prices: [12], agrees: true } },
            { cocktailId: SOUR, menu: { found: 'one', prices: [11], agrees: false } },
          ],
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/cocktails']}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  return render(<CocktailRegister register={null} registerLoading={false} />, { wrapper: wrap });
}

const lira = (n: number) => fmtMoney(n, 'TRY');
const openDrink = async (name: string) => {
  await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Menu' })).toBeInTheDocument());
  fireEvent.click(screen.getByText(name));
  await screen.findByTestId('cocktail-leaf');
};

describe('/cocktails: use the menu\'s price', () => {
  it('a drink that differs takes the menu price after a confirm, through its own amend', async () => {
    mount();
    await openDrink('Gin Sour');
    expect(screen.getByTestId('use-menu-price').textContent).toContain(
      `Your current menu prices Gin Sour at ${lira(11)}; this list says ${lira(10)}.`,
    );
    fireEvent.click(screen.getByRole('button', { name: `Use ${lira(11)}` }));
    expect(screen.getByText(`Set Gin Sour’s price to ${lira(11)}? Its pour cost is then taken over ${lira(11)}.`)).toBeTruthy();
    expect(h.amend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `Yes, use ${lira(11)}` }));
    await waitFor(() => expect(h.amend).toHaveBeenCalledWith({ id: SOUR, input: { price: 11 } }));
    expect(await screen.findByText(`Gin Sour is now ${lira(11)}, as on your menu.`)).toBeTruthy();
  });

  it('a drink that agrees is offered nothing', async () => {
    mount();
    await openDrink('House G&T');
    expect(screen.queryByTestId('use-menu-price')).toBeNull();
  });

  it('is not offered while the drink\'s own form is open', async () => {
    mount();
    await openDrink('Gin Sour');
    expect(screen.getByTestId('use-menu-price')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Amend/ }));
    expect(screen.queryByTestId('use-menu-price')).toBeNull();
  });

  it('staff are offered nothing', async () => {
    h.role = 'staff';
    mount();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/settings/currency'));
    fireEvent.click(screen.getByText('Gin Sour'));
    await screen.findByTestId('cocktail-leaf');
    expect(screen.queryByTestId('use-menu-price')).toBeNull();
  });
});
