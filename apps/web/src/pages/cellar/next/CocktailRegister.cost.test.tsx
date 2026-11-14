/**
 * The cost and pour cost columns of /cocktails (r28 recipes audit, gap 9).
 * The list showed a drink's price and never what a serve costs, so a manager
 * could not scan it for a drink that loses money. Each row now carries the
 * cost a serve and the pour cost, from one read of the house's drink figures,
 * in the house's money and the house's way of writing a share.
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

import CocktailRegister, { DRINK_ALLERGENS_UNREAD } from './CocktailRegister';

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

const text = (id: string) => screen.getByTestId(id).textContent;

describe('the cocktail list cost columns', () => {
  it('heads the columns "Cost per serve" and "Pour cost"', () => {
    mount();
    expect(screen.getByRole('columnheader', { name: 'Cost per serve' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Pour cost' })).toBeInTheDocument();
  });

  it('gives a drink its cost a serve in the house money and its pour cost in the house form', async () => {
    mount();
    await waitFor(() => expect(text(`drink-cost-${GT}`)).toBe(fmtMoney(1.5, 'TRY')));
    // 1.50 over 12 is 12.5 %, written the lira way.
    await waitFor(() => expect(text(`drink-share-${GT}`)).toBe('%12,5'));
  });

  it('writes the share the pound way in a pound house', async () => {
    h.currency = 'GBP';
    mount();
    await waitFor(() => expect(text(`drink-share-${GT}`)).toBe('12.5%'));
  });

  it('an incomplete cost is "Not known", never a smaller figure, and makes no pour cost', async () => {
    mount();
    await waitFor(() => expect(text(`drink-cost-${SOUR}`)).toBe('Not known1 of 2 ingredients priced'));
    expect(text(`drink-share-${SOUR}`)).toBe('Not known');
  });

  it('a drink with no recipe shows no cost and no pour cost', async () => {
    mount();
    await waitFor(() => expect(text(`drink-cost-${GT}`)).not.toBe('—'));
    expect(text(`drink-cost-${BARE}`)).toBe('—');
    expect(text(`drink-share-${BARE}`)).toBe('—');
  });

  it('a cost priced from part of the stock says it is partly invoiced; an unpriced drink has no pour cost', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId(`drink-partly-${PART}`)).toHaveTextContent('partly invoiced'));
    expect(text(`drink-cost-${PART}`)).toBe(`${fmtMoney(2, 'TRY')}partly invoiced`);
    expect(text(`drink-share-${PART}`)).toBe('Not known');
    expect(screen.queryByTestId(`drink-partly-${GT}`)).toBeNull();
  });

  it('figures that cannot be read are said once, and no cell shows a cost', async () => {
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
      throw new Error('boom');
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('cocktails-costs-unread')).toBeInTheDocument());
    expect(text(`drink-cost-${GT}`)).toBe('—');
    expect(text(`drink-share-${GT}`)).toBe('—');
  });

  it('a re-read that fails blanks the costs it read before, beside the sentence', async () => {
    const { qc } = mount();
    await waitFor(() => expect(text(`drink-cost-${GT}`)).not.toBe('—'));
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
      throw new Error('boom');
    });
    await qc.refetchQueries();
    await waitFor(() => expect(screen.getByTestId('cocktails-costs-unread')).toBeInTheDocument());
    expect(text(`drink-cost-${GT}`)).toBe('—');
    expect(text(`drink-share-${GT}`)).toBe('—');
  });

  it('staff see neither column; the figures are read only for their allergens', async () => {
    h.role = 'staff';
    mount();
    expect(screen.queryByRole('columnheader', { name: 'Cost per serve' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Pour cost' })).toBeNull();
    expect(screen.queryByTestId(`drink-cost-${GT}`)).toBeNull();
    // The gateway sends staff no price and no cost; the read carries the allergens (gap 8).
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(FIGURES));
    expect(screen.queryByTestId(`drink-share-${GT}`)).toBeNull();
  });
});

/** r36 recipes audit, gap 8: the drinks' allergens, for every role. */
describe('the cocktail list allergens', () => {
  const free = { gluten: 'free', crustaceans: 'free', eggs: 'free', fish: 'free', peanuts: 'free', soy: 'free', milk: 'free', tree_nuts: 'free', celery: 'free', mustard: 'free', sesame: 'free', sulphites: 'free', lupin: 'free', molluscs: 'free' };
  const withAllergens = [
    { ...figures[0], price: null, cost: null, allergens: { readable: true, status: free, unstatedBy: [] } },
    { ...figures[1], price: null, cost: null, allergens: { readable: true, status: { ...free, eggs: 'contains' }, unstatedBy: [] } },
    { ...figures[2], price: null, cost: null, allergens: null },
    { ...figures[3], price: null, cost: null, allergens: { readable: true, status: { ...free, eggs: 'not_stated' }, unstatedBy: ['Grapefruit soda'] } },
  ];
  const serveWith = (rows: unknown) =>
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
      if (url === FIGURES) return { data: { drinks: rows } };
      throw new Error(`unexpected GET ${url}`);
    });

  it('staff see each drink’s allergens', async () => {
    h.role = 'staff';
    serveWith(withAllergens);
    mount();
    expect(screen.getByRole('columnheader', { name: 'Allergens' })).toBeInTheDocument();
    await waitFor(() => expect(text(`allergens-${SOUR}`)).toBe('Contains eggs'));
    expect(text(`allergens-${GT}`)).toBe('Free of all 14');
    expect(text(`allergens-${BARE}`)).toBe('—');
    expect(text(`allergens-${PART}`)).toBe('Not known: Grapefruit soda says nothing');
  });

  it('checking eggs hides only the drink that states it free', async () => {
    h.role = 'staff';
    serveWith(withAllergens);
    mount();
    await waitFor(() => expect(text(`allergens-${SOUR}`)).toBe('Contains eggs'));
    fireEvent.change(screen.getByLabelText(/Check an allergen/), { target: { value: 'eggs' } });
    expect(screen.queryByTestId(`allergens-${GT}`)).toBeNull();
    expect(screen.getByTestId(`allergens-${SOUR}`)).toBeInTheDocument();
    expect(screen.getByTestId(`allergens-${BARE}`)).toBeInTheDocument();
    expect(screen.getByTestId(`allergens-${PART}`)).toBeInTheDocument();
    expect(screen.getByTestId('allergen-check-said')).toHaveTextContent('1 drink says it is free of eggs and is hidden.');
  });

  it('a failed read is said to staff, and no row is hidden as free', async () => {
    h.role = 'staff';
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
      throw new Error('boom');
    });
    mount();
    expect(await screen.findByTestId('cocktails-allergens-unread')).toHaveTextContent(DRINK_ALLERGENS_UNREAD);
    fireEvent.change(screen.getByLabelText(/Check an allergen/), { target: { value: 'eggs' } });
    expect(screen.getByTestId(`allergens-${GT}`)).toBeInTheDocument();
  });
});

describe('the cocktail list: drinks with no recipe yet (r40)', () => {
  it('a manager is told how many drinks have no recipe, and can show only those', async () => {
    mount();
    expect(await screen.findByTestId('no-recipe-yet')).toHaveTextContent('1 of 4 drinks has no recipe yet, so what it costs is not known.');
    fireEvent.click(screen.getByLabelText(/Show only that one/));
    expect(screen.getByTestId(`drink-cost-${BARE}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`drink-cost-${GT}`)).toBeNull();
  });

  it('staff are not told', async () => {
    h.role = 'staff';
    const { qc } = mount();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(FIGURES));
    // Once the figures are in, a drink with no recipe is known; staff are still not told.
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(qc.getQueryCache().findAll().some((q) => JSON.stringify(q.state.data ?? '').includes('cocktailId'))).toBe(true);
    expect(screen.queryByTestId('no-recipe-yet')).toBeNull();
  });
});
