/**
 * The house's reporting currency, shared by `/menu` and `/menu/print` (r110
 * menu-g3) so the printed menu's money is the page's money.
 */
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../../services/api/settings';

/**
 * The house's reporting currency, read the same way `ReceivingWorkspace`
 * reads it (`GET /settings/currency`, 5-minute staleTime) — a failed or
 * unanswered read resolves to `null`, which `formatMoney` renders as
 * "currency not recorded" rather than a silent dollar-sign default.
 */
export function useHouseCurrency(restaurantId: string | null): string | null {
  return useHouseCurrencyRead(restaurantId).code;
}

/**
 * The same read with its state, for a page that must not draw money before it is known
 * (`/menu/print` prints on its own). `settled` is true once the read has answered or failed;
 * `code` is null unless the answer was readable, which `failed` and a null `code` with `settled`
 * tell apart from "not set".
 */
export function useHouseCurrencyRead(restaurantId: string | null): {
  code: string | null;
  settled: boolean;
  failed: boolean;
  error: unknown;
} {
  const { data, isSuccess, isError, error } = useQuery({
    // The house is in the key: one house's currency never prices another's
    // menu (MENU-01).
    queryKey: ['settings', 'currency', restaurantId],
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  });
  return {
    code: data?.readable ? (data.code ?? null) : null,
    settled: isSuccess || isError,
    failed: isError,
    error,
  };
}
