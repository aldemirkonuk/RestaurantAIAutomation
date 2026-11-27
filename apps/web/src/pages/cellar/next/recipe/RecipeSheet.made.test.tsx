/**
 * r106 drinks-2 (walk FAIL 16): a drink with a made line can be amended on the
 * web. The sheet carries the made line's component back on save, shows it as
 * "Counted from the mix" with its own cost, and never offers to switch it off.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const GIN = '33333333-3333-4333-8333-333333333333';
const MIX = '44444444-4444-4444-8444-4444444444aa';
const V1 = '55555555-5555-4555-8555-555555555555';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), auth: {} as Record<string, unknown>, taste: vi.fn(), roll: vi.fn() }));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: h.post },
  getErrorStatus: (e: unknown) => {
    const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof s === 'number' ? s : null;
  },
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: h.taste, rollupTaste: h.roll }));

import RecipeSheet from './RecipeSheet';
import { forgetDrafts } from './drafts';

const base = { position: 0, itemKind: null, status: 'linked', baseUnit: 'ml10' } as const;
const gin: RecipeLine = { ...base, id: 'l-gin', role: 'stocked', inventoryId: GIN, label: 'Gin', itemName: 'Gin', itemKind: 'spirit', qtyEntered: 50, unitCode: 'ml', qtyBase: 500, costPerServe: 0.5, costBasis: 'lot_wac' };
const mix: RecipeLine = { ...base, id: 'l-mix', role: 'made', inventoryId: null, componentId: MIX, componentName: 'House Sour Mix', label: 'House Sour Mix', itemName: null, qtyEntered: 30, unitCode: 'ml', qtyBase: 300, costPerServe: 0.11, costPerServeExact: 0.105, costBasis: 'component' };

const sourTest = (): CocktailRecipe => ({
  cocktail: { id: CID, name: 'Sour Test', price: 12, glass: null, garnish: null, method: null, description: null },
  current: { versionId: V1, version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '2026-11-07T10:00:00Z', lines: [gin, mix] },
  cost: { perServe: 0.61, perServeExact: 0.605, priced: 2, of: 2, complete: true },
  versionCount: 1,
  legacyLines: [],
});

function mount() {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: sourTest() };
    if (url === `/recipes/${RID}/cocktails/${CID}/versions`) return { data: [] };
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
}

beforeEach(() => {
  for (const f of [h.get, h.put, h.post, h.roll]) f.mockReset();
  h.taste.mockReset().mockResolvedValue({ state: 'absent' });
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  forgetDrafts();
});

describe('a drink with a made line, amended on the web', () => {
  it('shows the line as made in the house, counted from the mix, with its own cost, and no switch to turn it off', async () => {
    mount();
    expect(await screen.findByTestId('made-from')).toHaveTextContent('Made in the house: House Sour Mix');
    const sw = screen.getByRole('switch', { name: 'Counted from the mix' });
    expect(sw).toBeDisabled();
    expect(await screen.findByText(/from House Sour Mix\./)).toBeInTheDocument();
  });

  it('saves a new amount with the made line\'s component id, so the gateway does not refuse it', async () => {
    h.put.mockResolvedValue({ data: { versionId: 'v2', version: 2, lines: [] } });
    mount();
    await screen.findByTestId('made-from');
    fireEvent.change(screen.getAllByLabelText('Amount')[1], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put.mock.calls[0][1].lines).toEqual([
      { role: 'stocked', inventoryId: GIN, label: 'Gin', qty: 50, unit: 'ml', usablePct: null },
      { role: 'made', inventoryId: null, componentId: MIX, label: 'House Sour Mix', qty: 40, unit: 'ml' },
    ]);
  });

  it('a refused save erases nothing: the made line and its amount stay on the sheet', async () => {
    h.put.mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 400, data: { message: 'Ingredient 2 (House Sour Mix) names nothing it is made from.' } } }));
    mount();
    await screen.findByTestId('made-from');
    fireEvent.change(screen.getAllByLabelText('Amount')[1], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect((screen.getAllByLabelText('Amount')[1] as HTMLInputElement).value).toBe('40');
    expect(screen.getByTestId('made-from')).toBeInTheDocument();
  });
});
