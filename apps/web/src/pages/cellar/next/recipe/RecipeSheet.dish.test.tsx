/** The recipe sheet on a dish (ADR 0366): reads and writes under /dishes, no glass, its own drafts. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const RID = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const GIN = '33333333-3333-4333-8333-333333333333';
const V1 = '44444444-4444-4444-8444-444444444444';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), auth: {} as Record<string, unknown> }));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { get: h.get, put: h.put, post: h.post },
  getErrorStatus: (e: unknown) => {
    const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof s === 'number' ? s : null;
  },
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import RecipeSheet from './RecipeSheet';
import { draftKey, forgetDrafts, keepDraft } from './drafts';

const CUR = { versionId: V1, version: 1, yieldServes: 4, method: null, glass: null, garnish: null, createdAt: '', lines: [] };
const DISH_ANSWER = {
  dish: { id: ID, name: 'Lamb shank', section: 'Mains', price: 900, description: null },
  current: CUR,
  cost: null,
  versionCount: 1,
  legacyLines: [],
};

function serve(answer: unknown = DISH_ANSWER, shelf: unknown[] = []) {
  h.get.mockImplementation(async (url: string) => {
    if (url === `/recipes/${RID}/dishes/${ID}`) return { data: answer };
    if (url === `/recipes/${RID}/shelf`) return { data: shelf };
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'TRY', country: 'Turkey', readable: true, reason: null, statedAt: null } };
    throw new Error(`unexpected GET ${url}`);
  });
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.post.mockReset();
  h.auth = { activeRestaurantId: RID, activeRole: 'manager', user: { userId: 'u1', role: 'manager' } };
  forgetDrafts();
});

describe('RecipeSheet on a dish', () => {
  it('loads GET /recipes/<rid>/dishes/<id>, has no Glass row and says plates', async () => {
    serve();
    render(<RecipeSheet dishId={ID} />, { wrapper: wrapper() });
    expect(await screen.findByTestId('recipe-sheet')).toHaveAttribute('aria-label', 'Recipe for Lamb shank');
    expect(h.get).toHaveBeenCalledWith(`/recipes/${RID}/dishes/${ID}`);
    expect(screen.getByText('Makes (plates)')).toBeInTheDocument();
    expect(screen.queryByText('Makes (serves)')).toBeNull();
    expect(screen.queryByLabelText('Glass')).toBeNull();
    expect(screen.queryByText('Glass')).toBeNull();
    expect(screen.getByTestId('drink-cards')).toHaveAttribute('aria-label', 'This dish in figures');
  });

  it('Save PUTs to /dishes/<id> with no glass key, even when a glass is carried', async () => {
    serve({ ...DISH_ANSWER, current: { ...CUR, glass: 'Rocks' } }, [
      { id: GIN, name: 'Lamb shoulder', kind: 'food', uom: 'kg', bottleSizeMl: null },
    ]);
    h.put.mockResolvedValue({ data: { versionId: 'v2', version: 2, lines: [] } });
    render(<RecipeSheet dishId={ID} />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByRole('button', { name: /add an ingredient/i }));
    fireEvent.click(screen.getByRole('button', { name: /link it to your shelf/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Lamb shoulder/ }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    const [url, body] = h.put.mock.calls[0];
    expect(url).toBe(`/recipes/${RID}/dishes/${ID}`);
    expect(body).not.toHaveProperty('glass');
    expect(body.yieldServes).toBe(4);
    expect(body.expectedVersionId).toBe(V1);
  });

  it('a dish draft and a drink draft with the same id do not collide', async () => {
    const row = (qtyText: string) => ({ key: qtyText, role: 'stocked' as const, inventoryId: GIN, itemName: 'x', itemKind: 'food', label: 'x', qtyText, unit: 'kg' as const, saved: null });
    keepDraft(draftKey('u1', RID, ID), { rows: [row('55')], openedFrom: null, dirty: true, setAside: null });
    keepDraft(draftKey('u1', RID, `dish:${ID}`), { rows: [row('77')], openedFrom: V1, dirty: true, setAside: null });
    serve();
    render(<RecipeSheet dishId={ID} />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(1));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('77');
  });
});
