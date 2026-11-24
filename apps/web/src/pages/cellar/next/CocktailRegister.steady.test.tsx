/**
 * r98 (DD-r97-2): a cold /cocktails?open= settles as one entrance. jsdom has no
 * layout, so these pin the rules in the markup and the order of the states; the
 * shift itself is a browser measurement. What they hold:
 *  - the read-in-flight table draws as many empty rows as the page knows the
 *    list to have (one when it knows nothing);
 *  - the books below the leaf (and the signature, by data-settling) stay unseen
 *    while the list is read and while a linked drink opens, then show;
 *  - a drink a link named opens after the table has drawn, a click opens at once;
 *  - a failed list read never hides the ledger;
 *  - the late menu offer holds its line's room.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readingRowCount, READING_ROWS_MAX } from './readingRows';

const RID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({
  get: vi.fn(),
  list: { data: null, loading: true, error: null } as {
    data: unknown;
    loading: boolean;
    error: string | null;
  },
  figureIds: [] as string[],
  bareIds: [] as string[],
}));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'owner', user: { userId: 'u1', role: 'owner' } }),
}));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => h.list,
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

const row = (id: string, name: string) => ({
  id, name, display_name: null, description: null, menu_section: null, method: null, glass: null, garnish: null, price: null,
});
const loaded = {
  rows: [row('c1', 'Negroni'), row('c2', 'Gimlet')],
  count: 2, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: 'scope',
};
let offerAnswer: (() => Promise<unknown>) | null = null;
let figuresAnswer: (() => Promise<unknown>) | null = null;

beforeEach(() => {
  h.list = { data: null, loading: true, error: null };
  h.figureIds = [];
  offerAnswer = null;
  figuresAnswer = null;
  h.bareIds = [];
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: null, readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/drinks/figures`) {
      if (figuresAnswer) return figuresAnswer();
      return { data: { costsUnread: false, drinks: h.figureIds.map((cocktailId) => ({ cocktailId, hasRecipe: !h.bareIds.includes(cocktailId), allergens: null })) } };
    }
    if (url === `/recipes/${RID}/menu-prices`) return { data: { amountsWithheld: false, currentMenus: 0, dishes: [], drinks: [] } };
    if (url === `/recipes/${RID}/drinks/from-menu`) {
      if (offerAnswer) return offerAnswer();
      return { data: { currentMenus: 0, drinks: [] } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});
afterEach(() => vi.useRealTimers());

function mount(url = '/cocktails') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <CocktailRegister register={null} registerLoading={false} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const r = render(ui());
  return { ...r, again: () => r.rerender(ui()) };
}
const ledger = () => screen.getByTestId('cocktail-ledger') as HTMLElement;
const stand = (c: HTMLElement) => c.querySelector('.cl-stand') as HTMLElement;
const emptyRows = (c: HTMLElement) => c.querySelectorAll('[data-testid="cocktails-reading-room"] tbody tr').length;

describe('readingRowCount', () => {
  it('is one row when nothing is known, the known count otherwise, never more than a screen and a bit', () => {
    expect(readingRowCount(null)).toBe(1);
    expect(readingRowCount(undefined)).toBe(1);
    expect(readingRowCount(0)).toBe(1);
    expect(readingRowCount(Number.NaN)).toBe(1);
    expect(readingRowCount(8)).toBe(8);
    expect(readingRowCount(9999)).toBe(READING_ROWS_MAX);
  });
});

describe('the table held while the list is read', () => {
  it('draws one empty row when the page knows nothing of the list', () => {
    const { container } = mount();
    expect(emptyRows(container)).toBe(1);
  });

  it('draws as many as the figures read beside it say the list has', async () => {
    h.figureIds = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const { container } = mount();
    await waitFor(() => expect(emptyRows(container)).toBe(5));
  });
});

describe('the books below the list while a list is read', () => {
  it('are unseen (they hold their room) while the list is read, then shown', () => {
    const { again } = mount();
    expect(screen.getByTestId('cocktail-register')).toHaveAttribute('data-settling', 'true');
    expect(ledger().style.visibility).toBe('hidden');
    h.list = { data: loaded, loading: false, error: null };
    again();
    expect(screen.getByTestId('cocktail-register')).not.toHaveAttribute('data-settling');
    expect(ledger().style.visibility).toBe('');
  });

  it('a failed list read leaves the ledger shown, even for a linked drink', () => {
    h.list = { data: null, loading: false, error: 'boom' };
    mount('/cocktails?open=c1');
    expect(screen.getByTestId('cocktails-unread')).toBeInTheDocument();
    expect(ledger().style.visibility).toBe('');
    expect(screen.getByTestId('cocktail-register')).not.toHaveAttribute('data-settling');
  });
});

describe('a drink a link names opens after the table has drawn', () => {
  it('draws the leaf closed with the table, opens it a frame later, and shows the books once it has settled', async () => {
    vi.useFakeTimers();
    h.list = { data: loaded, loading: false, error: null };
    const { container } = mount('/cocktails?open=c1');
    // Effects have run: the stand was drawn closed, then told to open.
    expect(screen.getByTestId('cocktail-leaf')).toBeInTheDocument();
    expect(stand(container).dataset.open).toBe('true');
    // The books are still unseen while the settle runs.
    expect(ledger().style.visibility).toBe('hidden');
    expect(screen.getByTestId('cocktail-register')).toHaveAttribute('data-settling', 'true');
    await act(async () => { vi.advanceTimersByTime(339); });
    expect(ledger().style.visibility).toBe('hidden');
    await act(async () => { vi.advanceTimersByTime(2); });
    expect(ledger().style.visibility).toBe('');
    expect(screen.getByTestId('cocktail-register')).not.toHaveAttribute('data-settling');
  });

  it('the first render of the listed table holds the stand closed (the open is a change the browser sees)', () => {
    h.list = { data: loaded, loading: false, error: null };
    const seen: string[] = [];
    const orig = Element.prototype.getBoundingClientRect;
    // The flush the page forces between "drawn closed" and "open" is the moment the stand still reads closed.
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList?.contains('cl-stand')) seen.push((this as HTMLElement).dataset.open ?? '');
      return orig.call(this);
    });
    mount('/cocktails?open=c1');
    spy.mockRestore();
    expect(seen).toContain('false');
  });

  it('a drink opened by a click opens at once and never hides the books', async () => {
    h.list = { data: loaded, loading: false, error: null };
    const { container } = mount('/cocktails');
    expect(stand(container).dataset.open).toBe('false');
    expect(ledger().style.visibility).toBe('');
    await act(async () => {
      (container.querySelector('tbody tr') as HTMLElement).click();
    });
    expect(stand(container).dataset.open).toBe('true');
    expect(ledger().style.visibility).toBe('');
  });
});

describe('the menu offer holds its line while the menu is read', () => {
  it('holds one line of room, empty and hidden from a screen reader, and gives it back for a house with nothing to offer', async () => {
    let release: (v: unknown) => void = () => {};
    offerAnswer = () => new Promise((r) => { release = r; });
    h.list = { data: loaded, loading: false, error: null };
    mount();
    const room = await screen.findByTestId('menu-drinks-offer-room');
    expect(room).toHaveAttribute('aria-hidden', 'true');
    expect(room).toHaveClass('cl-offer-room');
    expect(room.style.minHeight).toBe('');
    expect(room.textContent).toBe('');
    await act(async () => { release({ data: { currentMenus: 1, drinks: [] } }); });
    expect(screen.queryByTestId('menu-drinks-offer-room')).toBeNull();
  });

  it('the line that says no menu is current takes the held room (one is on the page, never both)', async () => {
    let release: (v: unknown) => void = () => {};
    offerAnswer = () => new Promise((r) => { release = r; });
    h.list = { data: loaded, loading: false, error: null };
    mount();
    await screen.findByTestId('menu-drinks-offer-room');
    await act(async () => { release({ data: { currentMenus: 0, drinks: [] } }); });
    expect(await screen.findByTestId('menu-drinks-no-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-drinks-offer-room')).toBeNull();
  });
});

describe('the no-recipe line holds its room while the figures are read (r105, walk r104 FAIL 14)', () => {
  const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');
  const answer = (bare: string[]) => ({
    data: { costsUnread: false, drinks: ['c1', 'c2'].map((cocktailId) => ({ cocktailId, hasRecipe: !bare.includes(cocktailId), allergens: null })) },
  });

  it('draws the room empty at first paint, then the line lands inside the same room: nothing is added to the page', async () => {
    let release: (v: unknown) => void = () => {};
    figuresAnswer = () => new Promise((r) => { release = r; });
    h.list = { data: loaded, loading: false, error: null };
    mount();
    const room = screen.getByTestId('no-recipe-room');
    expect(room).toHaveClass('cl-norecipe-room');
    expect(room.textContent).toBe('');
    expect(screen.queryByTestId('no-recipe-yet')).toBeNull();
    await act(async () => { release(answer(['c2'])); });
    const line = await screen.findByTestId('no-recipe-yet');
    expect(screen.getByTestId('no-recipe-room')).toBe(room);
    expect(room).toContainElement(line);
  });

  it('keeps the room, empty, for a house where every drink has a recipe: it is not given back', async () => {
    let release: (v: unknown) => void = () => {};
    figuresAnswer = () => new Promise((r) => { release = r; });
    h.list = { data: loaded, loading: false, error: null };
    mount();
    const room = screen.getByTestId('no-recipe-room');
    await act(async () => { release(answer([])); });
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(`/recipes/${RID}/drinks/figures`));
    expect(screen.getByTestId('no-recipe-room')).toBe(room);
    expect(screen.queryByTestId('no-recipe-yet')).toBeNull();
    expect(room.textContent).toBe('');
  });

  it('holds one line and the top margin, two lines at a phone, with no transition', () => {
    const rule = (re: RegExp) => css.match(re)?.[0] ?? '';
    const base = rule(/\.cl-norecipe-room \{[^}]*\}/);
    expect(base).toMatch(/display: flow-root;/);
    expect(base).toMatch(/min-height: calc\(12px \+ 1lh\);/);
    expect(rule(/@media \(max-width: 640px\) \{ \.cl-norecipe-room \{[^}]*\} \}/)).toMatch(/min-height: calc\(12px \+ 2lh\);/);
    expect(base + css.match(/\.cl-norecipe-room[^{]*\{[^}]*\}/g)?.join('')).not.toMatch(/transition|animation/);
  });
});

describe('the signature waits with the register', () => {
  const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');
  const cellarNext = readFileSync(resolve(__dirname, 'CellarNext.tsx'), 'utf8');

  it('hides the signature while a register says it is settling, and the footer leaves its visibility to that rule', () => {
    expect(css).toMatch(/\.mudavym:has\(\[data-settling='true'\]\) \.cl-signature\s*\{\s*visibility: hidden;/);
    expect(cellarNext).toContain('className="cl-signature"');
    // An inline 'visible' would beat the stylesheet rule above.
    expect(cellarNext).not.toMatch(/visibility:[^,\n]*'visible'/);
  });
});
