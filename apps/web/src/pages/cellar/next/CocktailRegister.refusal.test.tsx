/** /cocktails: a refused write says the gateway's cause, not the axios text (r53 recipes, r52 F1). */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const CA = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  amend: vi.fn(),
  get: vi.fn(),
  retire: vi.fn(),
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'manager', user: { role: 'manager' } }),
}));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    data: {
      rows: [{ id: CA, name: 'Negroni', display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: 450 }],
      count: 1, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '',
    },
    loading: false,
    error: null,
  }),
  useCocktailWrites: () => ({
    create: { mutateAsync: h.create, isPending: false },
    amend: { mutateAsync: h.amend, isPending: false },
    retire: { mutateAsync: h.retire, isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';
import { reason } from './recipe/useRecipe';

// What axios throws for a 400: its own text on the Error, the gateway's body on response.data.
const refused = (message: unknown) =>
  Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { message } } });

beforeEach(() => {
  h.create.mockReset();
  h.amend.mockReset();
  h.retire.mockReset();
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
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

const said = () => screen.queryByTestId('cocktail-said');

async function addRefused() {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Paloma' } });
  fireEvent.click(screen.getByRole('button', { name: 'Put it on the list' }));
  await waitFor(() => expect(said()).not.toBeNull());
}

describe('reason()', () => {
  it('joins an array message the gateway validator sends', () => {
    expect(reason(refused(['name must be shorter than or equal to 200 characters', 'price must be a number']))).toBe(
      'name must be shorter than or equal to 200 characters; price must be a number',
    );
  });
  it('keeps a string message, and falls back to the error text only when the body has none', () => {
    expect(reason(refused('A cocktail needs a name.'))).toBe('A cocktail needs a name.');
    expect(reason(refused([]))).toBe('Request failed with status code 400');
    expect(reason(new Error('Network Error'))).toBe('Network Error');
  });
});

describe('a refused cocktail write says its cause', () => {
  it('an add refused with an array body prints the sentences, not the axios text', async () => {
    h.create.mockRejectedValue(refused(['name must be shorter than or equal to 200 characters']));
    await addRefused();
    expect(said()).toHaveTextContent(
      'Nothing was written — name must be shorter than or equal to 200 characters. The list is unchanged.',
    );
    expect(said()).not.toHaveTextContent('status code');
  });

  it('a take-off refused with an array body prints the sentences too', async () => {
    h.retire.mockRejectedValue(refused(['only an owner or a manager can change the list']));
    mount();
    fireEvent.click(within(screen.getByRole('table')).getByText('Negroni'));
    fireEvent.click(await screen.findByRole('button', { name: 'Take it off the list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take it off — confirm' }));
    await waitFor(() =>
      expect(said()).toHaveTextContent('“Negroni” was NOT retired — only an owner or a manager can change the list.'),
    );
  });

  it('a plain network failure still says its own text', async () => {
    h.create.mockRejectedValue(new Error('Network Error'));
    await addRefused();
    expect(said()).toHaveTextContent('Nothing was written — Network Error. The list is unchanged.');
  });
});
