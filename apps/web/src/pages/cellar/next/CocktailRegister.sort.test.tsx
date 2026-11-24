/**
 * The cocktail list answers the whole list (r104 drinks need 3): sortable cost
 * columns that put an unknown figure last, a one-line strip, and an export of
 * what is shown without the cost columns for staff.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const FIGURES = `/recipes/${RID}/drinks/figures`;
const id = (n: number) => `22222222-2222-4222-8222-22222222222${n}`;
const cost = (o: Record<string, unknown>) => ({ perServe: 1.5, perServeExact: 1.5, priced: 1, of: 1, complete: true, partial: 0, ...o });

const h = vi.hoisted(() => ({ get: vi.fn(), role: 'manager', loading: false, exported: vi.fn() }));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { role: h.role } }),
}));
vi.mock('./recipe/useListTax', () => ({ useListTax: () => ({ basis: 'prices_exclude_tax' }) }));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));
vi.mock('../../../lib/tableExport', () => ({ exportTable: (o: unknown) => h.exported(o) }));
const base = { display_name: null, menu_section: null, method: null, glass: null, garnish: null };
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    data: h.loading ? null : {
      rows: [
        { id: id(1), name: 'Bravo', price: 10, ...base },   // 2.00 / 10 = 20 %
        { id: id(2), name: 'Alpha', price: 10, ...base },   // 4.00 / 10 = 40 %
        { id: id(3), name: 'Charlie', price: 10, ...base }, // incomplete cost
        { id: id(4), name: 'Delta', price: 10, ...base },   // no recipe
        { id: id(5), name: 'Echo', price: 10, ...base },    // 2.00 / 10 = 20 %, ties Bravo
      ],
      count: 5, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '',
    },
    loading: h.loading,
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
  { cocktailId: id(1), price: 10, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: cost({ perServe: 2, perServeExact: 2 }) },
  { cocktailId: id(2), price: 10, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: cost({ perServe: 4, perServeExact: 4 }) },
  { cocktailId: id(3), price: 10, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: cost({ complete: false, perServe: 0.5, perServeExact: 0.5, of: 2 }) },
  { cocktailId: id(4), price: 10, hasRecipe: false, yieldServes: null, lineCount: 0, cost: null },
  { cocktailId: id(5), price: 10, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: cost({ perServe: 2, perServeExact: 2 }) },
];

beforeEach(() => {
  h.role = 'manager';
  h.loading = false;
  h.exported.mockReset();
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: null, readable: true, reason: null, statedAt: null } };
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
  return render(<CocktailRegister register={null} registerLoading={false} />, { wrapper: wrap });
}

const order = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent);
const ready = () => waitFor(() => expect(screen.getByTestId(`drink-share-${id(1)}`).textContent).toBe('20.0%'));

describe('sorting the cocktail list', () => {
  it('pour cost sorts worst first, then reversed, and an unknown figure is last both ways, ties by name', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByTestId('sort-share'));
    expect(order()).toEqual(['Alpha', 'Bravo', 'Echo', 'Charlie', 'Delta']);
    expect(screen.getByRole('columnheader', { name: /Pour cost/ })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByTestId('sort-share'));
    expect(order()).toEqual(['Bravo', 'Echo', 'Alpha', 'Charlie', 'Delta']);
    expect(screen.getByRole('columnheader', { name: /Pour cost/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByTestId('sort-share'));
    expect(screen.getByRole('columnheader', { name: /Pour cost/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('margin starts with the smallest, and an incomplete cost is never a zero margin', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByTestId('sort-margin'));
    expect(order()).toEqual(['Alpha', 'Bravo', 'Echo', 'Charlie', 'Delta']);
    expect(screen.getByTestId(`drink-margin-${id(3)}`).textContent).toBe('Not known');
  });
});

describe('the figures strip', () => {
  it('says the average over priced drinks, how many are not priced and how many have no recipe', async () => {
    mount();
    await ready();
    // (20 + 40 + 20) / 3 = 26.7 over three priced drinks
    expect(screen.getByTestId('cocktails-strip').textContent).toContain('Average pour cost 26.7% over 3 priced drinks · 1 not priced · 1 with no recipe');
  });

  it('holds the same room, by the same class, while the list is read', () => {
    h.loading = true;
    const { unmount } = mount();
    const room = screen.getByTestId('cocktails-strip-room');
    expect(room).toHaveClass('cl-strip');
    unmount();
    h.loading = false;
    mount();
    return waitFor(() => expect(screen.getByTestId('cocktails-strip')).toHaveClass('cl-strip'));
  });
});

describe('exporting the list', () => {
  it('hands the shown order and an empty cell, never 0, for an unknown figure', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByTestId('sort-share'));
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByText('CSV'));
    await waitFor(() => expect(h.exported).toHaveBeenCalled());
    const o = h.exported.mock.calls[0][0] as { rows: { name: string; numbers: Record<string, number | null> }[]; columns: { header: string; value: (r: unknown) => unknown }[] };
    expect(o.rows.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Echo', 'Charlie', 'Delta']);
    expect(o.columns.map((c) => c.header)).toEqual(['Cocktail', 'Section', 'Method', 'Glass', 'Garnish', 'Price', 'Cost per serve', 'Pour cost %', 'Margin']);
    const cell = (name: string, header: string) => o.columns.find((c) => c.header === header)!.value(o.rows.find((r) => r.name === name));
    expect(cell('Charlie', 'Cost per serve')).toBeNull();
    expect(cell('Delta', 'Pour cost %')).toBeNull();
    expect(cell('Alpha', 'Pour cost %')).toBe(40);
  });

  it('staff get no cost columns on the page or in the export', async () => {
    h.role = 'staff';
    mount();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.queryByTestId('sort-share')).toBeNull();
    expect(screen.queryByTestId('sort-cost')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Margin/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByText('CSV'));
    await waitFor(() => expect(h.exported).toHaveBeenCalled());
    const o = h.exported.mock.calls[0][0] as { columns: { header: string }[] };
    expect(o.columns.map((c) => c.header)).toEqual(['Cocktail', 'Section', 'Method', 'Glass', 'Garnish', 'Price']);
  });
});
