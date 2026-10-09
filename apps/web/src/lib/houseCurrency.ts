/**
 * The house's own currency, for the money helpers that are called from deep
 * inside a render and cannot take a hook (sim F-341, web half of the "$" sweep).
 *
 * `lib/utils.ts formatMoney`, `inventory/command/bits.tsx fmtMoney*` and
 * `cellar/next/cellar-format.ts money` used to print a literal `$` in front of
 * every figure, so a house in Türkiye or London saw its stock value, menu
 * prices and takings in dollars. They now take a currency and, when a caller
 * passes none, use the one `GET /settings/currency` answered (the same read the
 * receiving door and the vendor catalogue already make).
 *
 * Three states, kept apart for the same reason `HouseCurrency` keeps them apart:
 *   - `undefined` the read has not answered (or failed): print the number and
 *                 no sign at all. A symbol nobody read is a claim.
 *   - `null`      the house has not named its money: print the number and say
 *                 "currency not recorded".
 *   - a code      print that money.
 *
 * `hooks/useHouseCurrency.ts` makes the read and keeps this store current; a page that
 * prints money calls it once at the top so it re-renders when the answer lands.
 */
import { CURRENCY_NOT_RECORDED, currencyMinorUnits } from './currency';

let current: string | null | undefined = undefined;
const listeners = new Set<() => void>();

/** What the money helpers fall back to when a caller passes no currency. */
export function getHouseCurrency(): string | null | undefined {
  return current;
}

/** Written by `useHouseCurrency` (and tests); nothing else should write it. */
export function setHouseCurrency(code: string | null | undefined): void {
  const next = typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : code === null ? null : undefined;
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore` in the hook. */
export function subscribeHouseCurrency(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export interface HouseMoneyOpts {
  /** Fraction digits; omitted means the currency's own (two, or JPY's none). */
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** `1.4K` / `2.3M`, for KPI cells and badges. */
  compact?: boolean;
}

/**
 * Money in `currency` — or, when the caller passes `undefined`, in the house's
 * own. `null` is "this figure has no currency on record" and says so; it never
 * becomes dollars.
 */
export function formatHouseMoney(
  amount: number,
  currency?: string | null,
  opts: HouseMoneyOpts = {},
): string {
  const code = currency === undefined ? current : currency;
  const minor = currencyMinorUnits(code) ?? 2;
  const abs = Math.abs(amount);
  const compact = opts.compact === true && abs >= 1_000;
  const max = compact ? 1 : opts.maximumFractionDigits ?? minor;
  const min = compact ? 1 : Math.min(opts.minimumFractionDigits ?? max, max);
  const base: Intl.NumberFormatOptions = {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    ...(compact ? { notation: 'compact' as const } : {}),
  };
  const bare = amount.toLocaleString('en-US', base);
  if (code === undefined) return bare;
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return `${bare} (${CURRENCY_NOT_RECORDED})`;
  try {
    return new Intl.NumberFormat('en-US', { ...base, style: 'currency', currency: code }).format(amount);
  } catch {
    return `${bare} ${code}`;
  }
}
