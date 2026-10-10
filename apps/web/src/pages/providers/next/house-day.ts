/**
 * A moment, said as the HOUSE's own calendar day in English words —
 * "Oct 1, 2026" (founder, 2026-10-01, ruling VEN-W23).
 *
 * The defect that triggered it: a usual currency stated at 9:20 pm in Chicago
 * on Oct 1 read "stated by … on 2026-10-02", because the sheet sliced the UTC
 * ISO timestamp. The day is read on the house's clock (the zone the gateway
 * hands back from `restaurants.timezone`), and it is written out so "10/01"
 * can never be read as January 10th.
 *
 * NO ZONE, NO GUESS. When the house's zone is unknown the day is read in UTC
 * and the words say so ("Oct 2, 2026 (UTC)") — never the reader's device zone,
 * which is a different restaurant's evening for anyone travelling.
 *
 * The gateway's twin is `apps/api-gateway/src/providers/house-day.ts`; the
 * two must print the same day for the same moment.
 */

const EN = 'en-US';

/** The zone if `Intl` knows it; null otherwise. */
export function knownZone(zone: string | null | undefined): string | null {
  const name = typeof zone === 'string' ? zone.trim() : '';
  if (!name) return null;
  try {
    new Intl.DateTimeFormat(EN, { timeZone: name }).format(new Date(0));
    return name;
  } catch {
    return null;
  }
}

function moment(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const t = new Date(iso.trim());
  return Number.isFinite(t.getTime()) ? t : null;
}

function parts(t: Date, zone: string | null): { md: string; year: number } {
  const p = new Intl.DateTimeFormat(EN, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: zone ?? 'UTC',
  }).formatToParts(t);
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? '';
  return { md: `${get('month')} ${get('day')}`, year: Number(get('year')) };
}

const UTC_TAG = ' (UTC)';

/**
 * "Oct 1, 2026" on the house's clock; "Oct 2, 2026 (UTC)" when the house has
 * no zone; null when the moment is unreadable.
 */
export function houseDay(iso: string | null | undefined, zone: string | null | undefined): string | null {
  const t = moment(iso);
  if (!t) return null;
  const z = knownZone(zone);
  const { md, year } = parts(t, z);
  return `${md}, ${year}${z ? '' : UTC_TAG}`;
}

/** The house's calendar year of a moment; null when unreadable. */
export function houseYear(iso: string | null | undefined, zone: string | null | undefined): number | null {
  const t = moment(iso);
  return t ? parts(t, knownZone(zone)).year : null;
}

/**
 * "Aug 16" — the year left off ONLY when it is `sameYear` (the year the
 * heading above already names); otherwise "Aug 16, 2025". No "(UTC)" here:
 * the heading this row sits under carries it.
 */
export function houseDayInYear(
  iso: string | null | undefined,
  zone: string | null | undefined,
  sameYear: number | null | undefined,
): string | null {
  const t = moment(iso);
  if (!t) return null;
  const { md, year } = parts(t, knownZone(zone));
  return year === sameYear ? md : `${md}, ${year}`;
}

/**
 * A span of days: "Jul 3 – Oct 1, 2026" inside one year, "Dec 3, 2025 –
 * Mar 1, 2026" across two — the year always printed once at least, so neither
 * end can be read in the wrong year. Null when either end is unreadable.
 */
export function houseSpan(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
  zone: string | null | undefined,
): string | null {
  const a = moment(fromIso);
  const b = moment(toIso);
  if (!a || !b) return null;
  const z = knownZone(zone);
  const from = parts(a, z);
  const to = parts(b, z);
  const tag = z ? '' : UTC_TAG;
  return from.year === to.year
    ? `${from.md} – ${to.md}, ${to.year}${tag}`
    : `${from.md}, ${from.year} – ${to.md}, ${to.year}${tag}`;
}
