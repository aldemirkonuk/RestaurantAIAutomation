/**
 * Sorting Office formatting — E48/E49 carried: an unknown is an em dash,
 * never a zero; a register that has not answered renders EM, not 0.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EM;
  // A date-only value (a Postgres `date` like doc_date or a report period)
  // parses as UTC midnight and would render the PRIOR day west of UTC —
  // construct it as a local calendar day instead.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  if (!Number.isFinite(d.getTime())) return EM;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
