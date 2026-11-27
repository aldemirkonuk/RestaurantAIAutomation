/**
 * r110 drinks-7 (closes the #2368 loop on /dishes): the page's own recipe view
 * is the same sheet, so it reads and shows a line's usable share, a save sends
 * it back untouched, and after the save the row's cost, the sheet's cost card
 * and the saved line say one figure. Salmon plate: 180 g fillet at a 45 %
 * usable share (8.00 a plate, over the 400 g bought) and 20 g of oil.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
const DISH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FISH = '33333333-3333-4333-8333-333333333333';
const OIL = '44444444-4444-4444-8444-444444444444';
const V1 = '55555555-5555-4555-8555-555555555555';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: h.post, patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('../../services/api/taste', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTaste: vi.fn().mockResolvedValue({ state: 'absent' }),
  rollupTaste: vi.fn(),
}));

import DishesPage from './DishesPage';

const base = { position: 0, itemKind: 'food', status: 'linked', baseUnit: 'mg', costBasis: 'lot_wac' } as const;
const lines = (oil: number) => [
  { ...base, id: 'l-fish', role: 'stocked', inventoryId: FISH, label: 'Salmon fillet', itemName: 'Salmon fillet', qtyEntered: 180, unitCode: 'g', qtyBase: 180000, usablePct: 45, costPerServe: 8 },
  { ...base, id: 'l-oil', position: 1, role: 'stocked', inventoryId: OIL, label: 'Oil', itemName: 'Oil', qtyEntered: 20, unitCode: 'g', qtyBase: 20000, usablePct: null, costPerServe: oil },
];
const costOf = (oil: number) => ({ perServe: 8 + oil, perServeExact: 8 + oil, priced: 2, of: 2, complete: true });
let oilCost = 0.4;

const recipe = () => ({
  dish: { id: DISH, name: 'Salmon plate', section: 'Mains', price: 20, description: null },
  current: { versionId: V1, version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '2026-11-07T10:00:00Z', lines: lines(oilCost) },
  cost: costOf(oilCost),
  versionCount: 1,
  legacyLines: [],
});
const row = () => ({ id: DISH, name: 'Salmon plate', section: 'Mains', price: 20, hasRecipe: true, yieldServes: 1, lineCount: 2, cost: costOf(oilCost), allergens: null });

beforeEach(() => {
  oilCost = 0.4;
  for (const f of [h.get, h.put, h.post]) f.mockReset();
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: 'UK', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/dishes`) return { data: [row()] };
    if (url === `/recipes/${RID}/dishes/figures`) return { data: { costsUnread: false, dishes: [{ dishId: DISH, ...row() }] } };
    if (url === `/recipes/${RID}/dishes/${DISH}`) return { data: recipe() };
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    if (url === `/recipes/${RID}/dishes/${DISH}/versions`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  h.post.mockResolvedValue({ data: { ...costOf(oilCost), lines: [] } });
  h.put.mockImplementation(async () => {
    oilCost = 0.8; // the saved amount of oil doubled; the gateway prices the saved lines
    return { data: { versionId: 'v2', version: 2, lines: [] } };
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/dishes?open=${DISH}`]}>
        <DishesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const money = (el: HTMLElement) => (el.textContent ?? '').match(/\d+[.,]\d\d/)?.[0];
const rowCost = () => within(screen.getByTestId(`dish-row-${DISH}`)).getAllByRole('cell').map((c) => money(c)).filter(Boolean);

describe('/dishes: a line keeps its usable share and every cost says the sheet\'s', () => {
  it('the dish\'s own sheet shows the 45 % share, and the row, the sheet card and the lines add to one cost', async () => {
    mount();
    const boxes = (await screen.findAllByLabelText('Usable %')) as HTMLInputElement[];
    expect(boxes.map((b) => b.value)).toEqual(['45', '']);
    const card = await screen.findByTestId('drink-card-cost');
    expect(money(card)).toBe('8.40');
    // The row's cost cell is the figures read's cost, written the same way.
    await waitFor(() => expect(rowCost()).toContain('8.40'));
  });

  it('a save sends the 45 % back, and afterwards the row and the sheet card both say the new cost', async () => {
    mount();
    await screen.findAllByLabelText('Usable %');
    fireEvent.change(screen.getAllByLabelText('Amount')[1], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const sent = h.put.mock.calls[0][1].lines as Array<Record<string, unknown>>;
    expect(sent.map((l) => l.usablePct)).toEqual([45, null]);
    await waitFor(() => expect(money(screen.getByTestId('drink-card-cost'))).toBe('8.80'));
    await waitFor(() => expect(rowCost()).toContain('8.80'));
    expect(rowCost()).not.toContain('8.40');
  });
});
