/** /dishes: the search box finds a dish by name or section, through accents and the Turkish dotless i. */
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
  list = [
    row(A, 'İskender kebap', { section: 'Mains' }),
    row(B, 'Café gourmand', { section: 'Desserts' }),
    row(C, 'Lamb shank', { section: 'Mains' }),
    row(D, 'Ispanak', { section: 'Starters' }),
  ];
  serve();
});

const type = (v: string) => fireEvent.change(screen.getByLabelText('Search this house’s dishes'), { target: { value: v } });
const shown = () => screen.queryAllByTestId(/^dish-row-/).map((r) => r.getAttribute('data-testid'));

describe('DishesPage search', () => {
  it('shows every dish until something is typed', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    expect(shown()).toHaveLength(4);
  });

  it('finds a dish by part of its name, any case', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    type('LAMB');
    expect(shown()).toEqual([`dish-row-${C}`]);
  });

  it('finds a dish by its section', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    type('mains');
    expect(shown()).toEqual([`dish-row-${A}`, `dish-row-${C}`]);
  });

  it('reads accents and the Turkish İ and ı as plain letters', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    type('iskender');
    expect(shown()).toEqual([`dish-row-${A}`]);
    type('cafe');
    expect(shown()).toEqual([`dish-row-${B}`]);
    type('ıspanak');
    expect(shown()).toEqual([`dish-row-${D}`]);
  });

  it('wants every word typed, in any order', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    type('kebap mains');
    expect(shown()).toEqual([`dish-row-${A}`]);
    type('kebap desserts');
    expect(shown()).toEqual([]);
  });

  it('says when nothing matches and how many dishes the list holds, never an empty table in silence', async () => {
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    type('pizza');
    expect(screen.getByTestId('dishes-search-none')).toHaveTextContent('No dish matches “pizza”. 4 dishes are on your list.');
    type('');
    expect(screen.queryByTestId('dishes-search-none')).toBeNull();
    expect(shown()).toHaveLength(4);
  });

  it('is not shown while the dishes themselves could not be read', async () => {
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
      throw new Error('boom');
    });
    mount();
    await screen.findByTestId('dishes-unread');
    expect(screen.queryByLabelText('Search this house’s dishes')).toBeNull();
  });
});
