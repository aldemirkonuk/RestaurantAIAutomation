/**
 * Copy a drink (r107 drinks-g3, reworked r108 drinks-r108-4): the name is asked
 * first and nothing is written until Save. The register, the writes hook and
 * the recipe api are real; only the network and the list read are stubbed.
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

const COMPONENT = '55555555-5555-4555-8555-555555555555';
const nameBox = () => screen.getByLabelText('Name') as HTMLInputElement;
// Let any write a click started reach the network stub before "nothing was written" is read.
const settle = () => new Promise((r) => setTimeout(r, 60));
const save = () => fireEvent.click(screen.getByRole('button', { name: /Make the copy/ }));

describe('Copy a drink', () => {
  it('opens the form on the copy\'s name and writes nothing before Save', async () => {
    h.get.mockResolvedValue({ data: source(LINES) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    expect(nameBox().value).toBe('Whiskey Sour copy');
    expect((screen.getByLabelText('Price') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('cocktail-draft')).toHaveTextContent('A copy of “Whiskey Sour”');
    await settle();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('Leave it writes nothing and keeps no stray copy', async () => {
    h.get.mockResolvedValue({ data: source(LINES) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    fireEvent.click(screen.getByRole('button', { name: /Leave it/ }));
    expect(screen.queryByTestId('cocktail-draft')).toBeNull();
    await settle();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('Save writes the drink once under the typed name, then the same lines, once, on it', async () => {
    h.get.mockResolvedValue({ data: source(LINES) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    fireEvent.change(nameBox(), { target: { value: 'Sour No. 2' } });
    save();
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.post).toHaveBeenCalledTimes(1);
    const [url, body] = h.post.mock.calls[0];
    expect(url).toBe(`/cocktails/${RID}`);
    expect(body).toMatchObject({ name: 'Sour No. 2', menuSection: 'Sours', glass: 'Coupe', method: 'Shake', garnish: 'Cherry' });
    expect(body).not.toHaveProperty('price');
    expect(body).not.toHaveProperty('displayName');
    const [putUrl, put] = h.put.mock.calls[0];
    expect(putUrl).toContain(`/cocktails/${NEW}`);
    expect(put.expectedVersionId).toBeNull();
    expect(put.lines).toEqual([
      { role: 'stocked', inventoryId: 'inv-1', label: 'Bourbon', qty: 50, unit: 'ml' },
      { role: 'stocked', inventoryId: 'inv-2', label: 'Lemon', qty: 25, unit: 'ml' },
      { role: 'untracked', inventoryId: null, label: 'Bitters', qty: 2, unit: 'dash' },
    ]);
    expect(await screen.findByText('“Sour No. 2” is on this house’s list, with the recipe of “Whiskey Sour”.')).toBeTruthy();
    expect(screen.queryByTestId('cocktail-draft')).toBeNull();
  });

  it('carries a stocked line\'s usable share, so the copy costs what the source costs (r108 fix)', async () => {
    h.get.mockResolvedValue({ data: source([L({ usablePct: 40, qtyEntered: 120, unitCode: 'g' }), L({ id: 'l2', label: 'Lemon', inventoryId: 'inv-2' })]) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    save();
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][1].lines).toEqual([
      { role: 'stocked', inventoryId: 'inv-1', label: 'Bourbon', qty: 120, unit: 'g', usablePct: 40 },
      { role: 'stocked', inventoryId: 'inv-2', label: 'Lemon', qty: 50, unit: 'ml' },
    ]);
  });

  it('carries a made line as the same component id and unit, and never copies the component', async () => {
    const made = L({ id: 'l4', role: 'made', inventoryId: null, componentId: COMPONENT, label: 'Sour mix', itemName: null, qtyEntered: 22.5, unitCode: 'ml', status: 'linked' });
    h.get.mockResolvedValue({ data: source([L({}), made]) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    save();
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][1].lines).toEqual([
      { role: 'stocked', inventoryId: 'inv-1', label: 'Bourbon', qty: 50, unit: 'ml' },
      { role: 'made', inventoryId: null, componentId: COMPONENT, label: 'Sour mix', qty: 22.5, unit: 'ml' },
    ]);
    // One write of a drink (the copy), none of a component.
    expect(h.post).toHaveBeenCalledTimes(1);
    expect(h.post.mock.calls[0][0]).toBe(`/cocktails/${RID}`);
  });

  it('keeps the drink and says so when its recipe write is refused', async () => {
    h.get.mockResolvedValue({ data: source(LINES) });
    h.put.mockRejectedValue(new Error('nope'));
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    save();
    expect(await screen.findByText('The drink was made but its recipe was not copied. Open it and add the lines.')).toBeTruthy();
    expect(h.post).toHaveBeenCalledTimes(1);
  });

  it('a refused first write leaves the form open and says nothing was copied', async () => {
    h.get.mockResolvedValue({ data: source(LINES) });
    h.post.mockRejectedValue(new Error('refused'));
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    save();
    expect(await screen.findByText('Nothing was copied — refused. The list is unchanged.')).toBeTruthy();
    expect(h.put).not.toHaveBeenCalled();
    expect(nameBox().value).toBe('Whiskey Sour copy');
  });

  it('writes nothing when a made line names no component', async () => {
    h.get.mockResolvedValue({ data: source([L({ role: 'made', inventoryId: null, componentId: null })]) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    save();
    expect(await screen.findByText('This drink has a line a copy cannot carry yet, so nothing was copied.')).toBeTruthy();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it('writes nothing when a line points at an item that was archived since (r107f, #2173)', async () => {
    h.get.mockResolvedValue({ data: source([L({}), L({ id: 'l2', label: 'Lemon', itemGone: 'archived' })]) });
    mount();
    fireEvent.click(await screen.findByTestId('cocktail-copy'));
    save();
    expect(await screen.findByText(/archived or deleted/)).toBeTruthy();
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
