/**
 * r28 recipes audit, gap 7, slice 3, on the whole sheet: a kept weight is
 * read back into a clean sheet, and an unsaved draft keeps what was typed
 * while its lines on that good are priced again.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const GIN = '33333333-3333-4333-8333-333333333333';
const EGG = '44444444-4444-4444-8444-4444444444e9';
const V4 = '44444444-4444-4444-8444-444444444444';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: h.post },
  getErrorStatus: () => null,
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import RecipeSheet from './RecipeSheet';
import { forgetDrafts } from './drafts';

const gin: RecipeLine = {
  id: 'l-gin', position: 1, role: 'stocked', inventoryId: GIN, label: 'gin', itemName: 'gin', itemKind: 'spirit', itemUom: 'bottle',
  qtyEntered: 50, unitCode: 'ml', qtyBase: 500, baseUnit: 'ml10', status: 'linked', costPerServe: 20, costBasis: 'lot_wac',
};
const egg = (priced: boolean): RecipeLine => ({
  id: 'l-egg', position: 2, role: 'stocked', inventoryId: EGG, label: 'Egg white', itemName: 'Eggs', itemKind: 'food', itemUom: 'kg',
  qtyEntered: 1, unitCode: 'each', qtyBase: 1000, baseUnit: 'each_milli', status: 'linked',
  costPerServe: priced ? 3 : null, costBasis: priced ? 'lot_wac' : 'unit_mismatch', needs: priced ? null : 'piece_grams',
  itemPieceGrams: priced ? 60 : null,
});
const sour = (priced: boolean): CocktailRecipe => ({
  cocktail: { id: CID, name: 'Gin Sour', price: 400, glass: null, garnish: null, method: null, description: null },
  current: { versionId: V4, version: 4, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '2026-11-07T10:00:00Z', lines: [gin, egg(priced)] },
  cost: priced ? { perServe: 23, priced: 2, of: 2, complete: true } : { perServe: null, priced: 1, of: 2, complete: false },
  versionCount: 1,
  legacyLines: [],
});

let recipe = sour(false);
function mount() {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: recipe };
    if (url === `/recipes/${RID}/cocktails/${CID}/versions`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
}

beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.post.mockReset();
  h.post.mockResolvedValue({ data: { perServe: null, priced: 1, of: 2, complete: false, lines: [] } });
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  recipe = sour(false);
  forgetDrafts();
});

const weighNote = /Say what one weighs, and every drink with Eggs is priced from that/;

describe('the sheet and a kept weight', () => {
  it('a clean sheet reads the line back priced once one egg\'s weight is kept', async () => {
    mount();
    expect(await screen.findByText(weighNote)).toBeTruthy();
    h.put.mockImplementation(async () => {
      recipe = sour(true);
      return { data: { id: EGG, pieceGrams: 60, mlGrams: null } };
    });
    fireEvent.change(screen.getByLabelText('Eggs: one piece weighs'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByText(weighNote)).toBeNull());
    expect(screen.queryByTestId('recipe-line-weigh')).toBeNull();
    expect(h.put).toHaveBeenCalledWith(`/recipes/${RID}/items/${EGG}/weights`, { pieceGrams: 60 });
  });

  it('an unsaved draft keeps what was typed, and its egg line stops asking once the weight is kept', async () => {
    mount();
    expect(await screen.findByText(weighNote)).toBeTruthy();
    // The gin line is typed: the draft is now unsaved, and is never replaced by a read.
    fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '45' } });
    h.put.mockResolvedValue({ data: { id: EGG, pieceGrams: 60, mlGrams: null } });
    fireEvent.change(screen.getByLabelText('Eggs: one piece weighs'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(screen.queryByText(weighNote)).toBeNull());
    expect((screen.getAllByLabelText('Amount')[0] as HTMLInputElement).value).toBe('45');
    expect(screen.getAllByTestId('recipe-line')).toHaveLength(2);
  });

  it('staff see no weight box and no sentence about it', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u2', role: 'staff' } };
    mount();
    await screen.findAllByTestId('recipe-line');
    expect(screen.queryByTestId('recipe-line-weigh')).toBeNull();
    expect(screen.queryByText(weighNote)).toBeNull();
  });
});
