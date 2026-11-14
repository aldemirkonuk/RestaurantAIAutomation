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

import { formatNumber } from '@/lib/utils';
import { houseNumberLocale } from '@/lib/house-number';
import type { HouseRole } from './rp-spec';

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

/** A well-formed ISO 4217 code, or null. */
function isoCode(c: unknown): string | null {
  return typeof c === 'string' && /^[A-Z]{3}$/.test(c) ? c : null;
}

/**
 * What a money figure on this page is printed in.
 *
 * - an ISO 4217 code (`GET /settings/currency` answered one): the house's mark;
 * - `null` or absent (never stated, or the read failed): the figure prints
 *   BARE, and the page says once, under its date line, why;
 * - `READING` (the read has not answered yet): every figure is the dash. A
 *   bare `4,210` that turns into `₺4,210` a moment later reads as two amounts,
 *   and a `$` would be a claim about the money the page cannot yet make.
 */
export const READING = Object.freeze({ reading: true as const });
export type MoneyIn = string | null | undefined | typeof READING;

/**
 * Money of record in the HOUSE's currency, or the dash.
 *
 * It never falls back to `$`: a currency mark is a claim about the amount, and
 * every house used to read as dollars (audit G5; the same rule as `fmtMoney`,
 * `lib/mudavym/format.ts`).
 *
 * `currency` is REQUIRED on purpose (r7, 2026-11-12). Two /reports stacks edit
 * this file; a register that calls `money(v)` without saying whose money it is
 * would silently print bare figures on a house that has a currency. Without a
 * default the compiler refuses that call, so a merge cannot hide it. Register
 * views bind it once with `moneyIn(ctx.currency)`.
 */
export function money(
  v: unknown,
  mode: 'compact' | 'full' | 'table',
  currency: MoneyIn,
): string {
  const n = num(v);
  if (n === null) return EM;
  if (typeof currency === 'object' && currency !== null) return EM;
  const code = isoCode(currency);
  if (!code)
    return mode === 'table'
      ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : formatNumber(n, mode === 'compact' ? 'compact' : 'full');
  try {
    // In the HOUSE's number form, not always English: a lira house read
    // "₺4,302" and "₺112,736.56" here while /inventory printed "₺545,10"
    // (r29 walk, finding 4). The locale is the one country that owns the
    // money (`houseNumberLocale`, #1303), so two readers see one figure.
    const locale = houseNumberLocale(code);
    if (mode === 'compact') return compactInHouseMarks(n, code, locale);
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      ...(mode === 'table'
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    }).format(n);
  } catch {
    // A well-formed code this runtime does not know: the number is still true.
    return `${formatNumber(n, mode === 'compact' ? 'compact' : 'full')} ${code}`;
  }
}

/**
 * A compact amount ("₺12,3K") with the HOUSE's decimal and group marks but
 * the page's own English suffix. The house locale's own compact words are
 * wrong on an English page: Turkish writes 12.3 thousand as "₺12,3 B" (bin),
 * which an English reader takes for billions.
 */
function compactInHouseMarks(n: number, code: string, locale: string | undefined): string {
  const marks = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const decimal = marks.find((p) => p.type === 'decimal')?.value ?? '.';
  const group = marks.find((p) => p.type === 'group')?.value ?? ',';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })
    .formatToParts(n)
    .map((p) => (p.type === 'decimal' ? decimal : p.type === 'group' ? group : p.value))
    .join('');
}

/** `money` bound to one house's currency — what every register view uses. */
export function moneyIn(currency: MoneyIn) {
  return (v: unknown, mode: 'compact' | 'full' | 'table' = 'full') => money(v, mode, currency);
}

/** Plain figure, or the dash. */
export function figure(v: unknown, mode: 'compact' | 'full' = 'full'): string {
  const n = num(v);
  return n === null ? EM : formatNumber(n, mode);
}

/**
 * A plain figure to at most `digits` places, or the dash. The ledger's turns,
 * days and GMROI are ratios the engine returns unrounded; `figure` printed
 * them to three places ("312.067" days, cost-math walk 2026-11-11). The export
 * prints days to one place and other figures to two
 * (`report-export-render.ts`), so the page uses the same places.
 */
