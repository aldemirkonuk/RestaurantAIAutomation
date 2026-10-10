/**
 * ReportsNext formatting + the shape of a failure.
 *
 * House rule (ADR 0020): an unknown is an em dash. Never a zero, never a
 * guess, never an empty chart that reads as "nothing happened". Every helper
 * takes `null | undefined` to mean "unknown" and returns the dash.
 *
 * The analytics engine is unusually disciplined about this on the server side
 * — `financial.inventoryValue`, `menuEngineering.items[].marginPerBottle`,
 * `posRevenue.revenue` are all `null` rather than `0` when the input is
 * missing — so the page's only job is not to launder those nulls into zeros
 * on the way to a chart.
 */

import { formatMoney } from '@/lib/utils';
import { getHouseLocale } from '@/lib/houseCurrency';

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';

/** A finite number, or null. Guards NaN, Infinity and the API's odd string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Money of record, or the dash. */
export function money(v: unknown, mode: 'compact' | 'full' | 'table' = 'full'): string {
  const n = num(v);
  return n === null ? EM : formatMoney(n, mode);
}

/**
 * A number in the house's marks (F-992): money already groups the house's way
 * (F-908), so a count, a ratio or a turn beside it does too — in a lira house
 * "1.250 bottles" and "62,5%", never "1,250" (1.25 by the house's own mark).
 * `digits` fixes the decimals; omitted, up to three, as `toLocaleString` did.
 */
function houseNumber(n: number, digits?: number): string {
  const opts: Intl.NumberFormatOptions =
    digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return new Intl.NumberFormat(getHouseLocale(), opts).format(n);
}

/** Plain figure, or the dash. */
export function figure(v: unknown, mode: 'compact' | 'full' = 'full'): string {
  const n = num(v);
  if (n === null) return EM;
  if (mode === 'full') return houseNumber(n);
  // Compact keeps its English K/M and takes only the house's decimal mark,
  // as compact money does.
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${houseNumber(abs / 1_000_000, 1)}M`;
  if (abs >= 1_000) return `${sign}${houseNumber(abs / 1_000, 1)}K`;
  return `${sign}${houseNumber(abs, 0)}`;
}

/** A ratio the engine returns as 0–1, rendered as a percentage of record. */
export function ratioPct(v: unknown, digits = 1): string {
  const n = num(v);
  return n === null ? EM : `${houseNumber(n * 100, digits)}%`;
}

/**
 * A signed change the engine returns as a 0–1 fraction, rendered as a
 * percentage with its sign: 0.2069 → "+20.7%", -0.004 → "-0.4%".
 *
 * The `…Pct` names mislead: `trendPerDayPct` is OLS slope ÷ |mean|
 * (`api-gateway/src/analytics/engine/statistics.ts` trendPerPeriodPct) and
 * `paceDeltaPct` is (current − previous) ÷ |previous| (`engine/comparisons.ts`
 * periodOverPeriod) — both fractions, which is how the recommendations and the
 * insight generator already read them. Until 2026-10-03 this helper printed the
 * fraction as if it were already a percentage, so +20.7% a day read "+0.21%".
 *
 * A change that rounds to zero at `digits` prints unsigned, never "-0.0%".
 */
export function pct(v: unknown, digits = 1): string {
  const n = num(v);
  if (n === null) return EM;
  const shown = (n * 100).toFixed(digits);
  if (Number(shown) === 0) return `${houseNumber(0, digits)}%`;
  return `${n > 0 ? '+' : ''}${houseNumber(n * 100, digits)}%`;
}

/** A count with its noun, or the dash — "1 wine" / "6 wines" / "—". */
export function countOf(v: unknown, one: string, many: string): string {
  const n = num(v);
  if (n === null) return EM;
  return `${houseNumber(n)} ${n === 1 ? one : many}`;
}

/** Parse a YYYY-MM-DD as a LOCAL date (`new Date('YYYY-MM-DD')` is UTC). */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "Aug 28" from a YYYY-MM-DD string, for a chart axis. */
export function shortDay(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return parseDateStr(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ───────────────────────────────── the engine's categories, in words ───── */

/** The engine's own category names, in the reader's words. */
const CATEGORY_LABEL: Record<string, string> = {
  sales: 'Sales',
  purchasing: 'Buying',
  inventory: 'Stock',
  efficiency: 'Efficiency',
  tables: 'Tables',
  staff: 'Team',
  basket: 'Pairings',
  risk: 'Watch out',
  forecast: 'Coming up',
  goals: 'Goals',
};

export function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}

/* ─────────────────────────────────── the calendar, for the heat map ────── */

/** Monday first: a restaurant's week starts when the buying week starts. */
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** 0 = Monday … 6 = Sunday, from a YYYY-MM-DD read as a LOCAL date. */
export function weekdayIndex(dateStr: string): number {
  return (parseDateStr(dateStr).getDay() + 6) % 7;
}

/** The YYYY-MM-DD of the Monday that opens this date's week. */
export function weekStart(dateStr: string): string {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() - weekdayIndex(dateStr));
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "Aug 3" for a week column header. */
export function weekLabel(mondayStr: string): string {
  return shortDay(mondayStr);
}

/* ───────────────────────────────────────── the shape of a failure ──────── */

/**
 * "Not permitted" and "the register could not be read" are different facts,
 * and a page that renders them identically teaches the reader to distrust
 * both. Every analytics route sits behind a class-level `JwtAuthGuard`
 * (analytics.controller.ts:85), so a 401/403 here is a real answer — retrying
 * changes nothing and the page must not offer a retry that cannot work.
 */
export interface Failure {
  status: number | null;
  message: string;
  /** 401/403 — understood and refused. */
  forbidden: boolean;
}

export function failureOf(error: unknown): Failure | null {
  if (!error) return null;
  const response = (error as { response?: { status?: unknown; data?: unknown } })?.response;
  const status = num(response?.status);
  // A refusal the gateway explained (a 4xx with a sentence) is said in its
  // words, not as "Request failed with status code 400" (F-909).
  const said = (response?.data as { message?: unknown } | undefined)?.message;
  const message =
    status !== null && status >= 400 && status < 500 && typeof said === 'string' && said
      ? said
      : (error as { message?: string })?.message || 'the request failed';
  return { status, message, forbidden: status === 403 || status === 401 };
}

/**
 * The one sentence a failed register is allowed to say. `register` names the
 * thing that could not be read, so an error never renders as an empty chart.
 */
export function failureLine(register: string, f: Failure): string {
  return f.forbidden
    ? `Your role cannot read the ${register}. Nothing below is claimed.`
    : `The ${register} could not be read (${f.message}). Nothing below is claimed.`;
}

/* ───────────────────────────────────────────── the house serif ─────────── */

/** Fraunces — self-hosted; `@font-face` lives in `styles/mudavym.css`
 * (decision 0149 row 9). Georgia is the fallback until it loads. */

