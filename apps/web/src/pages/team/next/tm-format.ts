/**
 * TeamNext formatting — unknowns are em dashes; a withheld figure says why in
 * words (labour tracking off is a state, not a zero).
 */

export const EM = '—';

/**
 * The mark a windowed figure carries. /team's one server-side window
 * (TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES) bounds the SAMPLE a statistic is
 * computed over, not a count being reported, so its honest mark is a ceiling
 * — "over ≤200 services" — and never a floor. `GE` is kept alongside it for
 * the day a count on this page becomes windowed; using the wrong one would be
 * a precise-looking falsehood, which is the thing ADR 0051 clause 2 exists to
 * stop.
 */
export const GE = '≥';
export const LE = '≤';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function fmtMoneyWhole(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? money.format(v) : EM;
}

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const dayShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function fmtWeekday(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isFinite(d.getTime()) ? weekday.format(d) : isoDate;
}

export function fmtDayShort(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isFinite(d.getTime()) ? dayShort.format(d) : isoDate;
}

/**
 * Monday of the week containing `d`, as YYYY-MM-DD (schedules key on it).
 * Computed from the LOCAL calendar date but with UTC-only arithmetic — the
 * previous local-getters + toISOString mix returned the wrong day for ~5
 * evening hours in any west-of-UTC timezone (team-audit.md, BLOCKER 2; the
 * gateway's own mondayOf is UTC-only for the same reason).
 */
export function mondayOf(d: Date): string {
  const utcAnchor = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (utcAnchor.getUTCDay() + 6) % 7; // Mon=0
  utcAnchor.setUTCDate(utcAnchor.getUTCDate() - day);
  return utcAnchor.toISOString().slice(0, 10);
}

/**
 * Parse a coverage period like "17:00–23:00" (en-dash, hyphen or "to").
 * Returns null when the string doesn't carry two clock times — the caller
 * must then disable the one-tap assign and say why, never guess.
 */
export function parsePeriod(period: string): { start: string; end: string } | null {
  const m = period.match(/(\d{1,2}:\d{2})\s*(?:–|—|-|to)\s*(\d{1,2}:\d{2})/);
  return m ? { start: m[1], end: m[2] } : null;
}
