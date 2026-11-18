/** /cocktails: the Section box offers the sections already in use (r53 recipes). */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const CA = '22222222-2222-4222-8222-222222222222';
const CB = '33333333-3333-4333-8333-333333333333';
const CC = '44444444-4444-4444-8444-444444444444';
const CD = '55555555-5555-4555-8555-555555555555';

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
      rows: [
        { id: CA, name: 'Negroni', display_name: null, menu_section: 'Aperitivo', method: null, glass: null, garnish: null, price: 450 },
        { id: CB, name: 'Spritz', display_name: null, menu_section: 'aperitivo ', method: null, glass: null, garnish: null, price: 400 },
        { id: CC, name: 'Daiquiri', display_name: null, menu_section: 'Sours', method: null, glass: null, garnish: null, price: 420 },
        { id: CD, name: 'Water', display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: null },
      ],
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

const offered = () => {
  const input = screen.getByLabelText('Section');
  const id = input.getAttribute('list');
  if (!id) return null;
  const list = document.getElementById(id);
  return list ? [...list.querySelectorAll('option')].map((o) => o.getAttribute('value')) : [];
};

describe('the Section box on /cocktails', () => {
  it('offers the sections already in use, each once, however it was spelt', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    expect(offered()).toEqual(['Aperitivo', 'Sours']);
  });

  it('offers the same sections when a row is opened to be amended', async () => {
    mount();
    fireEvent.click(within(screen.getByRole('table')).getByText('Negroni'));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend' }));
    expect(offered()).toEqual(['Aperitivo', 'Sours']);
  });

  it('is still a free box: a section nobody has used is saved as typed', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Paloma' } });
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'Long' } });
    fireEvent.click(screen.getByRole('button', { name: 'Put it on the list' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0]?.[0]).toMatchObject({ name: 'Paloma', menuSection: 'Long' });
  });
});
