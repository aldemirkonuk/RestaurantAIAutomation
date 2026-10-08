/**
 * ProvidersNext formatting — same honesty rule as the rest of the Mudavym
 * pages: an unknown renders as an em dash, never as a zero or a guess.
 */

export const EM = '—';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

/** A finite number or null. Guards NaN and the API's occasional string. */
/**
 * What a failed call says to the house (VEN-W27, founder 2026-10-08). A
 * refusal the gateway wrote for a person (a 4xx with a message, e.g. "Only an
 * owner or manager can confirm this") is passed on; a 5xx, a dropped
 * connection or a client error code ("Internal server error", "Request failed
 * with status code 500") is not the house's language, so the caller's own
 * sentence stands in for it.
 */
export function houseMessage(e: unknown, fallback: string): string {
  const r = (e as { response?: { status?: number; data?: { message?: unknown } } } | null)
    ?.response;
  const raw = r?.data?.message;
  const msg = Array.isArray(raw) ? raw.join('; ') : raw;
  if (
    typeof r?.status === 'number' &&
    r.status >= 400 &&
    r.status < 500 &&
    typeof msg === 'string' &&
    msg.trim()
  ) {
    // Every caller sets more words after this one; a server sentence with no
    // full stop ran into them ("…not found That is a failed read", VEN-W31).
    const said = msg.trim();
    return /[.!?…)]$/.test(said) ? said : `${said}.`;
  }
  return fallback;
}

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

const WEEKDAY_NAMES = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

/**
 * The regions a vendor serves, as shown. Bare weekday names were written into
 * the free-text `regions_covered` by the old delivery-day picker; they are
 * hidden here and never deleted from the row (founder, 2026-10-01, VEN-W8:
 * "Hide weekdays on screen").
 */
export function visibleRegions(regions: readonly unknown[]): string[] {
  return regions
    .map((r) => String(r ?? '').trim())
    .filter((r) => r !== '' && !WEEKDAY_NAMES.has(r.toLowerCase()));
}
