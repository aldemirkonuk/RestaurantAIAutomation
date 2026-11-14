/**
 * /dishes Allergens column and allergen check (r36 recipes audit, gap 8):
 * staff answer "which dishes have nuts" from the list, and a dish that does
 * not say is never hidden as free.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ALLERGEN_KEYS } from '../cellar/next/recipe/ListAllergens';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));

import DishesPage from './DishesPage';

const free = Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, 'free']));
const row = (id: string, name: string, allergens: unknown) => ({
  id, name, section: null, price: null, hasRecipe: allergens !== null, yieldServes: 1, lineCount: 2, cost: null, allergens,
});
const list = [
  row(A, 'Baklava', { readable: true, status: { ...free, tree_nuts: 'contains', gluten: 'contains' }, unstatedBy: [] }),
  row(B, 'Grilled fish', { readable: true, status: { ...free, fish: 'contains' }, unstatedBy: [] }),
  row(C, 'Lemon tart', { readable: true, status: Object.fromEntries(ALLERGEN_KEYS.map((k) => [k, 'not_stated'])), unstatedBy: ['Lemons'] }),
  row(D, 'Soup', null),
];

beforeEach(() => {
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) return { data: list };
    throw new Error(`unexpected GET ${url}`);
  });
  h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u1', role: 'staff' } };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dishes']}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/dishes allergens', () => {
  it('staff see an Allergens column, with no money columns', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Dish', 'Section', 'Allergens']);
    expect(screen.getByTestId(`allergens-${A}`)).toHaveTextContent('Contains gluten, tree nuts');
    expect(screen.getByTestId(`allergens-${B}`)).toHaveTextContent('Contains fish');
    expect(screen.getByTestId(`allergens-${C}`)).toHaveTextContent('Not known: Lemons says nothing');
    expect(screen.getByTestId(`allergens-${D}`)).toHaveTextContent('—');
  });

  it('checking tree nuts hides only the dish that states it free, and says so', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    fireEvent.change(screen.getByLabelText(/Check an allergen/), { target: { value: 'tree_nuts' } });
    expect(screen.getByTestId(`dish-row-${A}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`dish-row-${B}`)).toBeNull();
    // Does not say, and has no recipe: never hidden as free.
    expect(screen.getByTestId(`dish-row-${C}`)).toBeInTheDocument();
    expect(screen.getByTestId(`dish-row-${D}`)).toBeInTheDocument();
    expect(screen.getByTestId('allergen-check-said')).toHaveTextContent(
      'Showing the dishes that contain tree nuts, may contain it, or do not say. 1 dish says it is free of tree nuts and is hidden.',
    );
    fireEvent.change(screen.getByLabelText(/Check an allergen/), { target: { value: '' } });
    expect(screen.getByTestId(`dish-row-${B}`)).toBeInTheDocument();
    expect(screen.queryByTestId('allergen-check-said')).toBeNull();
  });

  it('counts every hidden dish', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    fireEvent.change(screen.getByLabelText(/Check an allergen/), { target: { value: 'sesame' } });
    expect(screen.getByTestId('allergen-check-said')).toHaveTextContent('2 dishes say they are free of sesame and are hidden.');
  });

  it('an unread row says so and is never hidden', async () => {
    list[1] = row(B, 'Grilled fish', { readable: false });
    mount();
    expect(await screen.findByTestId(`allergens-${B}`)).toHaveTextContent('Could not be read');
    fireEvent.change(screen.getByLabelText(/Check an allergen/), { target: { value: 'fish' } });
    expect(screen.getByTestId(`dish-row-${B}`)).toBeInTheDocument();
    list[1] = row(B, 'Grilled fish', { readable: true, status: { ...free, fish: 'contains' }, unstatedBy: [] });
  });
});
