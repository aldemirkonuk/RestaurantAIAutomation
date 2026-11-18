/** /cocktails: a drink just put on the list is not hidden by a search typed earlier. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const CA = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  amend: vi.fn(),
  get: vi.fn(),
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
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({});
  h.amend.mockReset().mockResolvedValue({});
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

const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const said = () => screen.queryByTestId('cocktail-said');

const searchBox = () => screen.getByPlaceholderText('Search cocktail, section, method…');

describe('a drink just put on the list', () => {
  it('clears a search typed earlier, so the list is not left without it', async () => {
    mount();
    fireEvent.change(searchBox(), { target: { value: 'Negr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    typeIn('Name', 'Paloma');
    fireEvent.click(screen.getByRole('button', { name: 'Put it on the list' }));
    await waitFor(() => expect(said()).toHaveTextContent('“Paloma” is on this house’s list.'));
    expect(searchBox()).toHaveValue('');
  });

  it('leaves a refused add with the search as it was', async () => {
    h.create.mockRejectedValue(new Error('A cocktail named Paloma is already on your list.'));
    mount();
    fireEvent.change(searchBox(), { target: { value: 'Negr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    typeIn('Name', 'Paloma');
    fireEvent.click(screen.getByRole('button', { name: 'Put it on the list' }));
    await waitFor(() => expect(said()).toHaveTextContent('Nothing was written'));
    expect(searchBox()).toHaveValue('Negr');
  });
});
