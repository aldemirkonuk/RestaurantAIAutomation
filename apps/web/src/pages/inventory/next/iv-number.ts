/**
 * The form /inventory writes its plain numbers in: counts, weights, volumes,
 * paces, recipe measures and nutrition figures.
 *
 * WHY (inventory r28 audit, gap 7). Money and shares on this page follow the
 * house's form since #1312, while every count stayed in en-GB. A lira house
 * read "₺1.240,50 · 1,240 bottles · 12.4 kg": two decimal marks on one line,
 * and "1.240" means 1240 beside the money but 1.24 a word later.
 *
 * THE RULE is lib/house-number.ts's: the locale of the country that owns the
 * house's recorded money (TRY → tr-TR), or the reader's own locale for a money
 * no one country owns (EUR). Until the money is read, or when the house has
 * none recorded, the page keeps the en-GB it wrote before, the same fallback
 * `cellMoney` uses for a bare number.
 *
 * ONE SETTING FOR THE PAGE, the session's call. `useInventoryNextData` sets it
 * from the house's money on every render and puts it back on unmount, so the
 * many pure helpers (`fmtCount`, `fmtQty`, the sheets' unit words, the read
 * sentence) need no currency argument. Rejected: passing the currency through
 * some forty call sites, most of them pure helpers that the list and drawer
 * chains also edit; and a React context, which pure helpers cannot read.
 *
 * WHAT IT DOES NOT TOUCH: exports (CSV keeps "12.4"), input boxes and the
 * echo of what was typed into them (iv-amount.ts reads "."), and dates.
 */
import { houseNumberLocale } from '../../../lib/house-number';

const FALLBACK = 'en-GB';

let locale: string | undefined = FALLBACK;
const formats = new Map<string, Intl.NumberFormat>();

/** Set from the house's recorded money code; `null` (not read, none recorded) is en-GB. */
export function setInventoryNumberCurrency(code: string | null): void {
  locale = code === null ? FALLBACK : houseNumberLocale(code);
}

/** The locale in force, for a test or a caller that formats something else. */
export function inventoryNumberLocale(): string | undefined {
  return locale;
}

/**
 * A plain number in the page's form. `max` decimals at most, trailing zeros
 * dropped; `digits` fixes the decimals.
 */
export function ivNumber(n: number, opts: { max?: number; digits?: number } = {}): string {
  const min = opts.digits ?? 0;
  const max = opts.digits ?? opts.max ?? 2;
  const key = `${locale ?? ''}|${min}|${max}`;
  let f = formats.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
    } catch {
      f = new Intl.NumberFormat(FALLBACK, { minimumFractionDigits: min, maximumFractionDigits: max });
    }
    formats.set(key, f);
  }
  return f.format(n);
}
