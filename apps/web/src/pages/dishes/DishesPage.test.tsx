/** /dishes (ADR 0366): the list, the add form, the deep link and the failed read. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NEW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: h.put },
  getErrorStatus: (e: unknown) => (e as { response?: { status?: number } } | null)?.response?.status ?? null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import DishesPage from './DishesPage';

const full = { perServe: 300, perServeExact: 300, priced: 2, of: 2, complete: true, partial: 0 };
const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, section: 'Mains', price: 900, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: full, ...over,
});
let list: unknown[] = [];

function serve() {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) return { data: list };
    const m = url.match(/\/dishes\/([^/]+)$/);
    if (m) {
      const r = (list as Array<{ id: string; name: string }>).find((x) => x.id === m[1]);
      return { data: { dish: { id: m[1], name: r?.name ?? 'x', section: null, price: null, description: null }, current: null, cost: null, versionCount: 0, legacyLines: [] } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

function mount(at = '/dishes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <DishesPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(h).forEach((f) => typeof f === 'function' && f.mockReset());
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  list = [
    row(A, 'Lamb shank'),
    row(B, 'Mezze', { price: 500, cost: { ...full, perServe: null, priced: 1, complete: false } }),
    row(C, 'Soup', { hasRecipe: false, cost: null, lineCount: 0 }),
    row(D, 'Bread', { price: null }),
  ];
  serve();
});

describe('DishesPage', () => {
  it('a manager reads price, cost a plate and food cost %, only where they are known', async () => {
    mount();
    const a = await screen.findByTestId(`dish-row-${A}`);
    expect(a).toHaveTextContent('Lamb shank');
    expect(a).toHaveTextContent('₺900.00');
    expect(a).toHaveTextContent('₺300.00');
    expect(a).toHaveTextContent('33.3%');
    // An incomplete cost has no cost and no %, even with a price.
    expect(screen.getByTestId(`dish-row-${B}`).textContent).toMatch(/Not knownNot known/);
    expect(screen.getByTestId(`dish-row-${B}`).textContent).not.toMatch(/%/);
    // A complete cost with no price: a cost, no %.
    expect(screen.getByTestId(`dish-row-${D}`)).toHaveTextContent('No price');
    expect(screen.getByTestId(`dish-row-${D}`).textContent).not.toMatch(/%/);
    expect(screen.getByTestId(`dish-row-${C}`)).toHaveTextContent('No recipe yet');
  });

  it('staff read the list with no money, even if a figure reached them', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u2', role: 'staff' } };
    mount();
    const a = await screen.findByTestId(`dish-row-${A}`);
    expect(a).toHaveTextContent('Lamb shank');
    expect(a.textContent).not.toMatch(/₺|%|900|300/);
    expect(screen.queryByRole('columnheader', { name: 'Price' })).toBeNull();
    expect(screen.queryByTestId('dish-add')).toBeNull();
  });

  it('a failed read says why, offers Read again and never says No dishes yet.', async () => {
    h.get.mockImplementation(async (url: string) => {
      if (url === `/recipes/${RID}/dishes`) throw Object.assign(new Error('boom'), { response: { status: 500, data: { message: 'The gateway is down' } } });
      return { data: {} };
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('The gateway is down');
    expect(screen.queryByText('No dishes yet.')).toBeNull();
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    expect(await screen.findByTestId(`dish-row-${A}`)).toBeInTheDocument();
  });

  it('an empty house says No dishes yet. and an editor can add one', async () => {
    list = [];
    mount();
    expect(await screen.findByText('No dishes yet.')).toBeInTheDocument();
    expect(screen.getByTestId('dish-add')).toBeInTheDocument();
  });

  it('adds a dish with the form and opens its sheet', async () => {
    list = [];
    h.post.mockImplementation(async () => {
      list = [row(NEW, 'Pilaf', { hasRecipe: false, cost: null })];
      return { data: { id: NEW, name: 'Pilaf', section: 'Sides', price: 120, description: null } };
    });
    mount();
    await screen.findByText('No dishes yet.');
    const add = screen.getByRole('button', { name: 'Add dish' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Dish name'), { target: { value: '  Pilaf ' } });
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'Sides' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '120' } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith(`/recipes/${RID}/dishes`, { name: 'Pilaf', section: 'Sides', price: 120 }));
    const leaf = await screen.findByTestId(`dish-leaf-${NEW}`);
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${NEW}`));
    expect(within(leaf).getByTestId('recipe-sheet')).toBeInTheDocument();
  });

  it('shows the gateway sentence for a duplicate name', async () => {
    h.post.mockRejectedValue(Object.assign(new Error('Conflict'), { response: { status: 409, data: { message: 'A dish named Lamb shank is already on your list.' } } }));
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    fireEvent.change(screen.getByLabelText('Dish name'), { target: { value: 'Lamb shank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add dish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A dish named Lamb shank is already on your list.');
  });

  it('?open=<id> opens that dish, and only one dish is open at a time', async () => {
    mount(`/dishes?open=${B}`);
    expect(await screen.findByTestId(`dish-leaf-${B}`)).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${B}`);
    fireEvent.click(screen.getByTestId(`dish-row-${A}`));
    expect(await screen.findByTestId(`dish-leaf-${A}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`dish-leaf-${B}`)).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent(`?open=${A}`);
    fireEvent.click(screen.getByTestId(`dish-row-${A}`));
    await waitFor(() => expect(screen.queryByTestId(`dish-leaf-${A}`)).toBeNull());
    expect(screen.getByTestId('where').textContent).toBe('');
  });
});
