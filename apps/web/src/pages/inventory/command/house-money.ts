/**
 * Money on the legacy /inventory page, in the house's own currency.
 *
 * `bits.tsx` prints every figure with a hard-coded `$`, so a TRY house read
 * "Value on hand $0" and "Your price $160.00" (browser walk 2026-11-12). The
 * new page already reads the house's code once (`useInventoryNextData`,
 * `cellMoney`); this is the same read, under the same query key so the two
 * pages share one fetch, and the same four states:
 *
 *  - reading       the dash, until the code is known — never a borrowed `$`;
 *  - recorded      the house's code, with the currency's own decimal places;
 *  - not_recorded  a plain number, and the page says once why;
 *  - unreadable    a plain number, and the page says once why.
 *
 * Kept separate from `../next/useInventoryNextData` so the legacy page does not
 * import the new page's data hook, which itself imports from this folder.
 */
import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '../../../services/api/settings'
import { currencyMinorUnits } from '../../../lib/currency'

export type HouseCurrencyState =
  | { state: 'reading'; code: null }
  | { state: 'recorded'; code: string }
  | { state: 'not_recorded'; code: null }
  | { state: 'unreadable'; code: null }

/** The legacy page's dash for a figure it does not have. */
const NONE = '-'

export function useHouseCurrency(): HouseCurrencyState {
  const q = useQuery({
    queryKey: ['settings', 'currency'],
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  })
  if (q.isPending) return { state: 'reading', code: null }
  if (q.isError || !q.data?.readable) return { state: 'unreadable', code: null }
  const code = q.data.code
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code)
    ? { state: 'recorded', code }
    : { state: 'not_recorded', code: null }
}

/**
 * One money figure. `whole` is for totals (the KPI, a row's stock value), which
 * this page has always shown without cents; `exact` is for a unit price, shown
 * with the currency's own minor units (two for TRY, none for JPY).
 */
export function houseMoney(
  v: number | null | undefined,
  currency: HouseCurrencyState,
  mode: 'whole' | 'exact',
): string {
  if (v == null || !Number.isFinite(v)) return NONE
  if (currency.state === 'reading') return NONE
  const digits = mode === 'whole' ? 0 : (currencyMinorUnits(currency.code) ?? 2)
  const plain = v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (currency.state !== 'recorded') return plain
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(v)
  } catch {
    // A well-formed code this runtime does not know: the number is still true.
    return `${plain} ${currency.code}`
  }
}

/** The one line the page prints when its figures are plain numbers, or null. */
export function houseCurrencyNote(currency: HouseCurrencyState): string | null {
  if (currency.state === 'not_recorded')
    return 'Money on this page is shown as plain numbers: this house has not recorded its currency yet (Settings, Currency).'
  if (currency.state === 'unreadable')
    return 'Money on this page is shown as plain numbers: the house’s currency could not be read just now.'
  return null
}
