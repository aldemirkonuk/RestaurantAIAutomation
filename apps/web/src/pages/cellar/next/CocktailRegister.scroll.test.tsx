/**
 * r41 recipes audit, gap 7: a clicked drink opened below the whole list with
 * no scroll. Any open now scrolls the recipe in when it would land off screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const GT = '22222222-2222-4222-8222-222222222221';
const SOUR = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({ get: vi.fn(), top: 2000, reduce: false }));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'manager', user: { role: 'manager' } }),
}));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));
const row = (id: string, name: string) => ({ id, name, display_name: null, menu_section: null, method: null, glass: null, garnish: null, price: 10 });
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    data: { rows: [row(GT, 'House G&T'), row(SOUR, 'Gin Sour')], count: 2, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '' },
    loading: false,
    error: null,
  }),
  useCocktailManages: () => true,
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister, { LEAF_HEAD_ROOM, bringIntoView } from './CocktailRegister';

const scrolled = vi.fn();
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  h.top = 2000;
  h.reduce = false;
  scrolled.mockReset();
  h.get.mockReset().mockRejectedValue(new Error('not read in this test'));
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

function mount(at = '/cocktails') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  return render(<CocktailRegister register={null} registerLoading={false} />, { wrapper: wrap });
}

/** Clicks the list row of a drink (its open recipe repeats the name in a heading). */
const click = (name: string) =>
  fireEvent.click(screen.getAllByText(name).map((e) => e.closest('tr')).find(Boolean) as HTMLElement);

describe('an opened drink is brought into view', () => {
  it('a click on a row whose recipe opens below the screen scrolls to it', () => {
    mount();
    click('House G&T');
    expect(screen.getByTestId('cocktail-leaf')).toBeInTheDocument();
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });

  it('a recipe that opens where it is seen does not move the page', () => {
    h.top = 200;
    mount();
    click('House G&T');
    expect(screen.getByTestId('cocktail-leaf')).toBeInTheDocument();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('opening another drink scrolls again; a re-render of the same one does not', () => {
    mount();
    click('House G&T');
    click('Gin Sour');
    expect(scrolled).toHaveBeenCalledTimes(2);
    // Typing a search that keeps the open drink re-renders the list, not the open.
    fireEvent.change(screen.getByPlaceholderText('Search cocktail, section, method…'), { target: { value: 'Gin' } });
    expect(screen.getByTestId('cocktail-leaf')).toBeInTheDocument();
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('a drink hidden by a search and shown again is brought into view again', () => {
    mount();
    click('House G&T');
    const search = screen.getByPlaceholderText('Search cocktail, section, method…');
    fireEvent.change(search, { target: { value: 'Sour' } });
    expect(screen.queryByTestId('cocktail-leaf')).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByTestId('cocktail-leaf')).toBeInTheDocument();
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('closing a drink does not scroll', () => {
    mount();
    click('House G&T');
    click('House G&T');
    expect(screen.queryByTestId('cocktail-leaf')).toBeNull();
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('a drink opened from a link is brought into view too', () => {
    mount(`/cocktails?open=${GT}`);
    expect(screen.getByTestId('cocktail-leaf')).toBeInTheDocument();
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('jumps without the glide for a reader who asked for less motion', () => {
    h.reduce = true;
    mount();
    click('House G&T');
    expect(scrolled).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });
});

describe('bringIntoView', () => {
  const at = (top: number) => {
    h.top = top;
    const el = document.createElement('div');
    bringIntoView(el);
    return scrolled.mock.calls.length;
  };

  it('scrolls a heading above the screen, or too low to read, and nothing between', () => {
    expect(at(-1)).toBe(1);
    expect(at(0)).toBe(1);
    expect(at(window.innerHeight - LEAF_HEAD_ROOM)).toBe(1);
    expect(at(window.innerHeight - LEAF_HEAD_ROOM + 1)).toBe(2);
  });

  it('does nothing for no element', () => {
    bringIntoView(null);
    expect(scrolled).not.toHaveBeenCalled();
  });
});
