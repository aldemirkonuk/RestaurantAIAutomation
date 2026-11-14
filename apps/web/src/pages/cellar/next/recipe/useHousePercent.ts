/**
 * A share (food cost, pour cost) written in the house's form, as its money
 * is: "%18,7" in a lira house, "18.7%" in a pound house (r28 recipes audit,
 * gap 15). The rule is `formatHousePercent` (lib/house-number.ts); this hook
 * only reads the house's currency, from the same query `useHouseMoney` reads,
 * so the two never disagree about which house this is.
 *
 * While the currency is read, or when it could not be read, the share is in
 * the reader's own form: a share carries no sign, so nothing is guessed.
 *
 * KEEP THIS FILE BYTE-IDENTICAL on every branch that adds it.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { settingsApi } from '../../../../services/api/settings';
import { formatHousePercent } from '../../../../lib/house-number';

/** Writes a share given in percent points (18.7 means 18.7 %). */
export type SayPercent = (points: number) => string;

export function useHousePercent(): SayPercent {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['settings', 'currency', activeRestaurantId ?? null],
    enabled: Boolean(activeRestaurantId),
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  });
  const code = q.data?.readable ? q.data.code : null;
  return (points: number) => formatHousePercent(points, code);
}
