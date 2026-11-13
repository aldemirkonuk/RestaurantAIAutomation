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

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: h.put, patch: h.patch, delete: h.del },
  getErrorStatus: (e: unknown) => (e as { response?: { status?: number } } | null)?.response?.status ?? null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import DishesPage from './DishesPage';
import { PRICE_UNREAD, readPrice } from '../cellar/next/recipe/price-text';

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
    // The share in the house's form, as the drawer writes it: a lira house reads "%33,3".
    expect(a).toHaveTextContent('%33,3');
    expect(a.textContent).not.toContain('33.3%');
    expect(screen.getByRole('columnheader', { name: 'Cost per plate' })).toBeInTheDocument();
    // An incomplete cost has no cost and no %, even with a price.
    expect(screen.getByTestId(`dish-row-${B}`).textContent).toMatch(/Not knownNot known/);
    expect(screen.getByTestId(`dish-row-${B}`).textContent).not.toMatch(/%/);
    // A complete cost with no price: a cost, no %.
    expect(screen.getByTestId(`dish-row-${D}`)).toHaveTextContent('No price');
    expect(screen.getByTestId(`dish-row-${D}`).textContent).not.toMatch(/%/);
    expect(screen.getByTestId(`dish-row-${C}`)).toHaveTextContent('No recipe yet');
  });

  it('a cost priced partly from stock without a verified invoice says so; a whole one does not (r28 gap 13)', async () => {
    list = [row(A, 'Lamb shank', { cost: { ...full, partial: 1 } }), row(B, 'Mezze')];
    mount();
    const a = await screen.findByTestId(`dish-row-${A}`);
    expect(a).toHaveTextContent('₺300.00');
    expect(within(a).getByTestId(`dish-partly-${A}`)).toHaveTextContent('partly invoiced');
    expect(within(screen.getByTestId(`dish-row-${B}`)).queryByTestId(`dish-partly-${B}`)).toBeNull();
  });

  it('an unknown cost is never marked partly invoiced', async () => {
    list = [row(A, 'Lamb shank', { cost: { ...full, perServe: null, complete: false, partial: 1 } })];
    mount();
    const a = await screen.findByTestId(`dish-row-${A}`);
    expect(a.textContent).toMatch(/Not known/);
    expect(within(a).queryByTestId(`dish-partly-${A}`)).toBeNull();
  });

  it('a pound house writes the share its own way: "33.3%"', async () => {
    const lira = h.get.getMockImplementation();
    h.get.mockImplementation(async (url: string) =>
      url === '/settings/currency'
        ? { data: { restaurantId: RID, code: 'GBP', country: 'United Kingdom', readable: true, reason: null, statedAt: null } }
        : (lira as (u: string) => unknown)(url),
    );
    mount();
    const a = await screen.findByTestId(`dish-row-${A}`);
    await waitFor(() => expect(a).toHaveTextContent('33.3%'));
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

  it('names every field of the add form by for/id, and the form itself', async () => {
    list = [];
    mount();
    await screen.findByText('No dishes yet.');
    const form = screen.getByRole('form', { name: 'Add a dish' });
    const fields = within(form).getAllByRole('textbox');
    expect(fields).toHaveLength(3);
    for (const f of fields) {
      expect(f.id).not.toBe('');
      expect(form.querySelector(`label[for="${f.id}"]`)).not.toBeNull();
    }
    expect(screen.getByRole('textbox', { name: 'Dish name' })).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('textbox', { name: 'Section' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveAttribute('inputmode', 'decimal');
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

  it('a price typed with a comma is saved as that price, never dropped', async () => {
    list = [];
    h.post.mockResolvedValue({ data: { id: NEW, name: 'Pilaf', section: null, price: 12.5, description: null } });
    mount();
    await screen.findByText('No dishes yet.');
    fireEvent.change(screen.getByLabelText('Dish name'), { target: { value: 'Pilaf' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '12,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add dish' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith(`/recipes/${RID}/dishes`, { name: 'Pilaf', price: 12.5 }));
  });

  it('a price it cannot read is said and blocks the add', async () => {
    list = [];
    mount();
    await screen.findByText('No dishes yet.');
    fireEvent.change(screen.getByLabelText('Dish name'), { target: { value: 'Pilaf' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '1.250' } });
    expect(screen.getByRole('button', { name: 'Add dish' })).toBeDisabled();
    expect(screen.getByText(PRICE_UNREAD)).toBeInTheDocument();
    expect(screen.getByLabelText('Price')).toHaveAttribute('aria-invalid', 'true');
  });

  it('an editor changes an open dish, sending only what changed', async () => {
    h.patch.mockResolvedValue({ data: { id: A, name: 'Lamb shank', section: 'Mains', price: 950.5, description: null } });
    mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    const save = within(panel).getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: '950,50' } });
    fireEvent.click(save);
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${A}`, { price: 950.5 }));
    expect(await within(panel).findByRole('status')).toHaveTextContent('Saved.');
  });

  it('a blank price clears it, and says so before the save', async () => {
    h.patch.mockResolvedValue({ data: { id: A, name: 'Lamb shank', section: 'Mains', price: null, description: null } });
    mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: ' ' } });
    expect(within(panel).getByText('A blank price saves the dish with no price.')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${A}`, { price: null }));
  });

  it('takes a dish off the list only after asking, then closes it', async () => {
    h.del.mockImplementation(async () => {
      list = list.filter((d) => (d as { id: string }).id !== A);
      return { data: { id: A, name: 'Lamb shank', removed: true } };
    });
    mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.click(within(panel).getByRole('button', { name: 'Take off the list' }));
    expect(h.del).not.toHaveBeenCalled();
    expect(within(panel).getByText('Take Lamb shank off your list? Its recipe history is kept.')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Yes, take it off' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${A}`));
    await waitFor(() => expect(screen.queryByTestId(`dish-row-${A}`)).toBeNull());
    expect(screen.getByTestId('where').textContent).toBe('');
  });

  it('a failed removal says the dish is still on the list', async () => {
    h.del.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 500, data: { message: 'The dish could not be taken off your list. Nothing was changed.' } } }));
    mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.click(within(panel).getByRole('button', { name: 'Take off the list' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Yes, take it off' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('It is still on your list: The dish could not be taken off your list.');
    expect(screen.getByTestId(`dish-row-${A}`)).toBeInTheDocument();
  });

  it('staff get no change or remove panel', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u1', role: 'staff' } };
    mount(`/dishes?open=${A}`);
    await screen.findByTestId(`dish-leaf-${A}`);
    expect(screen.queryByTestId(`dish-details-${A}`)).toBeNull();
  });
});

describe('readPrice', () => {
  it.each([
    ['', null, false], ['12', 12, false], ['12,5', 12.5, false], ['12.50', 12.5, false], [' 1 250,00 ', 1250, false],
    ['1.250', null, true], ['1,250', null, true], ['12,505', null, true], ['-3', null, true], ['abc', null, true], ['1.2.3', null, true],
  ])('%j reads as %j (bad %j)', (text, price, bad) => {
    expect(readPrice(text)).toEqual({ price, bad });
  });
});
