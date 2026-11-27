/** /dishes?open=<id>: a link that opens nothing says why. */
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
  list = [row(A, 'Lamb shank'), row(B, 'Mezze', { hasRecipe: false, cost: null, lineCount: 0 })];
  serve();
});

const GONE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('DishesPage link', () => {
  it('a link to a dish that is not on the list says so, and opens nothing', async () => {
    mount(`/dishes?open=${GONE}`);
    expect(await screen.findByTestId('dishes-link-missing')).toHaveTextContent('The dish that link names is not on this house’s list. It may have been taken off it.');
    expect(screen.queryByTestId('dishes-link-hidden')).toBeNull();
    expect(screen.queryByTestId(`dish-leaf-${GONE}`)).toBeNull();
  });

  it('a link to a dish the search hides says that, not that it is gone', async () => {
    mount(`/dishes?open=${A}`);
    await screen.findByTestId(`dish-leaf-${A}`);
    expect(screen.queryByTestId('dishes-link-hidden')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search this house’s dishes'), { target: { value: 'mezze' } });
    expect(screen.getByTestId('dishes-link-hidden')).toHaveTextContent('is on your list, but the search or a check above hides it');
    expect(screen.queryByTestId('dishes-link-missing')).toBeNull();
  });

  it('a link to a dish the no-recipe check hides says that too', async () => {
    mount(`/dishes?open=${A}`);
    await screen.findByTestId(`dish-leaf-${A}`);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByTestId('dishes-link-hidden')).toBeInTheDocument();
    expect(screen.queryByTestId(`dish-leaf-${A}`)).toBeNull();
  });

  it('a link that opens its dish, and a page with no link, say nothing', async () => {
    mount(`/dishes?open=${A}`);
    await screen.findByTestId(`dish-leaf-${A}`);
    expect(screen.queryByTestId('dishes-link-missing')).toBeNull();
    expect(screen.queryByTestId('dishes-link-hidden')).toBeNull();
  });

  it('no link, no sentence', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    expect(screen.queryByTestId('dishes-link-missing')).toBeNull();
    expect(screen.queryByTestId('dishes-link-hidden')).toBeNull();
  });

  it('while the dishes are still being read, nothing is said about the link', async () => {
    h.get.mockImplementation((url: string) =>
      url === `/recipes/${RID}/dishes` ? new Promise(() => {}) : Promise.resolve({ data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } }),
    );
    mount(`/dishes?open=${GONE}`);
    expect(await screen.findByText('Reading the dishes…')).toBeInTheDocument();
    expect(screen.queryByTestId('dishes-link-missing')).toBeNull();
  });
});
