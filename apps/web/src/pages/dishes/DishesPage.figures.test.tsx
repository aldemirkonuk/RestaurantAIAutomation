/**
 * r41 recipes audit, gaps 2 and 3: /dishes showed no dish name until every
 * line of every dish was priced, and one failed pricing read took away the
 * names and the allergens with the costs. The names and the figures are now
 * two reads, as on /cocktails: the list shows on the names, its cost cells
 * say "…" while the figures are read, and a failed figures read blanks only
 * the figures and says so once.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fmtMoney } from '../receipts/next/rc2-format';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NAMES = `/recipes/${RID}/dishes`;
const FIGURES = `/recipes/${RID}/dishes/figures`;

const h = vi.hoisted(() => ({ get: vi.fn(), role: 'owner' }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { role: h.role } }),
}));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));

import DishesPage, { DISH_ALLERGENS_UNREAD, DISH_COSTS_UNREAD } from './DishesPage';

const names = [
  { id: A, name: 'Lamb shank', section: 'Mains', price: 900 },
  { id: B, name: 'Soup', section: null, price: 300 },
];
const full = { perServe: 300, perServeExact: 300, priced: 2, of: 2, complete: true, partial: 0 };
const gluten = { readable: true, status: { gluten: 'contains' }, unstatedBy: [] };
const figuresOf = (o: { costsUnread?: boolean; cost?: unknown } = {}) => ({
  costsUnread: o.costsUnread ?? false,
  dishes: [
    { dishId: A, price: 900, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: 'cost' in o ? o.cost : full, allergens: gluten },
    { dishId: B, price: 300, hasRecipe: false, yieldServes: null, lineCount: 0, cost: null, allergens: null },
  ],
});

/** What each URL answers; a function is called per request. */
let answer: Record<string, () => Promise<unknown>> = {};

beforeEach(() => {
  h.role = 'owner';
  answer = {
    '/settings/currency': async () => ({ data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } }),
    [NAMES]: async () => ({ data: names }),
    [FIGURES]: async () => ({ data: figuresOf() }),
  };
  h.get.mockReset().mockImplementation((url: string) => (answer[url] ? answer[url]() : Promise.reject(new Error(`not read here: ${url}`))));
});

