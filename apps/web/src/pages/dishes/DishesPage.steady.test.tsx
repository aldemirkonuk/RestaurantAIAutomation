/**
 * r97: opening a dish by link on /dishes shifted the table rows (CLS ~0.052 at
 * 1440 px for an owner or manager, a table-row shift at ~220-290 ms, with the
 * taste read aborted). The page's own late reads moved its rows: the figures
 * arrived and (1) added a "No recipe yet" line under the name of each dish with
 * no recipe, (2) put the "N of M have no recipe yet" line above the table, and
 * (3) the opened dish's recipe sheet grew from its one-line "Reading…" note.
 * First paint is now the geometry the loaded page keeps. jsdom has no layout,
 * so these pin the reserved room in the markup; the shift itself is a browser
 * measurement (a layout-shift observer at 1440 and 375).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NAMES = `/recipes/${RID}/dishes`;
const FIGURES = `/recipes/${RID}/dishes/figures`;

const h = vi.hoisted(() => ({ get: vi.fn(), role: 'owner' }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: h.role, user: { role: h.role } }),
}));
vi.mock('../cellar/next/recipe/RecipeSheet', () => ({
  default: ({ dishId, holdRoom }: { dishId: string; holdRoom?: boolean }) => (
    <div data-testid={`sheet-${dishId}`} data-hold-room={holdRoom ? 'true' : undefined} />
  ),
}));

import DishesPage from './DishesPage';

const names = [
  { id: A, name: 'Lamb shank', section: 'Mains', price: 900 },
  { id: B, name: 'Soup', section: null, price: 300 },
];
const full = { perServe: 300, perServeExact: 300, priced: 2, of: 2, complete: true, partial: 0 };
const figures = {
  costsUnread: false,
  dishes: [
    { dishId: A, price: 900, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: full, allergens: null },
    { dishId: B, price: 300, hasRecipe: false, yieldServes: null, lineCount: 0, cost: null, allergens: null },
  ],
};
let answer: Record<string, () => Promise<unknown>> = {};

beforeEach(() => {
  h.role = 'owner';
  answer = {
    '/settings/currency': async () => ({ data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } }),
    [NAMES]: async () => ({ data: names }),
    [FIGURES]: async () => ({ data: figures }),
  };
  h.get.mockReset().mockImplementation((url: string) => (answer[url] ? answer[url]() : Promise.reject(new Error(`not read here: ${url}`))));
});

function mount(url = '/dishes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const nameCell = (id: string) => screen.getByTestId(`dish-row-${id}`).querySelector('td') as HTMLElement;
const subLine = (id: string) => nameCell(id).querySelector('[data-testid="dish-sub"]') as HTMLElement;

describe('/dishes keeps its rows still while the figures arrive', () => {
  it('every row holds the line under its name before and after the figures, with a recipe or without', async () => {
    let release: (v: unknown) => void = () => {};
    answer[FIGURES] = () => new Promise((r) => { release = r; });
    mount();
    await waitFor(() => expect(screen.getByTestId(`dish-row-${A}`)).toBeInTheDocument());
    // Figures unread yet: both rows already hold the line, empty.
    for (const id of [A, B]) {
      expect(subLine(id).style.minHeight).toBe('1lh');
      expect(subLine(id).textContent).toBe('');
    }
    release({ data: figures });
    await waitFor(() => expect(subLine(B).textContent).toBe('No recipe yet'));
    // Same box, same height rule, whether it says something or not.
    expect(subLine(A).style.minHeight).toBe('1lh');
    expect(subLine(A).textContent).toBe('');
    expect(subLine(B).style.minHeight).toBe('1lh');
  });

  it('an owner\'s "no recipe yet" line has its room held while the figures are read, and the room is kept, never dropped, once nothing is bare', async () => {
    let release: (v: unknown) => void = () => {};
    answer[FIGURES] = () => new Promise((r) => { release = r; });
    mount();
    await waitFor(() => expect(screen.getByTestId(`dish-row-${A}`)).toBeInTheDocument());
    const held = screen.getByTestId('no-recipe-yet-room');
    expect(held).toHaveAttribute('aria-hidden', 'true');
    expect(held.style.minHeight).toBe('1lh');
    expect(screen.queryByTestId('no-recipe-yet')).toBeNull();
    release({ data: figures });
    // The real line takes the held one's place (one is on the page, never both).
    expect(await screen.findByTestId('no-recipe-yet')).toBeInTheDocument();
    expect(screen.queryByTestId('no-recipe-yet-room')).toBeNull();
  });

  it('a house whose dishes all have recipes keeps the same room, and the line that takes it says so', async () => {
    let release: (v: unknown) => void = () => {};
    answer[FIGURES] = () => new Promise((r) => { release = r; });
    mount();
    await waitFor(() => expect(screen.getByTestId(`dish-row-${A}`)).toBeInTheDocument());
    expect(screen.getByTestId('no-recipe-yet-room').style.minHeight).toBe('1lh');
    release({ data: { ...figures, dishes: figures.dishes.map((d) => ({ ...d, hasRecipe: true })) } });
    const taken = await screen.findByTestId('every-dish-has-recipe');
    // The one room on the page: same class, same hold, same margin as before the read settled.
    expect(taken.style.minHeight).toBe('1lh');
    expect(taken.style.marginTop).toBe('12px');
    expect(taken).toHaveTextContent('Every dish has a recipe.');
    expect(screen.queryByTestId('no-recipe-yet-room')).toBeNull();
    expect(screen.queryByTestId('no-recipe-yet')).toBeNull();
  });

  it('a figures read that failed keeps the room too, and says nothing it does not know', async () => {
    answer[FIGURES] = () => Promise.reject(new Error('down'));
    mount();
    const room = await screen.findByTestId('no-recipe-yet-room');
    await screen.findByTestId('dishes-allergens-unread');
    expect(room.style.minHeight).toBe('1lh');
    expect(screen.queryByTestId('every-dish-has-recipe')).toBeNull();
  });

  it('staff are shown no such line, so none is held', async () => {
    h.role = 'staff';
    answer[FIGURES] = () => new Promise(() => {});
    mount();
    await waitFor(() => expect(screen.getByTestId(`dish-row-${A}`)).toBeInTheDocument());
    expect(screen.queryByTestId('no-recipe-yet-room')).toBeNull();
  });
});

describe('/dishes opened by a link holds the sheet\'s room', () => {
  it('the dish a link names is told so; a dish opened by a click is not', async () => {
    mount(`/dishes?open=${A}`);
    expect(await screen.findByTestId(`sheet-${A}`)).toHaveAttribute('data-hold-room', 'true');
  });

  it('opening another dish after arrival holds nothing', async () => {
    const { container } = mount(`/dishes?open=${A}`);
    await screen.findByTestId(`sheet-${A}`);
    (container.querySelector(`[data-testid="dish-row-${B}"]`) as HTMLElement).click();
    expect(await screen.findByTestId(`sheet-${B}`)).not.toHaveAttribute('data-hold-room');
  });
});

describe('r98: /dishes holds the menu offer\'s line and gives the dish register a thumb\'s size on a phone', () => {
  const OFFER = `/recipes/${RID}/dishes/from-menu`;

  it('holds one line of room above the add form until the menu offer is read, then the real line takes it', async () => {
    let release: (v: unknown) => void = () => {};
    answer[OFFER] = () => new Promise((r) => { release = r; });
    mount();
    const room = await screen.findByTestId('menu-dishes-offer-room');
    expect(room).toHaveAttribute('aria-hidden', 'true');
    expect(room.style.minHeight).toBe('1lh');
    expect(screen.getByTestId('dish-add')).toBeInTheDocument();
    release({ data: { currentMenus: 0, dishes: [] } });
    expect(await screen.findByTestId('menu-dishes-no-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-dishes-offer-room')).toBeNull();
  });

  it('the page carries the scope class, and the stylesheet makes its buttons and boxes 44 px at 640 px and under', () => {
    mount();
    expect(screen.getByTestId('dishes-page').parentElement).toHaveClass('cl-touch');
    const css = readFileSync(resolve(__dirname, '../cellar/next/cellar-next.css'), 'utf8');
    const rule = css.match(/@media \(max-width: 640px\) \{\s*\.cl-touch \.cl-btn,\s*\.cl-touch \.cl-field \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/height: 44px;/);
    expect(rule?.[1]).toMatch(/min-height: 44px;/);
  });
});
