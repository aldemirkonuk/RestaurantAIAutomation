/**
 * r98 (motion need M10): the dish leaf opens with the SAME settle as the cocktail leaf. It sits in
 * `tr > td[colspan] > div.cl-stand`, draws closed, and opens a style flush later (except the dish a link named at load, which draws open at once) (the stylesheet's
 * `.cl-stand` carries the 320 ms house curve and none under reduced motion). Switching dishes does not
 * settle again; a leaf opened by a click settles too (nothing was open). Close removes the row at once.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'owner', user: { role: 'owner' } }),
}));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({ default: ({ dishId }: { dishId: string }) => <div data-testid={`sheet-${dishId}`} /> }));

import DishesPage from './DishesPage';

const answer: Record<string, unknown> = {
  '/settings/currency': { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null },
  [`/recipes/${RID}/dishes`]: [
    { id: A, name: 'Lamb shank', section: 'Mains', price: 900 },
    { id: B, name: 'Soup', section: null, price: 300 },
  ],
  [`/recipes/${RID}/dishes/figures`]: { costsUnread: false, dishes: [] },
  [`/recipes/${RID}/dishes/from-menu`]: { currentMenus: 0, dishes: [] },
  [`/recipes/${RID}/menu-prices`]: { amountsWithheld: false, currentMenus: 0, dishes: [], drinks: [] },
};
beforeEach(() => {
  h.get.mockReset().mockImplementation(async (url: string) => (url in answer ? { data: answer[url] } : Promise.reject(new Error(`not read: ${url}`))));
});
afterEach(() => vi.restoreAllMocks());

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const stand = (id: string) => screen.getByTestId(`dish-leaf-${id}`).querySelector('td > div.cl-stand') as HTMLElement;

/** The `data-open` each stand reads at the style flush the page forces before it opens. */
function watchFlush() {
  const seen: string[] = [];
  const orig = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList?.contains('cl-stand')) seen.push((this as HTMLElement).dataset.open ?? '');
    return orig.call(this);
  });
  return seen;
}

describe('the dish leaf settles like the cocktail leaf', () => {
  it('sits in tr > td[colspan] > div.cl-stand, open at once for the dish a link named', async () => {
    const seen = watchFlush();
    mount(`/dishes?open=${A}`);
    const leaf = await screen.findByTestId(`dish-leaf-${A}`);
    expect(leaf.tagName).toBe('TR');
    const td = leaf.querySelector(':scope > td') as HTMLTableCellElement;
    expect(td.colSpan).toBeGreaterThan(1);
    expect(stand(A).dataset.open).toBe('true');
    // A cold ?open= is not the person's act: a tween would be counted as layout shift, so it never draws closed.
    expect(seen).not.toContain('false');
  });

  it('a dish opened by a click, with none open, settles the same way', async () => {
    const { container } = mount('/dishes');
    await screen.findByTestId(`dish-row-${A}`);
    const seen = watchFlush();
    await act(async () => { (container.querySelector(`[data-testid="dish-row-${A}"]`) as HTMLElement).click(); });
    expect(stand(A).dataset.open).toBe('true');
    expect(seen).toContain('false');
  });

  it('opening another dish while one is open takes its place already open (no second settle)', async () => {
    const { container } = mount(`/dishes?open=${A}`);
    await screen.findByTestId(`dish-leaf-${A}`);
    const seen = watchFlush();
    await act(async () => { (container.querySelector(`[data-testid="dish-row-${B}"]`) as HTMLElement).click(); });
    expect(stand(B).dataset.open).toBe('true');
    expect(screen.queryByTestId(`dish-leaf-${A}`)).toBeNull();
    expect(seen).not.toContain('false');
  });

  it('closing removes the leaf row at once', async () => {
    const { container } = mount(`/dishes?open=${A}`);
    await screen.findByTestId(`dish-leaf-${A}`);
    await act(async () => { (container.querySelector(`[data-testid="dish-row-${A}"]`) as HTMLElement).click(); });
    expect(screen.queryByTestId(`dish-leaf-${A}`)).toBeNull();
  });
});
