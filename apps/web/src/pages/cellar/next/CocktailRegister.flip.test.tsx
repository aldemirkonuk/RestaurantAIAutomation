/**
 * r106 drinks-8: sorting the cocktail list slides the rows (FLIP, 180 ms, transform only).
 * Motion on: one animation per row that moved. Reduced motion: none at all, no fade either.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `22222222-2222-4222-8222-22222222222${n}`;
const h = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: RID, activeRole: 'manager', user: { role: 'manager' } }) }));
vi.mock('./recipe/useListTax', () => ({ useListTax: () => ({ basis: 'prices_exclude_tax' }) }));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div /> }));
const base = { display_name: null, menu_section: null, method: null, glass: null, garnish: null };
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    data: {
      rows: [
        { id: id(1), name: 'Bravo', price: 10, ...base },
        { id: id(2), name: 'Alpha', price: 10, ...base },
        { id: id(3), name: 'Charlie', price: 10, ...base },
      ],
      count: 3, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '',
    },
    loading: false,
    error: null,
  }),
  useCocktailManages: () => true,
  useCocktailWrites: () => ({ create: { mutateAsync: vi.fn(), isPending: false }, amend: { mutateAsync: vi.fn(), isPending: false }, retire: { mutateAsync: vi.fn(), isPending: false } }),
}));
import CocktailRegister from './CocktailRegister';

const cost = (n: number) => ({ perServe: n, perServeExact: n, priced: 1, of: 1, complete: true, partial: 0 });
const figures = [1, 2, 3].map((n) => ({ cocktailId: id(n), price: 10, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: cost(n === 1 ? 2 : n === 2 ? 4 : 3) }));

let reduced = false;
const animate = vi.fn();
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  reduced = false;
  animate.mockReset();
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  // A row sits 40 px below the one before it in the tbody: where the DOM puts it is where it is.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const row = this.closest('tr[data-row]');
    const at = row ? Array.from(row.parentElement!.children).indexOf(row) * 40 : 0;
    return { top: at, bottom: at + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: at, toJSON() {} } as DOMRect;
  };
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: null, readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/drinks/figures`) return { data: { drinks: figures } };
    throw new Error(`unexpected GET ${url}`);
  });
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/cocktails']}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(<CocktailRegister register={null} registerLoading={false} />, { wrapper: wrap });
  await waitFor(() => expect(screen.getByTestId(`drink-cost-${id(1)}`).textContent).not.toBe(''));
}

describe('sorting slides the rows', () => {
  it('motion on: each row that changed place plays one 180 ms translateY on the house curve, nothing else', async () => {
    await mount();
    animate.mockClear();
    fireEvent.click(screen.getByTestId('sort-cost'));
    // cost, worst first: Alpha (4), Charlie (3), Bravo (2); the list came as Bravo, Alpha, Charlie.
    expect(animate).toHaveBeenCalledTimes(3);
    const [frames, opts] = animate.mock.calls[0];
    expect(frames).toEqual([{ transform: expect.stringMatching(/^translateY\(-?\d+px\)$/) }, { transform: 'translateY(0)' }]);
    expect(opts).toMatchObject({ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  });

  it('reduced motion: no animation is made, not even a fade', async () => {
    reduced = true;
    await mount();
    animate.mockClear();
    fireEvent.click(screen.getByTestId('sort-cost'));
    expect(animate).not.toHaveBeenCalled();
  });

  it('pressing again, and again back to the list\'s own order, slides the rows each time', async () => {
    await mount();
    for (let press = 1; press <= 3; press++) {
      animate.mockClear();
      fireEvent.click(screen.getByTestId('sort-cost'));
      expect(animate.mock.calls.length).toBeGreaterThan(0);
    }
  });
});

describe('a filter or the search slides the rows that stay (r108 DD-r108-33)', () => {
  const search = () => screen.getByPlaceholderText(/Search cocktail/i);
  const movedRows = () => animate.mock.instances.map((el) => (el as HTMLElement).dataset.row);

  it('motion on: rows that stay slide, a row that left is gone, a row that enters appears in place', async () => {
    await mount();
    animate.mockClear();
    fireEvent.change(search(), { target: { value: 'a' } }); // Bravo has no 'a'? it has: Bravo, Alpha, Charlie all contain 'a'
    animate.mockClear();
    fireEvent.change(search(), { target: { value: 'alp' } }); // only Alpha stays; it was second (80 px), now first (0)
    expect(movedRows()).toEqual([id(2)]);
    const [frames, opts] = animate.mock.calls[0];
    expect(frames).toEqual([{ transform: 'translateY(40px)' }, { transform: 'translateY(0)' }]);
    expect(opts).toMatchObject({ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    expect(screen.queryByTestId(`drink-cost-${id(1)}`)).toBeNull();
    animate.mockClear();
    fireEvent.change(search(), { target: { value: '' } }); // Bravo and Charlie enter; Alpha moves back down one row
    expect(movedRows()).toEqual([id(2)]);
  });

  it('reduced motion: a filter makes no animation at all, not even a fade', async () => {
    reduced = true;
    await mount();
    animate.mockClear();
    fireEvent.change(search(), { target: { value: 'alp' } });
    expect(screen.queryByTestId(`drink-cost-${id(1)}`)).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });
});
