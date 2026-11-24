/**
 * A date written in the house's form, as its money and shares are: "7 Kas 2026"
 * in a lira house, "7 Nov 2026" in a British one. The locale is the one the
 * house's currency names (`houseNumberLocale`, lib/house-number.ts), never the
 * reader's browser, so two people looking at one house read one date. While the
 * currency is read, or when it could not be, it falls back to the reader's own
 * form: a date carries no sign, so nothing is guessed.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { settingsApi } from '../../../../services/api/settings';
import { houseNumberLocale } from '../../../../lib/house-number';

/** Writes an ISO timestamp as "7 Nov 2026"; null when it is not a date. */
export type SayDate = (iso: string | null | undefined) => string | null;

/**
 * "en-Latn-GB" is read by some runtimes as plain "en" and written "Nov 7, 2026"; the date wants language and
 * region only ("en-GB": "7 Nov 2026"). Numbers do not mind the script, dates do.
 */
function dateLocale(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  try {
    const l = new Intl.Locale(tag);
    return l.region ? `${l.language}-${l.region}` : l.language;
  } catch {
    return undefined;
  }
}

export function useHouseDate(): SayDate {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ['settings', 'currency', activeRestaurantId ?? null],
    enabled: Boolean(activeRestaurantId),
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
    refetchOnMount: true,
  });
  const locale = dateLocale(houseNumberLocale(q.data?.readable ? q.data.code : null));
  return (iso) => {
    const made = new Date(iso ?? '');
    if (!Number.isFinite(made.getTime())) return null;
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    try {
      return made.toLocaleDateString(locale, opts);
    } catch {
      return made.toLocaleDateString(undefined, opts);
    }
  };
}
