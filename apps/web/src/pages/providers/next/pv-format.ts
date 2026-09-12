/**
 * ProvidersNext formatting — same honesty rule as the rest of the Mudavym
 * pages: an unknown renders as an em dash, never as a zero or a guess.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

/** A finite number or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** "3 days" / "1 day" / em dash. */
export function fmtDays(v: number | null | undefined): string {
  const n = num(v);
  if (n === null) return EM;
  return n === 1 ? '1 day' : `${n} days`;
}

/** Relative "last contact" line — honest about absence. */
export function fmtLastContact(iso: string | null | undefined): string {
  if (!iso) return 'never contacted';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'never contacted';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'contacted today';
  if (days === 1) return 'contacted yesterday';
  if (days < 30) return `contacted ${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'contacted a month ago' : `contacted ${months} months ago`;
}
