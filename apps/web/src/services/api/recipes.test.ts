/** recipesApi builds a path per owner kind and reads a dish into the cocktail shape (ADR 0366). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('./client', () => ({ apiClient: h }));

import { recipesApi } from './recipes';

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset().mockResolvedValue({ data: [] }));
});

describe('recipesApi owners', () => {
  it('a bare string and a cocktail owner use cocktails/; a dish owner uses dishes/ on every method', async () => {
    await recipesApi.versions('r1', 'c1');
    await recipesApi.versions('r1', { kind: 'dish', id: 'd 1' });
    await recipesApi.version('r1', { kind: 'dish', id: 'd1' }, 'v1');
    await recipesApi.save('r1', { kind: 'dish', id: 'd1' }, { expectedVersionId: null, yieldServes: 1, lines: [] });
    await recipesApi.previewCost('r1', { kind: 'dish', id: 'd1' }, { yieldServes: 1, lines: [] });
    expect(h.get.mock.calls.map((c) => c[0])).toEqual([
      '/recipes/r1/cocktails/c1/versions',
      '/recipes/r1/dishes/d%201/versions',
      '/recipes/r1/dishes/d1/versions/v1',
    ]);
    expect(h.put.mock.calls[0][0]).toBe('/recipes/r1/dishes/d1');
    expect(h.post.mock.calls[0][0]).toBe('/recipes/r1/dishes/d1/cost-preview');
  });

  it('a dish read becomes the cocktail shape with kind dish; a cocktail read has no kind', async () => {
    h.get.mockResolvedValueOnce({ data: { dish: { id: 'd1', name: 'Lamb', section: 'Mains', price: 9, description: 'slow' }, current: null, cost: null, versionCount: 0, legacyLines: [] } });
    const r = await recipesApi.get('r1', { kind: 'dish', id: 'd1' });
    expect(h.get).toHaveBeenCalledWith('/recipes/r1/dishes/d1');
    expect(r.kind).toBe('dish');
    expect(r.cocktail).toEqual({ id: 'd1', name: 'Lamb', price: 9, glass: null, garnish: null, method: null, description: 'slow' });
    h.get.mockResolvedValueOnce({ data: { cocktail: { id: 'c1' } } });
    expect((await recipesApi.get('r1', 'c1')).kind).toBeUndefined();
  });
});
