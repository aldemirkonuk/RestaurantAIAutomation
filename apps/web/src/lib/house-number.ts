/**
 * A house's plain numbers — a share, a ratio, a typed-price hint — written the
 * same way its money is.
 *
 * WHY (r23 walk, 2026-11-13). In a lira house the drink card read
 * "₺1,57 … ₺12,00 … POUR COST 13.1%": the money in Turkish form and the share
 * beside it in English form. The get-started price boxes hinted "14.00", which
 * is the form a Turkish owner does not write. One card, two decimal marks; the
 * reader cannot tell which dot is a decimal and which a thousand.
 *
 * THE RULE is the money rule (`moneyLocale` in lib/currency.ts, r23 #1298): a
 * number on a house's page is written in the locale of the country that owns
 * the house's money — TRY → Türkiye, GBP → the United Kingdom — when this
 * product's own country table ties that money to that country and the locale
 * writes Latin digits. Otherwise (EUR, the X-codes, no currency recorded, a
 * failed read) it is the reader's own locale, as `formatMoney` does for a
 * money with no home. The currency is the house's, never the reader's: two
 * people looking at one house see one figure.
 *
 * This file is self-contained on purpose (it reads only `lib/countries.ts` and
 * the currency table, both on main) so
 * a page on any branch can use it; `houseNumberLocale` and #1298's
 * `moneyLocale` are the same function, and the stacked follow-up makes the
 * money side call this one.
 *
 * WHAT IT DOES NOT TOUCH: exports (CSV/XLSX keep the machine's "13.1"), chart
 * coordinates, and anything the gateway writes into a sentence.
 */
import { countryByCode } from './countries';
import { currencyMinorUnits } from './currency';

/**
 * The locale a house's numbers are written in, from its money's code, or
 * `undefined` (the reader's runtime locale) where no one country owns it.
 */
export function houseNumberLocale(currency: string | null | undefined): string | undefined {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return undefined;
  const country = countryByCode(currency.slice(0, 2));
  if (!country || country.currency !== currency) return undefined;
  try {
    const locale = new Intl.Locale(`und-${country.code}`).maximize();
    return locale.script === 'Latn' ? locale.baseName : undefined;
  } catch {
    return undefined;
  }
}

function fmt(locale: string | undefined, opts: Intl.NumberFormatOptions, n: number): string {
  try {
    return new Intl.NumberFormat(locale, opts).format(n);
  } catch {
    return new Intl.NumberFormat(undefined, opts).format(n);
  }
}

/**
 * A plain number in the house's form: "1.250,5" in a lira house, "1,250.5" in
 * a pound house. `digits` fixes the decimals (both min and max); without it
 * up to `max` (default 2) are shown and trailing zeros drop.
 */
export function formatHouseNumber(
  n: number,
  currency: string | null | undefined,
  opts: { digits?: number; max?: number } = {},
): string {
  const min = opts.digits ?? 0;
  const max = opts.digits ?? opts.max ?? 2;
  return fmt(houseNumberLocale(currency), { minimumFractionDigits: min, maximumFractionDigits: max }, n);
}

/**
 * A share given in PERCENT POINTS (13.1 means 13.1 %), in the house's form:
 * "%13,1" in a lira house (Turkish writes the sign first), "13.1%" in a pound
 * house, "13,1 %" in a krona house. `digits` fixes the decimals (default 1).
 * `signed` prints "+" on a rise and "−"/"-" on a fall, never on zero.
 */
export function formatHousePercent(
  points: number,
  currency: string | null | undefined,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  const digits = opts.digits ?? 1;
  return fmt(
    houseNumberLocale(currency),
    {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      ...(opts.signed ? { signDisplay: 'exceptZero' as const } : {}),
    },
    points / 100,
  );
}

/**
 * The hint inside a price box: the amount with the money's decimals and NO
 * thousands mark — "14,00" in a lira house, "14.00" in a pound house.
 *
 * No grouping because a price box refuses "1,250" and "1.250" as ambiguous
 * (lib/typedPrice.ts, the gateway's parseMenuPrice): a hint must never show a
 * form the box would refuse. Use it only on a box whose reader takes the
 * house's decimal mark; a box read by `parseFloat` keeps its "0.00".
 */
export function housePriceHint(amount: number, currency: string | null | undefined): string {
  // The money's own decimals: a yen box hints "1400", a dinar box "1,500".
  const decimals = currencyMinorUnits(currency) ?? 2;
  return fmt(
    houseNumberLocale(currency),
    { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false },
    amount,
  );
}
