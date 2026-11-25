/**
 * The printable recipe card (r104 drinks need 4): staff get a money-free card,
 * an owner or manager gets cost only when the box is ticked, and an unsaved
 * draft never reaches the paper.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const GIN = '33333333-3333-4333-8333-333333333333';

const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown>, taste: vi.fn() }));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: h.get, put: vi.fn(), post: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: h.taste, rollupTaste: vi.fn() }));

import RecipeSheet from './RecipeSheet';
import { forgetDrafts } from './drafts';

const gin: RecipeLine = {
  id: 'l-gin', position: 0, role: 'stocked', inventoryId: GIN, label: 'gin', itemName: 'Plymouth gin', itemKind: 'spirit',
  qtyEntered: 50, unitCode: 'ml', qtyBase: 500, baseUnit: 'ml10', status: 'linked', costPerServe: 3, costBasis: 'lot_wac',
};

const negroni: CocktailRecipe = {
  cocktail: { id: CID, name: 'Negroni', price: 12, glass: 'Rocks', garnish: 'Orange peel', method: 'Stir with ice', description: null },
  current: {
    versionId: '44444444-4444-4444-8444-444444444444', version: 4, yieldServes: 1, method: 'Stir with ice',
    glass: 'Rocks', garnish: 'Orange peel', createdAt: '2026-11-07T10:00:00Z', lines: [gin],
  },
  cost: { perServe: 3, priced: 1, of: 1, complete: true },
  whatIsIn: {
    readable: true,
    figures: Object.fromEntries(
      ['energyKcal', 'fatG', 'saturatesG', 'carbohydrateG', 'sugarsG', 'proteinG', 'saltG'].map((k) => [k, { value: 1, atLeast: false, missing: [] }]),
    ) as never,
    notCounted: [],
    allergens: { sulphites: 'contains' },
    allergensUnstatedBy: [],
  },
  versionCount: 1,
  legacyLines: [],
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
}

const house = vi.hoisted(() => ({ code: 'GBP', createdAt: '2026-11-07T12:00:00Z' }));
const card = () => screen.getByTestId('recipe-card');

beforeEach(() => {
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: house.code, country: null, readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: { ...negroni, current: { ...negroni.current!, createdAt: house.createdAt } } };
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  h.taste.mockReset().mockResolvedValue({ state: 'absent' });
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  forgetDrafts();
  window.print = vi.fn();
  window.localStorage.clear();
});
afterEach(() => {
  document.documentElement.removeAttribute('data-print-card');
  house.code = 'GBP';
});

describe('the printable recipe card', () => {
  it('carries the name, serves, glass, build, method, garnish, allergens and version date, with no money by default', async () => {
    mount();
    await screen.findByTestId('recipe-print');
    expect(card()).toHaveTextContent('Negroni');
    expect(card()).toHaveTextContent('Makes 1 serve · Rocks · version 4');
    expect(card()).toHaveTextContent('50 ml Plymouth gin');
    expect(card()).toHaveTextContent('Stir with ice');
    expect(card()).toHaveTextContent('Garnish: Orange peel');
    expect(card()).toHaveTextContent('Contains sulphites');
    expect(card().textContent).not.toMatch(/£|Cost|Price|Pour cost|Margin/);
  });

  it('an owner or manager gets cost, price, pour cost and margin only once "Include cost" is ticked', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Include cost'));
    const cost = await screen.findByTestId('recipe-card-cost');
    expect(cost).toHaveTextContent('Cost per serve £3.00 · Price £12.00 · Pour cost 25.0% · Margin £9.00');
    fireEvent.click(screen.getByLabelText('Include cost'));
    expect(screen.queryByTestId('recipe-card-cost')).toBeNull();
  });

  it('staff get no box and no money on the card, whatever the read carried', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u2', role: 'staff' } };
    mount();
    await screen.findByTestId('recipe-print-button');
    expect(screen.queryByLabelText('Include cost')).toBeNull();
    expect(screen.queryByTestId('recipe-card-cost')).toBeNull();
    expect(card().textContent).not.toMatch(/£|Cost|Price|Pour cost|Margin/);
  });

  it('prints the saved version, not an unsaved draft, and only while the card is the thing being printed', async () => {
    mount();
    fireEvent.change((await screen.findAllByLabelText('Amount'))[0], { target: { value: '99' } });
    expect(card()).toHaveTextContent('50 ml Plymouth gin');
    expect(card().textContent).not.toContain('99');
    expect(document.documentElement).not.toHaveAttribute('data-print-card');
    fireEvent.click(screen.getByTestId('recipe-print-button'));
    expect(window.print).toHaveBeenCalledTimes(1);
    // paper hides every other child of <body>, so the card must be one (visibility alone left blank sheets)
    expect(card().parentElement).toBe(document.body);
    expect(document.documentElement).toHaveAttribute('data-print-card');
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-print-card'));
  });

  it('writes the version date in the house\'s locale, not the browser\'s: a lira house reads "7 Kas 2026", a pound house "7 Nov 2026"', async () => {
    house.code = 'TRY';
    const lira = mount();
    await screen.findByTestId('recipe-print');
    await waitFor(() => expect(card()).toHaveTextContent('version 4, 7 Kas 2026'));
    lira.unmount();
    house.code = 'GBP';
    mount();
    await waitFor(() => expect(card()).toHaveTextContent('version 4, 7 Nov 2026'));
  });

  it('says no date for a version whose date cannot be read', async () => {
    house.createdAt = 'not a date';
    mount();
    await screen.findByTestId('recipe-print');
    expect(card()).toHaveTextContent('version 4');
    expect(card().textContent).not.toMatch(/Invalid|NaN/);
    house.createdAt = '2026-11-07T12:00:00Z';
  });

  it('draws only on paper, on one page, without animation', () => {
    const css = readFileSync(join(__dirname, '../cellar-next.css'), 'utf8');
    expect(css).toMatch(/\.cl-print-card \{ display: none; \}/);
    // only the print block: CSS written after it (another register's sentence about motion) must not be read as print rules
    const print = css.slice(css.lastIndexOf('@media print {')).split('\n}\n')[0];
    expect(print).toMatch(/html\[data-print-card\] body > \*:not\(\.cl-print-card\) \{ display: none !important; \}/);
    expect(print).toMatch(/html\[data-print-card\] \.cl-print-card \{\s*display: block;/);
    expect(print).not.toMatch(/animation|transition/);
  });

  it('a pound house reads a day past the 12th day first, "21 Nov 2026", never "Nov 21, 2026"', async () => {
    house.createdAt = '2026-11-21T12:00:00Z';
    mount();
    await waitFor(() => expect(card()).toHaveTextContent('version 4, 21 Nov 2026'));
    expect(card().textContent).not.toMatch(/Nov 21/);
    house.createdAt = '2026-11-07T12:00:00Z';
  });

  describe('the Include cost box is remembered between cards (r106 drinks-7)', () => {
    const box = () => screen.getByLabelText('Include cost') as HTMLInputElement;

    it('stays ticked on the next card of the same person and house, and the cost line is drawn', async () => {
      const first = mount();
      await screen.findByTestId('recipe-print');
      expect(box().checked).toBe(false);
      fireEvent.click(box());
      first.unmount();
      mount();
      await screen.findByTestId('recipe-print');
      expect(box().checked).toBe(true);
      expect(screen.getByTestId('recipe-card-cost')).toBeInTheDocument();
    });

    it('is unticked again once unticked, and never carries to another person', async () => {
      const first = mount();
      await screen.findByTestId('recipe-print');
      fireEvent.click(box());
      fireEvent.click(box());
      first.unmount();
      mount();
      await screen.findByTestId('recipe-print');
      expect(box().checked).toBe(false);
      fireEvent.click(box());
      cleanup();
      h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u2', role: 'manager' } };
      mount();
      await screen.findByTestId('recipe-print');
      expect(box().checked).toBe(false);
    });

    it('staff still see no box and no money, whatever a browser holds', async () => {
      window.localStorage.setItem(`mudavym.recipeCard.includeCost.v1:u1:${RID}`, '1');
      h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u1', role: 'staff' } };
      mount();
      await screen.findByTestId('recipe-print');
      expect(screen.queryByLabelText('Include cost')).toBeNull();
      expect(screen.queryByTestId('recipe-card-cost')).toBeNull();
    });

    it('a browser that will not store it opens the box unticked and still prints', async () => {
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      mount();
      await screen.findByTestId('recipe-print');
      expect(box().checked).toBe(false);
      fireEvent.click(box());
      expect(box().checked).toBe(true);
      get.mockRestore();
      set.mockRestore();
    });
  });
});
