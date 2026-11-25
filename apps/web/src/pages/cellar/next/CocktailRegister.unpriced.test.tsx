/**
 * "Only without a cost" on /cocktails (r107 drinks-g6): the house could find
 * drinks with no recipe, never drinks whose recipe has a line with no price,
 * so a half-costed list read as complete. The switch uses the same predicate
 * as the words under each Not known cost (`costNotKnown`), owner or manager only.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const GT = '22222222-2222-4222-8222-222222222221';
const SOUR = '22222222-2222-4222-8222-222222222222';
const BARE = '22222222-2222-4222-8222-222222222223';
const PART = '22222222-2222-4222-8222-222222222224';
const FIGURES = `/recipes/${RID}/drinks/figures`;

const cost = (o: Record<string, unknown>) => ({ perServe: 1.5, perServeExact: 1.5, priced: 1, of: 1, complete: true, partial: 0, ...o });

const h = vi.hoisted(() => ({
  get: vi.fn(),
  role: 'manager',
  currency: 'TRY' as string | null,
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { role: h.role } }),
}));
const tax = vi.hoisted(() => ({ basis: 'prices_exclude_tax' as 'prices_exclude_tax' | 'unset' }));
vi.mock('./recipe/useListTax', () => ({ useListTax: () => ({ basis: tax.basis }) }));
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
  useCocktailManages: () => true,
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

const figures = [
  { cocktailId: GT, price: 12, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: cost({}) },
// Incomplete: the lines priced so far add to 0.80, which is never the cost.
  { cocktailId: SOUR, price: 10, hasRecipe: true, yieldServes: 2, lineCount: 2, cost: cost({ complete: false, perServe: 0.8, perServeExact: 0.8, of: 2 }) },
  { cocktailId: BARE, price: 9, hasRecipe: false, yieldServes: null, lineCount: 0, cost: null },
  { cocktailId: PART, price: null, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: cost({ perServe: 2, perServeExact: 2, partial: 1 }) },
];

beforeEach(() => {
  h.role = 'manager';
  h.currency = 'TRY';
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') {
      return h.currency
        ? { data: { restaurantId: RID, code: h.currency, country: null, readable: true, reason: null, statedAt: null } }
        : { data: { restaurantId: RID, code: null, country: null, readable: false, reason: 'not set', statedAt: null } };
    }
    if (url === FIGURES) return { data: { drinks: figures } };
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
  return { qc, ...render(<CocktailRegister register={null} registerLoading={false} />, { wrapper: wrap }) };
}


const rowsShown = () => ['House G&T', 'Gin Sour', 'Bare', 'Paloma'].filter((n) => screen.queryByText(n));
const only = () => screen.getByTestId('no-cost-yet').querySelector('input') as HTMLInputElement;

describe('Only without a cost', () => {
  it('shows the one drink whose recipe has an unpriced line, and says what it waits on', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('no-cost-yet')).toHaveTextContent('1 of 4 drinks has a recipe with a line that has no price'));
    expect(rowsShown()).toEqual(['House G&T', 'Gin Sour', 'Bare', 'Paloma']);
    fireEvent.click(only());
    expect(rowsShown()).toEqual(['Gin Sour']);
    expect(screen.getByTestId(`cost-waits-${SOUR}`)).toHaveTextContent('1 of 2 ingredients priced');
    fireEvent.click(only());
    expect(rowsShown()).toEqual(['House G&T', 'Gin Sour', 'Bare', 'Paloma']);
  });

  it('is off for staff: no switch, whole list', async () => {
    h.role = 'staff';
    mount();
    await waitFor(() => expect(screen.getByText('Gin Sour')).toBeInTheDocument());
    expect(screen.queryByTestId('no-cost-yet')).toBeNull();
  });

  it('turns the no-recipe switch off when it is turned on, so the two never empty the list together', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('no-recipe-yet')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('no-recipe-yet').querySelector('input') as HTMLInputElement);
    expect(rowsShown()).toEqual(['Bare']);
    fireEvent.click(screen.getByTestId('no-cost-yet').querySelector('input') as HTMLInputElement);
    expect(rowsShown()).toEqual(['Gin Sour']);
    expect((screen.getByTestId('no-recipe-yet').querySelector('input') as HTMLInputElement).checked).toBe(false);
  });

  it('says nothing when every costed drink is complete', async () => {
    figures[1] = { ...figures[1], cost: cost({}) } as never;
    try {
      mount();
      await waitFor(() => expect(screen.getByTestId('no-recipe-yet')).toBeInTheDocument());
      expect(screen.queryByTestId('no-cost-yet')).toBeNull();
    } finally {
      figures[1] = { cocktailId: SOUR, price: 10, hasRecipe: true, yieldServes: 2, lineCount: 2, cost: cost({ complete: false, perServe: 0.8, perServeExact: 0.8, of: 2 }) } as never;
    }
  });
});
