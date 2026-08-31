/**
 * ReceiptsNext formatting — E48/E49 carried: an unknown is an em dash; a
 * tri-state null (a check that could not run) is never rendered as a pass.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return EM;
  return `$${Number(n).toFixed(2)}`;
}

/**
 * `doc_date` is a Postgres `date` value (no time, no zone). Parsed bare, JS
 * reads it as UTC midnight and renders the PRIOR day west of UTC — construct
 * it as a local calendar day instead. Rolled-over impossibilities
 * ('2026-02-30') are refused, not silently normalized. (Backported from
 * documents-reports/next/so-format.ts's parseDay.)
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

/** Parse an edited money/number cell; empty clears to null, junk is rejected. */
export function parseCell(raw: string): number | null | 'invalid' {
  const t = raw.trim().replace(/^\$/, '');
  if (t === '' || t === EM) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}
