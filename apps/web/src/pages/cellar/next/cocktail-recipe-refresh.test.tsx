/**
 * After "Record the recipe", the open leaf re-reads the recipe (F-917).
 *
 * The leaf reads one cocktail's lines under ['cellar','recipe',rid,id]. The
 * save used to refresh only the list and the register, so the leaf kept the
 * old lines, or "no recipe", right under a line saying the recipe was saved.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: 'staff', user: null }),
}));
const put = vi.hoisted(() => vi.fn());
vi.mock('../../../services/api/client', () => ({ apiClient: { put } }));

import { useCocktailWrites } from './useCellarNextData';

describe('recording a recipe', () => {
  it('re-reads the open recipe as well as the list', async () => {
    put.mockResolvedValue({ data: { lines: 2 } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCocktailWrites(), { wrapper });
    await act(async () => {
      await result.current.setRecipe.mutateAsync({ id: 'c1', lines: [] });
    });
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(['cellar', 'recipe', 'r1', 'c1']);
    expect(keys).toContainEqual(['cellar', 'cocktails', 'r1']);
  });
});
