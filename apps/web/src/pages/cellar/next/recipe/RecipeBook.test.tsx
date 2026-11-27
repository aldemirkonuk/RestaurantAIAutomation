/**
 * The spec book (r108 drinks-g7): one print of every drink's card, by section and then name, one card per page,
 * with no money for anyone (the owner included), drawn only on paper, without animation, and never a shorter
 * book when the read fails.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DrinkCard } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown> }));

vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get, put: vi.fn(), post: vi.fn() }, getErrorStatus: () => null }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import RecipeBook, { bookOrder } from './RecipeBook';

const free = Object.fromEntries(['gluten', 'milk', 'sulphites'].map((a) => [a, 'free']));
const card = (id: string, name: string, section: string | null, extra: Partial<DrinkCard> = {}): DrinkCard => ({
  cocktailId: id, name, section, glass: 'Rocks', method: 'Stir with ice', garnish: 'Orange peel', yieldServes: 1, version: 4,
  versionDate: '2026-11-07T10:00:00Z',
  lines: [{ label: 'gin', qty: 50, unit: 'ml', name: 'Plymouth gin' }],
  allergens: { readable: true, status: { ...free, sulphites: 'contains' } as never, unstatedBy: [] },
  ...extra,
});

const cards: DrinkCard[] = [
  card('c3', 'Whisky sour', null),
  card('c2', 'Spritz', 'Aperitivo'),
  card('c4', 'Old fashioned', 'Digestivo'),
  card('c1', 'Negroni', 'Aperitivo'),
];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecipeBook />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: null, readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/drinks/cards`) return { data: { drinks: cards } };
    throw new Error(`unexpected GET ${url}`);
  });
  h.auth = { activeRestaurantId: RID, activeRole: 'owner', user: { userId: 'u1', role: 'owner' }, availableRestaurants: [{ id: RID, name: 'Meyhouse', city: null, chain_id: null, chain_name: null }] };
  window.print = vi.fn();
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-print-book');
});

describe('the spec book', () => {
  it('orders sections by name with the unsectioned last, and the drinks of a section by name', () => {
    expect(bookOrder(cards).map((s) => [s.section, s.cards.map((c) => c.name)])).toEqual([
      ['Aperitivo', ['Negroni', 'Spritz']],
      ['Digestivo', ['Old fashioned']],
      ['Other drinks', ['Whisky sour']],
    ]);
  });

  it('puts the title block on the first drink\'s page (no cover sheet), then one card per drink in section order', async () => {
    mount();
    fireEvent.click(screen.getByTestId('book-print-button'));
    const cover = await screen.findByTestId('book-title');
    expect(screen.queryByTestId('book-cover')).toBeNull();
    await waitFor(() => expect(cover).toHaveTextContent(/Meyhouse: spec book/));
    // A pound house reads the day first ("7 Nov 2026"), a dollar house month first; the cover carries the count.
    expect(cover).toHaveTextContent(/\d{1,2} [A-Z][a-z]{2} 20\d\d · 4 drinks/);
    const pages = screen.getAllByTestId('book-card');
    expect(pages[0]).toContainElement(cover);
    expect(screen.getAllByTestId('book-title')).toHaveLength(1);
    expect(pages.map((p) => within(p).getByRole('heading', { name: /Negroni|Spritz|Old fashioned|Whisky sour/, hidden: true }).textContent)).toEqual(['Negroni', 'Spritz', 'Old fashioned', 'Whisky sour']);
    expect(pages[0]).toHaveTextContent('Makes 1 serve · Rocks · version 4, 7 Nov 2026');
    expect(pages[0]).toHaveTextContent('50 ml Plymouth gin');
    expect(pages[0]).toHaveTextContent('Garnish: Orange peel');
    expect(pages[0]).toHaveTextContent('Contains sulphites');
  });

  it('carries no money text for an owner, and offers no box to add it', async () => {
    mount();
    fireEvent.click(screen.getByTestId('book-print-button'));
    const book = await screen.findByTestId('recipe-book');
    expect(book.textContent).not.toMatch(/£|\$|₺|Cost|Price|Pour cost|Margin/);
    expect(screen.queryByLabelText('Include cost')).toBeNull();
  });

  it('prints once, only while the book is the thing being printed, and clears the flag after', async () => {
    mount();
    expect(document.documentElement).not.toHaveAttribute('data-print-book');
    fireEvent.click(screen.getByTestId('book-print-button'));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(document.documentElement).toHaveAttribute('data-print-book');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-print-book'));
    expect(screen.queryByTestId('recipe-book')).toBeNull();
  });

  it('a failed read says so and prints nothing, never a shorter book', async () => {
    h.get.mockImplementation(async (url: string) => {
      if (url === '/settings/currency') return { data: { readable: false } };
      throw new Error('boom');
    });
    mount();
    fireEvent.click(screen.getByTestId('book-print-button'));
    expect(await screen.findByTestId('book-said')).toHaveTextContent('The spec book could not be read just now. Nothing was printed.');
    expect(window.print).not.toHaveBeenCalled();
    expect(screen.queryByTestId('recipe-book')).toBeNull();
  });

  it('a house with no saved recipe says there is no book, and prints nothing', async () => {
    h.get.mockImplementation(async (url: string) => (url === '/settings/currency' ? { data: { readable: false } } : { data: { drinks: [] } }));
    mount();
    fireEvent.click(screen.getByTestId('book-print-button'));
    expect(await screen.findByTestId('book-said')).toHaveTextContent('No drink has a saved recipe yet');
    expect(window.print).not.toHaveBeenCalled();
  });

  it('an allergen read that failed on a card is said, never read as allergen-free', async () => {
    h.get.mockImplementation(async (url: string) =>
      url === '/settings/currency' ? { data: { readable: false } } : { data: { drinks: [card('c1', 'Negroni', 'Aperitivo', { allergens: { readable: false } })] } },
    );
    mount();
    fireEvent.click(screen.getByTestId('book-print-button'));
    expect(await screen.findByTestId('book-card')).toHaveTextContent('Allergens could not be read.');
  });

  // r109 drinks-2 (DD-r107-40): with item_allergens missing (#2119, schema gap #922) every drink's read fails.
  it('when every drink\'s allergen read failed, every page says so: none prints free, blank or "none"', async () => {
    const failed = cards.map((c) => ({ ...c, allergens: { readable: false } as const }));
    h.get.mockImplementation(async (url: string) => (url === '/settings/currency' ? { data: { readable: false } } : { data: { drinks: failed } }));
    mount();
    fireEvent.click(screen.getByTestId('book-print-button'));
    const pages = await screen.findAllByTestId('book-card');
    expect(pages).toHaveLength(4);
    for (const page of pages) {
      const said = within(page).getAllByText(/allergen/i).map((p) => p.textContent);
      expect(said).toEqual(['Allergens could not be read.']);
      expect(page.textContent).not.toMatch(/free of|none recorded|Contains|May contain/i);
    }
  });

  it('a drink whose lines state nothing prints not known, never free of the 14', async () => {
    const notStated = Object.fromEntries(['gluten', 'milk', 'sulphites'].map((a) => [a, 'not_stated']));
    h.get.mockImplementation(async (url: string) =>
      url === '/settings/currency'
        ? { data: { readable: false } }
        : { data: { drinks: [card('c1', 'Negroni', 'Aperitivo', { allergens: { readable: true, status: notStated as never, unstatedBy: [] } })] } },
    );
    mount();
    fireEvent.click(screen.getByTestId('book-print-button'));
    const page = await screen.findByTestId('book-card');
    expect(page).toHaveTextContent('Allergens not known: nothing is recorded.');
    expect(page.textContent).not.toMatch(/free of/i);
  });

  it('draws only on paper, one card per page, without animation or transition', () => {
    const css = readFileSync(join(__dirname, '../cellar-next.css'), 'utf8');
    expect(css).toMatch(/\.cl-print-book \{ display: none; \}/);
    const start = css.indexOf('.cl-print-book { display: none; }');
    const block = css.slice(start, css.indexOf('/* The recipe card (r104 drinks need 4)'));
    expect(block).toMatch(/html\[data-print-book\] body > \*:not\(\.cl-print-book\) \{ display: none !important; \}/);
    expect(block).toMatch(/\.cl-book-page \{[^}]*break-after: page/);
    expect(block).not.toMatch(/animation|transition/);
  });
});
