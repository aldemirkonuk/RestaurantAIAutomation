/**
 * The recipe sheet's reads.
 *
 * Keys are tenant-first, as `useCellarNextData.ts` keys the cellar's own reads
 * (`['cellar', 'register', activeRestaurantId, …]`), so a house switch never
 * shows the previous house's shelf:
 *   ['recipes', 'shelf', activeRestaurantId, search]         the shelf picker
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { recipesApi } from '../../../../services/api/recipes';

/** The gateway's own sentence when it sent one, else the error's message. */
export function reason(e: unknown): string | null {
  if (!e) return null;
  const said = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof said === 'string' && said.trim()) return said.trim();
  return e instanceof Error ? e.message : 'no reason given';
}

export function useShelf(search: string, enabled: boolean) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['recipes', 'shelf', activeRestaurantId ?? null, search],
    enabled: enabled && Boolean(activeRestaurantId),
    queryFn: () => recipesApi.shelf(activeRestaurantId as string, search),
    staleTime: 30_000,
  });
  return { data: q.data ?? null, loading: q.isLoading && enabled, error: q.isError ? reason(q.error) : null };
}
