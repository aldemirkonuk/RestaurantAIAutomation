/**
 * The "Menu" column of /cocktails (r28 recipes audit, gap 2): the price the
 * house's current menu gives a line of the drink's name, beside its own, and
 * "differs" when they disagree. Owner and manager only, while a menu is current.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { fmtMoney } from '../../receipts/next/rc2-format';

const RID = '11111111-1111-4111-8111-111111111111';
const GT = '22222222-2222-4222-8222-222222222221';
const SOUR = '22222222-2222-4222-8222-222222222222';
const BARE = '22222222-2222-4222-8222-222222222223';
const PART = '22222222-2222-4222-8222-222222222224';
const FIGURES = `/recipes/${RID}/drinks/figures`;
const MENU = `/recipes/${RID}/menu-prices`;


const h = vi.hoisted(() => ({
  get: vi.fn(),
  role: 'manager',
  currency: 'TRY' as string | null,
  menu: null as unknown,
}));

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
        { id: BARE, name: 'Bare', display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: 9 },
        { id: PART, name: 'Paloma', display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: null },
      ],
      count: 4, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '',
    },
    loading: false,
    error: null,
  }),
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

beforeEach(() => {
  h.role = 'manager';
  h.menu = {
    amountsWithheld: false,
    currentMenus: 1,
    dishes: [],
    drinks: [
      { cocktailId: GT, menu: { found: 'one', prices: [9, 12], agrees: true } },
      { cocktailId: SOUR, menu: { found: 'one', prices: [11], agrees: false } },
      { cocktailId: BARE, menu: { found: 'none' } },
      // PART is not in the answer at all: a dash, never a guess.
    ],
  };
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
    if (url === FIGURES) return { data: { drinks: [] } };
    if (url === MENU) {
      if (h.menu instanceof Error) throw h.menu;
      return { data: h.menu };
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

const cell = (id: string) => screen.getByTestId(`drink-menu-${id}`).textContent;

describe('/cocktails Menu column', () => {
  it('shows the menu price beside the drink price, both prices of a two-price line, and marks a disagreement', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Menu' })).toBeInTheDocument());
    expect(cell(GT)).toBe(`${fmtMoney(9, 'TRY')} / ${fmtMoney(12, 'TRY')}`);
    expect(screen.queryByTestId(`menu-differs-${GT}`)).toBeNull();
    expect(cell(SOUR)).toBe(`${fmtMoney(11, 'TRY')}differs`);
    expect(cell(BARE)).toBe('Not on the menu');
    expect(cell(PART)).toBe('—');
  });

  it('the column sits right after Price', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Menu' })).toBeInTheDocument());
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(heads[heads.indexOf('Price') + 1]).toBe('Menu');
  });

  it('an unread menu is said once, with no column', async () => {
    h.menu = new Error('boom');
    mount();
    await waitFor(() => expect(screen.getByTestId('cocktails-menu-unread')).toBeInTheDocument());
    expect(screen.queryByRole('columnheader', { name: 'Menu' })).toBeNull();
  });

  it('staff never read the menu prices and see no column', async () => {
    h.role = 'staff';
    mount();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/settings/currency'));
    expect(screen.queryByRole('columnheader', { name: 'Menu' })).toBeNull();
    expect(h.get.mock.calls.map((c) => c[0])).not.toContain(MENU);
  });
});
