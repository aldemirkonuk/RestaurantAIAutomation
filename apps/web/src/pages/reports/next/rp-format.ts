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

import { formatMoney, formatNumber } from '@/lib/utils';

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

/** Plain figure, or the dash. */
export function figure(v: unknown, mode: 'compact' | 'full' = 'full'): string {
  const n = num(v);
  return n === null ? EM : formatNumber(n, mode);
}

/** A ratio the engine returns as 0–1, rendered as a percentage of record. */
export function ratioPct(v: unknown, digits = 1): string {
  const n = num(v);
  return n === null ? EM : `${(n * 100).toFixed(digits)}%`;
}

/** A figure the engine already returns in percent (e.g. `trendPerDayPct`). */
export function pct(v: unknown, digits = 1): string {
  const n = num(v);
  return n === null ? EM : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** A count with its noun, or the dash — "1 wine" / "6 wines" / "—". */
export function countOf(v: unknown, one: string, many: string): string {
  const n = num(v);
  if (n === null) return EM;
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
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

/* ───────────────────────────────────────── the shape of a failure ──────── */

/**
 * "Not permitted" and "the register could not be read" are different facts,
 * and a page that renders them identically teaches the reader to distrust
 * both. Every analytics route sits behind a class-level `JwtAuthGuard`
 * (analytics.controller.ts:82), so a 401/403 here is a real answer — retrying
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
  const status = num((error as { response?: { status?: unknown } })?.response?.status);
  const message = (error as { message?: string })?.message || 'the request failed';
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

/**
 * Fraunces — the house voice, injected once and idempotently. `index.html` is
 * a shared file this page may not touch and it does not load Fraunces;
 * Georgia carries the text until the webfont lands. Copied from the
 * dashboard's `fonts.ts` deliberately — pages depend on the foundation, never
 * on each other.
 */
const LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(LINK_ID)) return;
  const link = document.createElement('link');
  link.id = LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}
