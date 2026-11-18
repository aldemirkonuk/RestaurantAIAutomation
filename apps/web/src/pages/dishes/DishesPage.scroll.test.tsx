/**
 * /dishes: an opened dish is brought into view when its heading would land off
 * the screen, as an opened drink is on /cocktails (r41 recipes audit, gap 7).
 * A link from the inventory drawer, or a dish just added, opens a row that can
 * sit far down a long list; the page used to stay at the top.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), top: 2000, reduce: false, auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));

import DishesPage from './DishesPage';

const row = (id: string, name: string) => ({ id, name, section: 'Mains', price: 900, hasRecipe: true, yieldServes: 1, lineCount: 1, cost: null });
let list: unknown[] = [];

const scrolled = vi.fn();
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  h.top = 2000;
  h.reduce = false;
  scrolled.mockReset();
  list = [row(A, 'Lamb shank'), row(B, 'Mezze')];
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes/figures`) return { data: { costsUnread: false, dishes: [] } };
    if (url === `/recipes/${RID}/dishes`) return { data: list };
    throw new Error(`unexpected GET ${url}`);
  });
  HTMLElement.prototype.scrollIntoView = scrolled;
  HTMLElement.prototype.getBoundingClientRect = function rect() {
    return { top: h.top, bottom: h.top, left: 0, right: 0, width: 0, height: 0, x: 0, y: h.top, toJSON: () => ({}) } as DOMRect;
  };
  window.matchMedia = ((q: string) => ({
    matches: h.reduce && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

function mount(at = '/dishes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('an opened dish is brought into view', () => {
  it('a dish opened from a link whose sheet lands below the screen is scrolled to', async () => {
    mount(`/dishes?open=${B}`);
    await screen.findByTestId(`dish-leaf-${B}`);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });

  it('a sheet that opens where it is seen does not move the page', async () => {
    h.top = 200;
    mount(`/dishes?open=${B}`);
    await screen.findByTestId(`dish-leaf-${B}`);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('opening another dish scrolls again; typing in the search that keeps it does not', async () => {
    mount();
    fireEvent.click(await screen.findByTestId(`dish-row-${A}`));
    fireEvent.click(screen.getByTestId(`dish-row-${B}`));
    expect(scrolled).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Search this house’s dishes'), { target: { value: 'mezze' } });
    expect(screen.getByTestId(`dish-leaf-${B}`)).toBeInTheDocument();
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('closing a dish does not scroll', async () => {
    mount();
    fireEvent.click(await screen.findByTestId(`dish-row-${A}`));
    fireEvent.click(screen.getByTestId(`dish-row-${A}`));
    expect(screen.queryByTestId(`dish-leaf-${A}`)).toBeNull();
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('jumps without the glide for a reader who asked for less motion', async () => {
    h.reduce = true;
    mount(`/dishes?open=${A}`);
    await screen.findByTestId(`dish-leaf-${A}`);
    expect(scrolled).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });
});
