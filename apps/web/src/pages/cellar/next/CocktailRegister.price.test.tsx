/**
 * The cocktail price box (r28 recipes audit, gap 12). It was a number field:
 * "12,50" read as empty in a browser that writes a point, so the drink saved
 * unpriced and nothing was said; and a cleared price on an amend sent nothing,
 * so the old price stayed while the page said "amended". It now reads like the
 * dish price box (#1250): text, a comma or a point, a bad price said and never
 * saved, and null sent to take a price off.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PRICE_UNREAD } from './recipe/price-text';

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

describe('the cocktail price box', () => {
  it('is a text box that offers a decimal keypad, not a number field', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    const box = screen.getByLabelText('Price') as HTMLInputElement;
    expect(box.type).toBe('text');
    expect(box.inputMode).toBe('decimal');
  });

  it('reads "12,50" as 12.5 on a new drink', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    typeIn('Name', 'Paloma');
    typeIn('Price', '12,50');
    fireEvent.click(screen.getByRole('button', { name: 'Put it on the list' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).toEqual({ name: 'Paloma', price: 12.5 });
  });

  it('sends no price for a blank box on a new drink, never 0, and never the typed text', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    typeIn('Name', 'Paloma');
    fireEvent.click(screen.getByRole('button', { name: 'Put it on the list' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).toEqual({ name: 'Paloma' });
  });

  it('says a price it cannot read and does not save it', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a cocktail' }));
    typeIn('Name', 'Paloma');
    typeIn('Price', '1.250');
    expect(screen.getByText(PRICE_UNREAD)).toBeInTheDocument();
    expect(screen.getByLabelText('Price')).toHaveAttribute('aria-invalid', 'true');
    const put = screen.getByRole('button', { name: 'Put it on the list' });
    expect(put).toBeDisabled();
    fireEvent.click(put);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('an amend that clears the price takes it off (null), and shows the old price in the box first', async () => {
    mount();
    fireEvent.click(within(screen.getByRole('table')).getByText('Negroni'));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend' }));
    expect(screen.getByLabelText('Price')).toHaveValue('450');
    typeIn('Price', '');
    fireEvent.click(screen.getByRole('button', { name: 'Record the amendment' }));
    await waitFor(() => expect(h.amend).toHaveBeenCalledTimes(1));
    expect(h.amend.mock.calls[0][0]).toMatchObject({ id: CA, input: { name: 'Negroni', price: null } });
    expect(h.amend.mock.calls[0][0].input).not.toHaveProperty('priceText');
  });

  it('an amend reads a comma price', async () => {
    mount();
    fireEvent.click(within(screen.getByRole('table')).getByText('Negroni'));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend' }));
    typeIn('Price', '475,5');
    fireEvent.click(screen.getByRole('button', { name: 'Record the amendment' }));
    await waitFor(() => expect(h.amend).toHaveBeenCalledTimes(1));
    expect(h.amend.mock.calls[0][0].input.price).toBe(475.5);
  });
});