export function figureTo(v: unknown, digits: number): string {
  const n = num(v);
  return n === null ? EM : n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/**
 * A reason sentence set inside the page's own parentheses: its closing full
 * stop is dropped, so "(… under Time zone.)." reads "(… under Time zone)."
 */
export function inParens(reason: string): string {
  return reason.replace(/[.\s]+$/, '');
}

/** A ratio the engine returns as 0–1, rendered as a percentage of record. */
export function ratioPct(v: unknown, digits = 1): string {
  const n = num(v);
  return n === null ? EM : `${(n * 100).toFixed(digits)}%`;
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
  if (Number(shown) === 0) return `${(0).toFixed(digits)}%`;
  return `${n > 0 ? '+' : ''}${shown}%`;
}

/** A count with its noun, or the dash — "1 wine" / "6 wines" / "—". */
export function countOf(v: unknown, one: string, many: string): string {
  const n = num(v);
  if (n === null) return EM;
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** Parse a YYYY-MM-DD as a LOCAL date (`new Date('YYYY-MM-DD')` is UTC). */
/**
 * Axis labels for a row of names: at most `max` characters, never two alike.
 * Cutting the tail alone drew "Local Check B…" under two different wines.
 * Names whose cut collides drop the words they share instead, so the label
 * says what tells them apart ("…Barolo 2017", "…Brut NV"); the tooltip still
 * carries the whole name.
 */
export function shortLabels(names: string[], max: number): string[] {
  const fit = (n: string) => (n.length > max ? `${n.slice(0, max - 1).trimEnd()}…` : n);
  const cut = names.map(fit);
  const groups = new Map<string, string[]>();
  names.forEach((n, i) => groups.set(cut[i], [...(groups.get(cut[i]) ?? []), n]));
  const kept = names.map((n, i) => {
    const group = groups.get(cut[i]) ?? [];
    if (group.length < 2 || n.length <= max) return cut[i];
    // The words every name in the clash starts with.
    let p = 0;
    while (group.every((g) => g[p] === n[p] && p < n.length)) p += 1;
    p = n.lastIndexOf(' ', p) + 1;
    const rest = n.slice(p);
    if (p === 0) return cut[i];
    return rest.length + 1 > max ? `…${rest.slice(0, max - 2).trimEnd()}…` : `…${rest}`;
  });
  const seen = new Map<string, number>();
  return kept.map((l) => {
    const k = (seen.get(l) ?? 0) + 1;
    seen.set(l, k);
    return k === 1 ? l : `${l} ${k}`;
  });
}

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

/** The category a sentence arrives without (r28 gap 20): never filed as sales. */
export const UNFILED = 'unfiled';

export function categoryLabel(c: string): string {
  if (c === UNFILED || c === '') return 'Not filed';
  const known = CATEGORY_LABEL[c];
  if (known) return known;
  // A category the page has no word for yet is said plainly, never as a key.
  const words = c.replace(/[_.-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Not filed';
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
  /** The gateway's own sentence for the refusal, when it sent one. */
  said?: string;
  /**
   * Set when the page never sent the request: the register names its readers
   * and the reader is not one of them (`known: true`), or the reader's role at
   * this house is not known yet (`known: false`). Not an error and not an
   * empty register: the figures are withheld from this reader (ADR 0348).
   * Always `forbidden` too, so no retry is offered.
   */
  heldBack?: { readers: readonly HouseRole[]; known: boolean };
}

export function failureOf(error: unknown): Failure | null {
  if (!error) return null;
  const response = (error as { response?: { status?: unknown; data?: unknown } })?.response;
  const status = num(response?.status);
  const message = (error as { message?: string })?.message || 'the request failed';
  // A 500 carries whatever the service threw: a database or library message
  // with working names in it, not a sentence written for the house. Only a
  // refusal the gateway words on purpose (a 4xx, the whole-read 503) is said.
  const said = status === 500 ? null : gatewaySentence(response?.data);
  return { status, message, forbidden: status === 403 || status === 401, ...(said ? { said } : {}) };
}

/**
 * Why a read failed, in the house's words (audit G-err, r28 gap 17). The HTTP
 * client's own sentences ("Network Error", "Request failed with status code
 * 502", "timeout of 30000ms exceeded") are the transport talking; each is
 * turned into what happened. A message that is not the transport's (the
 * export shelf hands the gateway's own reason) is kept as it is.
 */
export function failureReason(f: Pick<Failure, 'status' | 'message'>): string {
  const m = (f.message ?? '').trim();
  if (/^timeout of \d+ms exceeded$/i.test(m) || /ECONNABORTED|ETIMEDOUT/.test(m))
    return 'Mudavym took too long to answer';
  if (/^(canceled|request aborted)$/i.test(m)) return 'the request was stopped before it was answered';
  const transport = m === '' || /^network error$/i.test(m) || /^request failed with status code \d+$/i.test(m);
  if (!transport) return m;
  // The client names the status in its sentence even when no response object
  // came with the error; read it there before calling the server unreachable.
  const s = f.status ?? num(/status code (\d+)$/i.exec(m)?.[1]);
  if (s === null) return 'Mudavym could not be reached from this device';
  if (s === 404) return 'Mudavym did not find it';
  if (s === 429) return 'too many reads were asked for at once; it can be read again in a minute';
  if (s >= 500) return 'Mudavym’s side failed while reading it';
  return 'Mudavym refused the request';
}

/**
 * The sentence the gateway refused with, in the house's words. A window that
 * could not be read whole answers 503 with a sentence (ADR 0292); without this
 * the page printed the HTTP client's "Request failed with status code 503".
 * The parenthesised page/SQLSTATE detail is for the log, not for the reader.
 */
function gatewaySentence(data: unknown): string | null {
  const raw = (data as { message?: unknown } | null)?.message;
  const text = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string').join(' ')
    : typeof raw === 'string'
      ? raw
      : '';
  // `WholeReadError`: "<what> could not be read whole: <reason> (<detail>).
  // Nothing is reported from part of it." — the detail goes, the rest stays.
  const clean = text.replace(/\s\(.*\)(?=\. Nothing is reported from part of it\.$)/s, '').trim();
  // Nest's own generic words are no better than the status code.
  if (!clean || /^(internal server error|service unavailable|bad request)$/i.test(clean)) return null;
  return clean;
}

/** The register a reader is not sent: no status, because nothing was asked. */
export function heldBackFailure(
  readers: readonly HouseRole[],
  role: HouseRole | null,
): Failure {
  return {
    status: null,
    message: 'held back for this role',
    forbidden: true,
    heldBack: { readers, known: role !== null },
  };
}

const READER_WORDS = { owner: 'owners', manager: 'managers', staff: 'staff' } as const;

/** "owners and managers"; "owners, managers and staff". */
function readersWords(readers: readonly HouseRole[]): string {
  const words = readers.map((r) => READER_WORDS[r]);
  return words.length <= 1
    ? (words[0] ?? 'no one')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The one sentence a failed register is allowed to say. `register` names the
 * thing that could not be read, so an error never renders as an empty chart.
 * A held-back register says who it is written for, the way the export shelf
 * does, and claims nothing.
 */
export function failureLine(register: string, f: Failure): string {
  if (f.heldBack)
    return f.heldBack.known
      ? `The ${register} is written for ${readersWords(f.heldBack.readers)}. Nothing below is claimed.`
      : `Your role at this restaurant is not known yet, so the ${register} is not read until it is. Nothing below is claimed.`;
  if (f.forbidden) return `Your role cannot read the ${register}. Nothing below is claimed.`;
  if (f.said)
    return /nothing is reported|nothing below/i.test(f.said)
      ? `The ${register} could not be read. ${f.said}`
      : `The ${register} could not be read. ${f.said} Nothing below is claimed.`;
  return `The ${register} could not be read (${failureReason(f)}). Nothing below is claimed.`;
}

/* ───────────────────────────────────────────── the house serif ─────────── */

/** Fraunces — self-hosted; `@font-face` lives in `styles/mudavym.css`
 * (decision 0149 row 9). Georgia is the fallback until it loads. */

