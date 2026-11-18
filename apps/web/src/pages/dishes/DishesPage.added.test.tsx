/** /dishes: a dish just added is shown, even when a search or a check above would hide it. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('DishesPage: a dish just added is not hidden by the search or a check', () => {
  const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  it('clears the search, then opens the new dish', async () => {
    h.post.mockImplementation(async () => {
      list = [...list, row(NEW, 'Zucchini fritters', { hasRecipe: false, lineCount: 0, cost: null })];
      return { data: { id: NEW, name: 'Zucchini fritters', section: null, price: null, description: null } };
    });
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    fireEvent.change(screen.getByLabelText('Search this house’s dishes'), { target: { value: 'lamb' } });
    expect(screen.queryByTestId(`dish-row-${B}`)).toBeNull();
    fireEvent.change(screen.getByLabelText('Dish name'), { target: { value: 'Zucchini fritters' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add dish' }));
    expect(await screen.findByTestId(`dish-details-${NEW}`)).toBeInTheDocument();
    expect(screen.getByLabelText('Search this house’s dishes')).toHaveValue('');
    expect(screen.getByTestId(`dish-row-${B}`)).toBeInTheDocument();
    expect(screen.queryByTestId('dishes-link-hidden')).toBeNull();
  });
});
