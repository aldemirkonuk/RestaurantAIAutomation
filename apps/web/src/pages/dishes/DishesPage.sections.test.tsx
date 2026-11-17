/** /dishes: the Section box offers the sections already on the list, so "Mains" and "mains" are not typed as two. */
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
  
  serve();
});


import { sectionsOf } from './fold';

describe('sectionsOf', () => {
  it('lists each section once, spelt as first written, in reading order, and skips blanks', () => {
    expect(
      sectionsOf([
        { section: 'Mains' }, { section: 'mains ' }, { section: 'Çorba' }, { section: null }, { section: '  ' }, { section: 'Starters' }, { section: 'CORBA' },
      ]),
    ).toEqual(['Çorba', 'Mains', 'Starters']);
  });
});

describe('DishesPage: the Section box offers the sections on the list', () => {
  it('both the add form and an open dish list them, once each', async () => {
    list = [row(A, 'Lamb shank', { section: 'Mains' }), row(B, 'Mezze', { section: 'Starters' }), row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Steak', { section: 'mains' })];
    mount(`/dishes?open=${A}`);
    const panel = await screen.findByTestId(`dish-details-${A}`);
    const options = (box: HTMLElement) => {
      const id = box.getAttribute('list');
      expect(id).toBeTruthy();
      return Array.from(document.getElementById(id as string)!.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    };
    expect(options(within(panel).getByLabelText('Section'))).toEqual(['Mains', 'Starters']);
    const add = screen.getByTestId('dish-add');
    expect(options(within(add).getByLabelText('Section'))).toEqual(['Mains', 'Starters']);
  });

  it('a dish list with no sections gives the box no list to offer', async () => {
    list = [row(A, 'Lamb shank', { section: null })];
    mount();
    await screen.findByTestId(`dish-row-${A}`);
    expect(within(screen.getByTestId('dish-add')).getByLabelText('Section').getAttribute('list')).toBeNull();
  });
});
