/**
 * Copy a drink (r107 drinks-g3). The register, the writes hook and the recipe
 * api are real; only the network and the list read are stubbed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { CocktailRecipe, RecipeLine } from '../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const SRC = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';
const role = vi.hoisted(() => ({ edit: true }));
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: h.post, patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'manager', user: { role: 'manager' } }),
}));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => <div data-testid="sheet" /> }));
vi.mock('./recipe/useRecipe', async (orig) => ({
  ...(await orig<typeof import('./recipe/useRecipe')>()),
  useCanEditRecipe: () => role.edit,
  useDrinkFigures: () => ({ byId: null }),
  useMenuPrices: () => ({ byId: null, currentMenus: 0 }),
}));
vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<typeof import('./useCellarNextData')>()),
  useCocktailRegister: () => ({
    data: {
      rows: [{ id: SRC, name: 'Whiskey Sour', display_name: null, menu_section: 'Sours', method: 'Shake', glass: 'Coupe', garnish: 'Cherry', price: 14 }],
      count: 1, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '',
    },
    loading: false,
    error: null,
  }),
}));

import CocktailRegister from './CocktailRegister';
import { COPY_CANNOT_CARRY } from './recipe/copyDrink';

const L = (over: Partial<RecipeLine>): RecipeLine => ({
  id: 'l', position: 0, role: 'stocked', inventoryId: 'inv-1', label: 'Bourbon', itemName: 'Bourbon', itemKind: 'spirit',
  qtyEntered: 50, unitCode: 'ml', qtyBase: 500, baseUnit: 'ml10', status: 'linked', costPerServe: 1.5, costBasis: 'x', ...over,
});

const source = (lines: RecipeLine[]): CocktailRecipe => ({
  cocktail: { id: SRC, name: 'Whiskey Sour', price: 14, glass: null, garnish: null, method: null, description: null },
  current: { versionId: 'v1', version: 1, yieldServes: 1, method: 'Shake hard', glass: 'Coupe', garnish: 'Cherry', createdAt: '', lines },
  cost: { perServe: 2.11, perServeExact: 2.11, priced: 2, of: 2, complete: true, partial: 0 },
  versionCount: 1, legacyLines: [],
});

const LINES = [L({}), L({ id: 'l2', label: 'Lemon', inventoryId: 'inv-2', qtyEntered: 25, costPerServe: 0.61 }), L({ id: 'l3', label: 'Bitters', role: 'untracked', inventoryId: null, status: 'untracked', qtyEntered: 2, unitCode: 'dash', costPerServe: null })];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cocktails?open=' + SRC]}>
        <CocktailRegister register={null} registerLoading={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role.edit = true;
  h.get.mockReset(); h.put.mockReset(); h.post.mockReset();
  h.post.mockResolvedValue({ data: { id: NEW } });
  h.put.mockResolvedValue({ data: { versionId: 'v9' } });
});

describe('Copy a drink', () => {
  it('makes a new drink and writes the same lines, once, on it', async () => {
    h.get.mockResolvedValue({ data: source(LINES) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.post).toHaveBeenCalledTimes(1);
    const [url, body] = h.post.mock.calls[0];
    expect(url).toBe(`/cocktails/${RID}`);
    expect(body).toMatchObject({ name: 'Whiskey Sour copy', menuSection: 'Sours', glass: 'Coupe', method: 'Shake', garnish: 'Cherry' });
    expect(body).not.toHaveProperty('price');
    const [putUrl, put] = h.put.mock.calls[0];
    expect(putUrl).toContain(`/cocktails/${NEW}`);
    expect(put.expectedVersionId).toBeNull();
    expect(put.lines).toEqual([
      { role: 'stocked', inventoryId: 'inv-1', label: 'Bourbon', qty: 50, unit: 'ml' },
      { role: 'stocked', inventoryId: 'inv-2', label: 'Lemon', qty: 25, unit: 'ml' },
      { role: 'untracked', inventoryId: null, label: 'Bitters', qty: 2, unit: 'dash' },
    ]);
    expect(await screen.findByText(/was copied\. Give the copy its name/)).toBeTruthy();
    expect((screen.getByDisplayValue('Whiskey Sour copy') as HTMLInputElement).value).toBe('Whiskey Sour copy');
  });

  it('keeps the drink and says so when its recipe write is refused', async () => {
    h.get.mockResolvedValue({ data: source(LINES) });
    h.put.mockRejectedValue(new Error('nope'));
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    expect(await screen.findByText('The drink was made but its recipe was not copied. Open it and add the lines.')).toBeTruthy();
    expect(h.post).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when a line cannot be carried', async () => {
    h.get.mockResolvedValue({ data: source([L({ role: 'made' as never })]) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    expect(await screen.findByText(COPY_CANNOT_CARRY)).toBeTruthy();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('carries how much of a line is usable, so the copy costs what its source does (r107f)', async () => {
    h.get.mockResolvedValue({ data: source([L({ label: 'Lemon', inventoryId: 'inv-2', usablePct: 45 }), L({ id: 'l2', usablePct: null })]) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][1].lines).toEqual([
      { role: 'stocked', inventoryId: 'inv-2', label: 'Lemon', qty: 50, unit: 'ml', usablePct: 45 },
      { role: 'stocked', inventoryId: 'inv-1', label: 'Bourbon', qty: 50, unit: 'ml' },
    ]);
  });

  it('writes nothing when a line points at an item that was archived since (r107f)', async () => {
    h.get.mockResolvedValue({ data: source([L({}), L({ id: 'l2', label: 'Lemon', itemGone: 'archived' })]) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    expect(await screen.findByText(COPY_CANNOT_CARRY)).toBeTruthy();
    expect(COPY_CANNOT_CARRY).toMatch(/archived or deleted/);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('shows staff no Copy button', async () => {
    role.edit = false;
    mount();
    await screen.findByTestId('cocktail-leaf');
    expect(screen.queryByTestId('cocktail-copy')).toBeNull();
  });
});