function mount(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dishes']}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = (id: string) => screen.getByTestId(`dish-row-${id}`);

describe('/dishes reads its names and its figures apart', () => {
  it('shows every name while the figures are still being read, the cost cells saying "…"', async () => {
    answer[FIGURES] = () => new Promise(() => {});
    mount();
    await waitFor(() => expect(row(A)).toHaveTextContent('Lamb shank'));
    expect(row(B)).toHaveTextContent('Soup');
    expect(screen.getByTestId(`dish-cost-reading-${A}`).textContent).toBe('…');
    // Unknown is not "no recipe": nothing says so before the figures answer.
    expect(screen.queryByText('No recipe yet')).toBeNull();
    expect(screen.queryByTestId('no-recipe-yet')).toBeNull();
  });

  it('asks for the names and the figures once each', async () => {
    mount();
    await waitFor(() => expect(row(A)).toHaveTextContent(fmtMoney(300, 'TRY')));
    const asked = h.get.mock.calls.map(([u]) => u);
    expect(asked.filter((u) => u === NAMES)).toHaveLength(1);
    expect(asked.filter((u) => u === FIGURES)).toHaveLength(1);
  });

  it('joins the figures to the names: cost, no recipe, allergens', async () => {
    mount();
    await waitFor(() => expect(row(A)).toHaveTextContent(fmtMoney(300, 'TRY')));
    expect(row(B)).toHaveTextContent('No recipe yet');
    expect(screen.getByTestId(`allergens-${A}`)).toHaveTextContent('Contains');
    expect(screen.getByTestId('no-recipe-yet')).toHaveTextContent('1 of 2 dishes has no recipe yet');
  });

  it('the food cost is of the price before tax once the house says its basis; unset it is warned, with the sentence under it (r103 need 2)', async () => {
    answer['/settings/tax-basis'] = async () => ({ data: { basis: 'prices_exclude_tax', readable: true } });
    const { unmount } = mount();
    await waitFor(() => expect(row(A)).toHaveTextContent('%33,3'));
    expect(row(A)).not.toHaveTextContent('whether that price includes tax');
    expect(row(A).querySelector('[title="of the price before tax"]')).not.toBeNull();
    unmount();
    answer['/settings/tax-basis'] = async () => ({ data: { basis: 'unset', readable: true } });
    mount();
    await waitFor(() => expect(row(A)).toHaveTextContent('whether that price includes tax is not recorded'));
    expect(row(A).querySelector('[data-warn="true"]')).toHaveTextContent('%33,3');
  });

  it('a figures read that fails whole keeps the names, blanks the figures and says so once', async () => {
    answer[FIGURES] = () => Promise.reject(new Error('down'));
    mount();
    await waitFor(() => expect(screen.getByTestId('dishes-costs-unread')).toHaveTextContent(DISH_COSTS_UNREAD));
    expect(screen.getByTestId('dishes-allergens-unread')).toHaveTextContent(DISH_ALLERGENS_UNREAD);
    expect(row(A)).toHaveTextContent('Lamb shank');
    expect(row(A)).toHaveTextContent(fmtMoney(900, 'TRY'));
    expect(screen.queryByTestId('dishes-unread')).toBeNull();
    expect(screen.queryByTestId(`dish-cost-reading-${A}`)).toBeNull();
    expect(screen.queryByText('No recipe yet')).toBeNull();
  });

  it('costs left unread by the pricing keep the recipes and the allergens', async () => {
    answer[FIGURES] = async () => ({ data: figuresOf({ costsUnread: true, cost: null }) });
    mount();
    await waitFor(() => expect(screen.getByTestId('dishes-costs-unread')).toBeInTheDocument());
    expect(screen.queryByTestId('dishes-allergens-unread')).toBeNull();
    expect(screen.getByTestId(`allergens-${A}`)).toHaveTextContent('Contains');
    expect(row(B)).toHaveTextContent('No recipe yet');
    // A blank cost, never "Not known" over figures nobody read.
    expect(row(A)).not.toHaveTextContent('Not known');
  });

  it('staff are told of unread allergens, never of costs they do not see', async () => {
    h.role = 'staff';
    answer[FIGURES] = () => Promise.reject(new Error('down'));
    mount();
    await waitFor(() => expect(screen.getByTestId('dishes-allergens-unread')).toBeInTheDocument());
    expect(screen.queryByTestId('dishes-costs-unread')).toBeNull();
    expect(row(A)).toHaveTextContent('Lamb shank');
  });

  it('a figures re-read that fails does not keep showing the last costs', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mount(qc);
    await waitFor(() => expect(row(A)).toHaveTextContent(fmtMoney(300, 'TRY')));
    answer[FIGURES] = () => Promise.reject(new Error('down'));
    await qc.invalidateQueries({ queryKey: ['recipes', RID, 'dishes', 'figures'] });
    await waitFor(() => expect(screen.getByTestId('dishes-costs-unread')).toBeInTheDocument());
    expect(row(A)).not.toHaveTextContent(fmtMoney(300, 'TRY'));
    expect(screen.getByTestId(`allergens-${A}`)).not.toHaveTextContent('Contains');
  });

  it('coming back to the page within a minute reads neither the names nor the figures again', async () => {
    // App.tsx's defaults, whose refetchOnMount 'always' ignored every staleTime (gap 5).
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnMount: 'always', retry: false } } });
    const first = mount(qc);
    await waitFor(() => expect(row(A)).toHaveTextContent(fmtMoney(300, 'TRY')));
    first.unmount();
    mount(qc);
    await waitFor(() => expect(row(A)).toHaveTextContent(fmtMoney(300, 'TRY')));
    await new Promise((r) => setTimeout(r, 20));
    const asked = h.get.mock.calls.map(([u]) => u);
    expect([asked.filter((u) => u === NAMES).length, asked.filter((u) => u === FIGURES).length]).toEqual([1, 1]);
  });

  it('a failed names read is still the page-wide "could not be read"', async () => {
    answer[NAMES] = () => Promise.reject(new Error('down'));
    mount();
    await waitFor(() => expect(screen.getByTestId('dishes-unread')).toBeInTheDocument());
  });
});
