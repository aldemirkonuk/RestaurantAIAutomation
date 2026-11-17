/** /dishes: a sentence about the last save or refusal goes when the form is edited again. */
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
  Object.values(h).forEach((f) => typeof f === 'function' && f.mockReset());
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  list = [row(A, 'Lamb shank'), row(B, 'Mezze')];
  serve();
});

describe('DishesPage: a said line is for the last thing done', () => {
  it('"Saved." goes as soon as the open dish is edited again, name, section or price', async () => {
    h.patch.mockResolvedValue({ data: { id: A, name: 'Lamb shank', section: 'Mains', price: 950.5, description: null } });
    mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    for (const label of ['Price', 'Dish name', 'Section']) {
      fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: label === 'Price' ? '950,50' : '951' } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
      expect(await within(panel).findByRole('status')).toHaveTextContent('Saved.');
      fireEvent.change(within(panel).getByLabelText(label), { target: { value: label === 'Price' ? '960' : 'Changed again' } });
      expect(within(panel).queryByRole('status')).toBeNull();
      fireEvent.change(within(panel).getByLabelText('Price'), { target: { value: '900' } });
    }
  });

  it('a refused change says why, and the sentence goes once the field is fixed', async () => {
    h.patch.mockRejectedValue({ response: { status: 409, data: { message: 'A dish named Mezze is already on your list.' } } });
    mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    fireEvent.change(within(panel).getByLabelText('Dish name'), { target: { value: 'Mezze' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Nothing was changed');
    fireEvent.change(within(panel).getByLabelText('Dish name'), { target: { value: 'Mezze two' } });
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('the add form drops its refusal when a field is edited', async () => {
    h.post.mockRejectedValue({ response: { status: 409, data: { message: 'A dish named Lamb shank is already on your list.' } } });
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    fireEvent.change(screen.getByLabelText('Dish name'), { target: { value: 'Lamb shank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add dish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was written');
    fireEvent.change(screen.getByLabelText('Dish name'), { target: { value: 'Lamb shank 2' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
