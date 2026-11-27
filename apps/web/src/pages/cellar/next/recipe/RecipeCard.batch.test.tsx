/** r109 drinks-g2: the card's Batch for a bottle. Any role reads it; only an owner or manager under Include cost sees its cost. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

const line = (id: string, name: string): RecipeLine => ({
  id, position: 0, role: 'stocked', inventoryId: `inv-${id}`, label: name, itemName: name, itemKind: 'spirit',
  qtyEntered: 30, unitCode: 'ml', qtyBase: 300, baseUnit: 'ml10', status: 'linked', costPerServe: 1, costBasis: 'lot_wac',
});
const negroni = (): CocktailRecipe => ({
  cocktail: { id: CID, name: 'Negroni', price: 12, glass: 'Rocks', garnish: null, method: null, description: null },
  current: { versionId: 'v1', version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '2026-11-07T10:00:00Z',
    lines: [line('g', 'Gin'), line('c', 'Campari'), line('v', 'Vermouth')] },
  cost: { perServe: 3, perServeExact: 3.004, priced: 3, of: 3, complete: true },
  versionCount: 1,
  legacyLines: [],
});

function mount(role: 'manager' | 'staff') {
  h.auth = { activeRestaurantId: RID, activeRole: role, user: { userId: 'u1', role } };
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: null, readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: role === 'staff' ? { ...negroni(), cost: null, cocktail: { ...negroni().cocktail, price: null } } : negroni() };
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
}

beforeEach(() => {
  h.get.mockReset();
  h.taste.mockReset().mockResolvedValue({ state: 'absent' });
  window.localStorage.clear();
  forgetDrafts();
});

const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Batch for a bottle' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stirred 20%' }));
};

describe('Batch for a bottle on the card', () => {
  it('staff read the batch and its parts, and never a cost', async () => {
    mount('staff');
    await open();
    const said = screen.getByTestId('recipe-batch-said');
    expect(said).toHaveTextContent('1 l bottle: 9 serves, pour 108 ml. Gin 270 ml, Campari 270 ml, Vermouth 270 ml, Water 162 ml. 28 ml spare.');
    expect(screen.queryByTestId('recipe-batch-cost')).toBeNull();
    expect(screen.queryByLabelText('Include cost')).toBeNull();
    expect(screen.getByTestId('recipe-card-batch')).not.toHaveTextContent(/cost|£/i);
  });

  it('an owner or manager sees the cost only under Include cost, at the exact serve cost times the serves', async () => {
    mount('manager');
    await open();
    expect(screen.queryByTestId('recipe-batch-cost')).toBeNull();
    fireEvent.click(screen.getByLabelText('Include cost'));
    expect(screen.getByTestId('recipe-batch-cost')).toHaveTextContent('9 serves cost £27.04 at today\'s prices');
    expect(within(screen.getByTestId('recipe-card-batch')).getByText(/9 serves cost £27\.04/)).toBeInTheDocument();
  });

  it('a line unticked leaves the bottle, and the figures snap', async () => {
    mount('staff');
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vermouth' }));
    fireEvent.click(screen.getByRole('button', { name: '70 cl' }));
    expect(screen.getByTestId('recipe-batch-said')).toHaveTextContent('70 cl bottle: 9 serves, pour 72 ml.');
    expect(screen.getByTestId('recipe-batch-said')).toHaveTextContent('Add at service, each serve: Vermouth 30 ml.');
  });

  it('a bad bottle says so and prints no batch', async () => {
    mount('staff');
    await open();
    fireEvent.change(screen.getByLabelText('Bottle ml'), { target: { value: '0' } });
    expect(screen.getByTestId('recipe-batch-said')).toHaveTextContent('A bottle is a whole number of ml from 1 to 20,000.');
    expect(screen.queryByTestId('recipe-card-batch')).toBeNull();
  });
});
