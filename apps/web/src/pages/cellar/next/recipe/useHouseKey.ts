/**
 * The house's country and money code, for the standard-drinks line (r110
 * drinks-g1). The same query `useHousePercent` and `useHouseMoney` read, so the
 * three never disagree about which house this is.
 *
 * Undefined while it is read: the card holds the line's room and says nothing.
 * A failed read answers country null, so the card gives the grams only and no
 * country's standard drink is guessed.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { settingsApi } from '../../../../services/api/settings';
import type { HouseKey } from './DrinkCards';

export function useHouseKey(): HouseKey | undefined {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['settings', 'currency', activeRestaurantId ?? null],
    enabled: Boolean(activeRestaurantId),
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
    refetchOnMount: true,
  });
  if (q.isPending && q.fetchStatus !== 'idle') return undefined;
  if (!q.data) return { country: null, currency: null };
  return q.data.readable ? { country: q.data.country, currency: q.data.code } : { country: null, currency: null };
}
