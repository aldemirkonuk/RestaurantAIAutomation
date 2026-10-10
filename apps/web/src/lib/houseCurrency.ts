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
import { countryByName } from './countries';

let current: string | null | undefined = undefined;
/**
 * The house's formats tag, from its recorded country — the gateway's
 * `houseFrame().locale`, which the print page and the insight lines already
 * group by. Until it is known, en-US, as before (F-908).
 */
let currentLocale = 'en-US';
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

/**
 * The formats tag for a recorded country: `Türkiye` → `tr-TR`, the same tag
 * the gateway's `localeFor` builds. en-US when the country is unknown.
 */
export function localeOfCountry(country: string | null | undefined): string {
  const code = countryByName(country ?? null)?.code;
  if (!code) return 'en-US';
  try {
    const tag = `${new Intl.Locale(`und-${code}`).maximize().language}-${code}`;
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0 ? tag : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** Written by `useHouseCurrency` (and tests), from the same read as the code. */
export function setHouseLocale(locale: string | null | undefined): void {
  const next = typeof locale === 'string' && locale ? locale : 'en-US';
  if (next === currentLocale) return;
  currentLocale = next;
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
  // Grouped the house's way: a lira house reads "₺12.400,50", where en-US
  // printed "TRY 12,400.50" — 12.4 by the house's own mark (F-908). A compact
  // figure keeps its English K/M and takes only the house's decimal mark, as
  // the gateway's insight lines do.
  const fmt = (o: Intl.NumberFormatOptions): string => {
    if (!compact) return new Intl.NumberFormat(currentLocale, o).format(amount);
    const s = new Intl.NumberFormat('en-US', o).format(amount);
    return decimalMarkOf(currentLocale) === ',' ? s.replace('.', ',') : s;
  };
  const bare = fmt(base);
  if (code === undefined) return bare;
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return `${bare} (${CURRENCY_NOT_RECORDED})`;
  try {
    return fmt({ ...base, style: 'currency', currency: code });
  } catch {
    return `${bare} ${code}`;
  }
}

function decimalMarkOf(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
}
