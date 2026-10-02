/**
 * A moment, said as the HOUSE's own calendar day in English words —
 * "Oct 1, 2026" (founder, 2026-10-01, ruling VEN-W23).
 *
 * THE DEFECT THIS ANSWERS. The vendor sheet printed "stated by Aldemir Konuk
 * on 2026-10-02" for a currency stated at 9:20 pm in Chicago on Oct 1, because
 * it sliced the UTC ISO timestamp. A day is read on the house's clock
 * (`restaurants.timezone`, through `common/house-frame.ts`), and it is written
 * out so "10/01" can never be read as January 10th.
 *
 * NO ZONE, NO GUESS. When the house's zone is unknown the day is read in UTC
 * and the words SAY so ("Oct 2, 2026 (UTC)") — never the server's own clock,
 * never a zone picked for the house.
 *
 * Pure: no database, no clock.
 */

import { resolveZone } from "../calendar/zoned-time";

const WORDS = { month: "short", day: "numeric", year: "numeric" } as const;

/**
 * "Oct 1, 2026" on the house's clock; "Oct 2, 2026 (UTC)" when the house has
 * no zone this server knows; null when the moment is unreadable.
 */
export function houseDayWords(
  iso: string | null | undefined,
  zone: string | null | undefined,
): string | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const t = new Date(iso.trim());
  if (!Number.isFinite(t.getTime())) return null;
  const known = resolveZone(zone ?? null);
  const day = new Intl.DateTimeFormat("en-US", {
    ...WORDS,
    timeZone: known ?? "UTC",
  }).format(t);
  return known ? day : `${day} (UTC)`;
}

/**
 * A calendar date that is ALREADY a day (`YYYY-MM-DD`, read on the house's
 * clock by whoever produced it), in the same words. No zone is applied — it is
 * a day, not a moment. Anything else comes back as given.
 */
export function calendarDayWords(dateOnly: string): string {
  const d = dateOnly.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return dateOnly;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isFinite(t.getTime())
    ? new Intl.DateTimeFormat("en-US", { ...WORDS, timeZone: "UTC" }).format(t)
    : dateOnly;
}
