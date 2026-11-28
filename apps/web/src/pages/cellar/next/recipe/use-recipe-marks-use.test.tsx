/**
 * A recipe save or a dish removal marks a good's "Used in" stale, so a drawer opened (or a hover
 * warmed) before the write is read again (r106 g2). Each case fails without the call in useRecipe.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRemoveDish, useSaveRecipe } from './useRecipe';
import { inventoryItemKeys } from '../../../../services/api/inventory';

const api = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: 'r1', user: { userId: 'u1' } }) }));
vi.mock('../../../../services/api/recipes', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recipesApi: { save: api.save },
  dishesApi: { remove: api.remove },
}));

const usedIn = inventoryItemKeys.usedIn('r1', 'g');
const setup = () => {
  const qc = new QueryClient();
  qc.setQueryData(usedIn, { warm: true });
  qc.setQueryData([...usedIn, 'dishes'], { dishes: [] });
  qc.setQueryData(inventoryItemKeys.figures('r1', 'g'), { warm: true });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
};
const stale = (qc: QueryClient, k: readonly unknown[]) => qc.getQueryState(k)?.isInvalidated === true;

afterEach(cleanup);

describe('a recipe write marks the goods it touches stale', () => {
  it('saving a recipe line marks used-in, dishes and figures stale', async () => {
    api.save.mockReset().mockResolvedValue({});
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useSaveRecipe('c1'), { wrapper });
    await act(async () => { await result.current.mutateAsync({ lines: [] } as never); });
    expect([stale(qc, usedIn), stale(qc, [...usedIn, 'dishes']), stale(qc, inventoryItemKeys.figures('r1', 'g'))]).toEqual([true, true, true]);
  });

  it('removing a dish marks used-in stale', async () => {
    api.remove.mockReset().mockResolvedValue({});
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useRemoveDish('d1'), { wrapper });
    await act(async () => { await result.current.mutateAsync(); });
    expect(stale(qc, usedIn)).toBe(true);
  });
});
