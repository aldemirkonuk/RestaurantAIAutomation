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

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EM;
  const d = new Date(iso);
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
