/**
 * Sorting Office formatting — E48/E49 carried: an unknown is an em dash,
 * never a zero; a register that has not answered renders EM, not 0.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

/**
 * A date-only value (a Postgres `date` like doc_date or a report period)
 * parses as UTC midnight and would render the PRIOR day west of UTC —
 * construct it as a local calendar day instead. Rolled-over impossibilities
 * ('2026-02-30') are refused, not silently normalized.
 */
function parseDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    ? date
    : new Date(NaN);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = parseDay(iso) ?? new Date(iso);
  if (!Number.isFinite(d.getTime())) return EM;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The ordering key the waiting queue sorts by. It MUST agree with what
 * fmtDate displays: a date-only string keys at local midnight (not UTC), so
 * the drawer can never render "Aug 20" above "Aug 19". An unparseable date
 * sorts LAST — an unknown date must never present itself as the oldest debt.
 */
export function sortKey(iso: string): number {
  const d = parseDay(iso) ?? new Date(iso);
  const t = d.getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** 'inventory_summary' → 'inventory summary' — a DB enum is never shown raw. */
export function labelize(s: string): string {
  return s.replace(/_/g, ' ');
}
