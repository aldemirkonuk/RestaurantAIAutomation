/** /dishes: what was typed in an open dish's name, section and price is kept when another dish is opened, and comes back. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: h.put, patch: h.patch, delete: h.del },
  getErrorStatus: (e: unknown) => (e as { response?: { status?: number } } | null)?.response?.status ?? null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import DishesPage from './DishesPage';
import { forgetDishDrafts } from './dishDrafts';

const full = { perServe: 300, perServeExact: 300, priced: 2, of: 2, complete: true, partial: 0 };
const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, section: 'Mains', price: 900, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: full, ...over,
});
let list: unknown[] = [];

function serve() {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes/figures`) return { data: { costsUnread: false, dishes: (list as Array<{ id: string }>).map((r) => ({ dishId: r.id, ...r })) } };
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
  forgetDishDrafts();
  Object.values(h).forEach((f) => typeof f === 'function' && f.mockReset());
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  list = [row(A, 'Lamb shank'), row(B, 'Mezze')];
  serve();
});

describe('DishesPage: an open dish keeps what was typed when another dish is opened', () => {
  const open = (id: string) => fireEvent.click(screen.getByTestId(`dish-row-${id}`));

  it('comes back when the dish is opened again, and does not leak into the other dish', async () => {
    mount(`/dishes?open=${A}`);
    let panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: '12,5' } });
    fireEvent.change(within(panel).getByLabelText('Section'), { target: { value: 'Starters' } });
    open(B);
    panel = await screen.findByTestId(`dish-details-${B}`);
    expect(within(panel).getByLabelText('Price')).toHaveValue('900');
    expect(within(panel).getByLabelText('Section')).toHaveValue('Mains');
    open(A);
    panel = await screen.findByTestId(`dish-details-${A}`);
    expect(within(panel).getByLabelText('Price')).toHaveValue('12,5');
    expect(within(panel).getByLabelText('Section')).toHaveValue('Starters');
    expect(within(panel).getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('a draft typed back to the saved values is not kept', async () => {
    mount(`/dishes?open=${A}`);
    let panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: '12' } });
    fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: '900' } });
    open(B);
    await screen.findByTestId(`dish-details-${B}`);
    list = [row(A, 'Lamb shank', { price: 1000 }), row(B, 'Mezze')];
    open(A);
    panel = await screen.findByTestId(`dish-details-${A}`);
    // Nothing was kept, so the box shows the dish as the list has it now.
    expect(within(panel).getByLabelText('Price')).toHaveValue('900');
  });

  it('a saved change is not kept as a draft', async () => {
    h.patch.mockImplementation(async () => {
      list = [row(A, 'Lamb shank', { price: 950 }), row(B, 'Mezze')];
      return { data: { id: A, name: 'Lamb shank', section: 'Mains', price: 950, description: null } };
    });
    mount(`/dishes?open=${A}`);
    let panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: '950' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
    expect(await within(panel).findByRole('status')).toHaveTextContent('Saved.');
    open(B);
    await screen.findByTestId(`dish-details-${B}`);
    open(A);
    panel = await screen.findByTestId(`dish-details-${A}`);
    expect(within(panel).getByLabelText('Price')).toHaveValue('950');
    expect(within(panel).getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('another person on the same screen does not get the draft', async () => {
    const view = mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: '12,5' } });
    view.unmount();
    h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u2', role: 'manager' } };
    mount(`/dishes?open=${A}`);
    expect(within(await screen.findByTestId(`dish-details-${A}`)).getByLabelText('Price')).toHaveValue('900');
  });
});
