/** r110 drinks-5: an earlier version's date is written in the house's form, as its money is. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown>, taste: vi.fn() }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get, put: vi.fn(), post: vi.fn() }, getErrorStatus: () => null }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: h.taste, rollupTaste: vi.fn() }));

import RecipeSheet from './RecipeSheet';
import { forgetDrafts } from './drafts';

const gin = (qty: number): RecipeLine => ({
  id: `l${qty}`, position: 0, role: 'stocked', inventoryId: 'g1', label: 'gin', itemName: 'Plymouth gin', itemKind: 'spirit',
  qtyEntered: qty, unitCode: 'ml', qtyBase: qty * 10, baseUnit: 'ml10', status: 'linked', costPerServe: 1, costBasis: 'lot_wac',
});
const ver = (id: string, n: number, qty: number) => ({ versionId: id, version: n, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '2026-11-07T10:00:00Z', lines: [gin(qty)] });

function mount(code: string) {
  const role = 'manager' as const;
  const pastComplete = true;
  h.auth = { activeRestaurantId: RID, activeRole: role, user: { userId: 'u', role } };
  const money = role === 'manager';
  const recipe: CocktailRecipe = {
    cocktail: { id: CID, name: 'Martini', price: money ? 12 : null, glass: null, garnish: null, method: null, description: null },
    current: ver('v2', 2, 45),
    cost: money ? { perServe: 1.12, perServeExact: 1.124, priced: 1, of: 1, complete: true } : null,
    versionCount: 2,
    legacyLines: [],
  };
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code, country: null, readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: recipe };
    if (url === `/recipes/${RID}/cocktails/${CID}/versions`) return { data: [{ versionId: 'v2', version: 2, createdAt: '2026-11-07T10:00:00Z', lineCount: 1 }, { versionId: 'v1', version: 1, createdAt: '2026-11-27T12:04:00Z', lineCount: 1 }] };
    if (url === `/recipes/${RID}/cocktails/${CID}/versions/v1`) {
      return { data: { version: ver('v1', 1, 50), cost: money ? { perServe: 1.25, perServeExact: 1.254, priced: 1, of: pastComplete ? 1 : 2, complete: pastComplete } : null } };
    }
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
}


beforeEach(() => {
  h.get.mockReset();
  h.taste.mockReset().mockResolvedValue({ state: 'absent' });
  forgetDrafts();
});

const row = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Earlier versions/ }));
  return (await screen.findByRole('button', { name: /Version 1/ })).textContent ?? '';
};

describe('the Earlier versions row writes its date in the house form (r110 drinks-5)', () => {
  it('a lira house reads 27 Kas 2026, as its spec book does', async () => {
    mount('TRY');
    expect(await row()).toMatch(/27 Kas 2026/);
  });

  it('a dollar house reads Nov 27, 2026, as before', async () => {
    mount('USD');
    expect(await row()).toMatch(/Nov 27, 2026/);
  });
});
