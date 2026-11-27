/** r109 drinks-g1: the sheet sets a line's usable share, and a save no longer wipes it (a missing one saves as null). */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const GIN = '33333333-3333-4333-8333-333333333333';
const LIME = '44444444-4444-4444-8444-444444444444';
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

import RecipeSheet, { costPreviewBody, withSavedUsable } from './RecipeSheet';
import { draftId, draftKey, forgetDrafts, keepDraft, takeDraft } from './drafts';
import { readUsable, type DraftRow } from './LineRow';
import { copyRecipeBody } from './copyDrink';

const base = { position: 0, itemKind: 'spirit', status: 'linked', baseUnit: 'ml10' } as const;
const gin: RecipeLine = { ...base, id: 'l-gin', role: 'stocked', inventoryId: GIN, label: 'Gin', itemName: 'Gin', qtyEntered: 50, unitCode: 'ml', qtyBase: 500, usablePct: null, costPerServe: 0.5, costBasis: 'lot_wac' };
const lime: RecipeLine = { ...base, id: 'l-lime', position: 1, role: 'stocked', inventoryId: LIME, label: 'Lime juice', itemName: 'Limes', qtyEntered: 25, unitCode: 'ml', qtyBase: 250, usablePct: 45, costPerServe: 0.2, costBasis: 'lot_wac' };

const drink = (): CocktailRecipe => ({
  cocktail: { id: CID, name: 'Gimlet', price: 12, glass: null, garnish: null, method: null, description: null },
  current: { versionId: V1, version: 1, yieldServes: 1, method: null, glass: null, garnish: null, createdAt: '2026-11-07T10:00:00Z', lines: [gin, lime] },
  cost: { perServe: 0.7, perServeExact: 0.7, priced: 2, of: 2, complete: true },
  versionCount: 1,
  legacyLines: [],
});

function mount() {
  h.get.mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: 'UK', readable: true, reason: null, statedAt: null } };
    if (url === `/recipes/${RID}/cocktails/${CID}`) return { data: drink() };
    if (url === `/recipes/${RID}/cocktails/${CID}/versions`) return { data: [] };
    if (url === `/recipes/${RID}/shelf`) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  h.post.mockResolvedValue({ data: { perServe: 0.7, perServeExact: 0.7, priced: 2, of: 2, complete: true, lines: [] } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<RecipeSheet cocktailId={CID} />, { wrapper: wrap });
}

const usableBoxes = () => screen.getAllByLabelText('Usable %') as HTMLInputElement[];
const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
  return h.put.mock.calls[0][1].lines as Array<Record<string, unknown>>;
};

beforeEach(() => {
  for (const f of [h.get, h.put, h.post, h.roll]) f.mockReset();
  h.taste.mockReset().mockResolvedValue({ state: 'absent' });
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  h.put.mockResolvedValue({ data: { versionId: 'v2', version: 2, lines: [] } });
  forgetDrafts();
});

describe('a line keeps its usable share through a sheet save', () => {
  it('a 45% line round-trips into the save body untouched while another line is edited', async () => {
    mount();
    await screen.findAllByLabelText('Usable %');
    expect(usableBoxes().map((b) => b.value)).toEqual(['', '45']);
    fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '45' } });
    const lines = await save();
    expect(lines.map((l) => l.usablePct)).toEqual([null, 45]);
  });

  it('a share typed in the house form ("45,5") is saved as 45.5, and an emptied box as all of it', async () => {
    mount();
    await screen.findAllByLabelText('Usable %');
    fireEvent.change(usableBoxes()[0], { target: { value: '45,5' } });
    fireEvent.change(usableBoxes()[1], { target: { value: '' } });
    const lines = await save();
    expect(lines.map((l) => l.usablePct)).toEqual([45.5, null]);
  });

  it('bad text says so, and Save stays off', async () => {
    mount();
    await screen.findAllByLabelText('Usable %');
    fireEvent.change(usableBoxes()[1], { target: { value: '140' } });
    expect(usableBoxes()[1]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('Usable share is a percent from 1 to 100.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(h.put).not.toHaveBeenCalled();
  });

  it('the draft is priced with the share as typed', async () => {
    mount();
    await screen.findAllByLabelText('Usable %');
    fireEvent.change(usableBoxes()[1], { target: { value: '50' } });
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    const body = h.post.mock.calls.at(-1)![1];
    expect(body.lines.map((l: { usablePct?: number | null }) => l.usablePct)).toEqual([null, 50]);
  });

  it('staff read the line as "45% usable", with no box', async () => {
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u2', role: 'staff' } };
    mount();
    expect(await screen.findByTestId('recipe-line-usable')).toHaveTextContent('45.0% usable');
    expect(screen.queryByLabelText('Usable %')).toBeNull();
  });

  it('a kept draft from before the share existed takes the saved 45 for the same good at the same place', async () => {
    const old = (l: RecipeLine, k: string): DraftRow => ({
      key: k, role: 'stocked', inventoryId: l.inventoryId, itemName: l.itemName, itemKind: l.itemKind, label: l.label,
      qtyText: String(l.qtyEntered), storedQty: l.qtyEntered, unit: 'ml', saved: null,
    });
    keepDraft(draftKey('u1', RID, draftId(CID)), { rows: [old(gin, 'a'), old(lime, 'b')], openedFrom: V1, dirty: true, setAside: null });
    mount();
    await waitFor(() => expect(usableBoxes().map((b) => b.value)).toEqual(['', '45']));
    const lines = await save();
    expect(lines.map((l) => l.usablePct)).toEqual([null, 45]);
    expect(takeDraft(draftKey('u1', RID, draftId(CID)))).toBeNull();
  });
});

describe('the pure parts', () => {
  const row = (p: Partial<DraftRow>): DraftRow => ({
    key: 'k', role: 'stocked', inventoryId: LIME, itemName: 'Limes', itemKind: null, label: 'Lime', qtyText: '25', unit: 'ml', saved: null, ...p,
  });

  it('reads a share in either mark, 1 to 100, two decimals at most', () => {
    expect(readUsable('45')).toBe(45);
    expect(readUsable(' 45,5 ')).toBe(45.5);
    expect(readUsable('45.25')).toBe(45.25);
    expect(readUsable('')).toBeNull();
    for (const bad of ['0', '0,5', '100,5', '101', '45.125', 'abc', '-5', '4 5']) expect(readUsable(bad)).toBe('bad');
  });

  it('the preview body carries the share, and a bad one is not priced', () => {
    expect(costPreviewBody([row({ usablePct: 45 })], 1)?.body.lines[0]).toEqual({ role: 'stocked', inventoryId: LIME, qtyEntered: 25, unitCode: 'ml', usablePct: 45 });
    expect(costPreviewBody([row({ usableText: '0' })], 1)).toBeNull();
  });

  it('a copied drink carries the share, so the copy costs what its source does', () => {
    const body = copyRecipeBody(drink());
    expect(body !== null && body !== 'cannot' && body.lines.map((l) => l.usablePct)).toEqual([null, 45]);
  });

  it('a kept line on a different good, or at another place, takes null, never another line\'s share', () => {
    const out = withSavedUsable([row({ inventoryId: GIN }), row({}), row({ role: 'untracked', inventoryId: null })], [lime, gin]);
    expect(out.map((r) => r.usablePct)).toEqual([null, null, null]);
    const same = withSavedUsable([row({ inventoryId: GIN }), row({})], [gin, lime]);
    expect(same.map((r) => r.usablePct)).toEqual([null, 45]);
  });
});
