/**
 * The active house's money code, for a component that writes a price or a
 * share and is mounted in more than one place (the menu plan sits on /menu and
 * in onboarding), so a prop from one page would leave the other bare.
 *
 * Same read and the same key as /menu's own (`GET /settings/currency`, house
 * in the key, 5 minutes), so the two share one request. `null` is "no code to
 * write in": still reading, a failed read, or a house that has not answered.
 * `formatMoney` and lib/house-number.ts both turn `null` into the reader's own
 * form plus "(currency not recorded)" for money — never a guessed sign.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores';
import { settingsApi } from '../../services/api/settings';

export function useHouseCurrencyCode(): string | null {
  // The store, not useAuth(): the menu plan, the locks and the versions read
  // the house there too, and they mount where no AuthProvider wraps them.
  const activeRestaurantId = useAuthStore((s) => s.activeRestaurantId) ?? null;
  const { data } = useQuery({
    // The house is in the key: one house's money never writes another's page.
    queryKey: ['settings', 'currency', activeRestaurantId],
    queryFn: () => settingsApi.houseCurrency(),
    enabled: Boolean(activeRestaurantId),
    staleTime: 5 * 60_000,
  });
  return data?.readable ? (data.code ?? null) : null;
}
