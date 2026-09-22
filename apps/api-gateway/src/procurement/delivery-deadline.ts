/**
 * When a delivery is due, and whether it came in time — the one on-time rule
 * (ADR 0207). The vendor scorecard (`providers/scorecard/vendor-scorecard.ts`)
 * and the analytics vendor scorecard (`analytics/advanced-analytics.service.ts`
 * `getVendorScorecard`) both read it, so the two on-time figures cannot drift.
 *
 * THE FOUNDER'S RULINGS, 2026-09-21
 * ---------------------------------
 * Question 6, the deadline: "House's local midnight". An order is on time when
 * it lands before midnight at the END of its expected day, on the house's own
 * clock. Until this change the rule was 23:59:59 UTC, so a house in Istanbul
 * whose delivery landed at 01:30 local the next morning read on time, and a
 * house in Palo Alto whose delivery landed at 18:00 local on the day read late.
 *
 * Question 8, an order past its date that never landed: "count it as late,
 * because that will help us feed to the analytics for better results". An
 * order placed with the vendor whose deadline has passed is LATE in the
 * figure, and stays on the open list until it lands.
 *
 * NO ZONE, NO GUESS
 * -----------------
 * A house with no recorded zone whose country keeps more than one
 * (`common/house-frame.ts`) has no single midnight. Its deadline is then the
 * whole span that midnight could be — from UTC+14 (the earliest any zone
 * reaches it) to UTC-12 (the latest) — and a verdict is given only when it
 * holds at both ends: landed before the earliest, on time in every zone; landed
 * at or after the latest, late in every zone; in between, undecided — listed,
 * never counted. UTC is never used as a default.
 *
 * Pure: no database, no clock of its own.
 */

import { zonedWallClockToUtc } from "../calendar/zoned-time";

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The furthest east any zone runs: UTC+14 (Pacific/Kiritimati). */
export const FURTHEST_EAST_MS = 14 * HOUR_MS;
/** The furthest west any zone runs: UTC-12. */
export const FURTHEST_WEST_MS = 12 * HOUR_MS;

export interface Deadline {
  /** The expected calendar date, `YYYY-MM-DD`. */
  date: string;
  /**
   * Midnight at the end of that date — the first instant that is late. With a
   * known zone `earliest === latest`; without one, the span it could be.
   */
  earliest: number;
  latest: number;
  zone: string | null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The deadline of an expected date, or null when the date does not parse. */
export function deadlineOf(
  expected: string | null | undefined,
  zone: string | null,
): Deadline | null {
  if (!expected) return null;
  const date = expected.slice(0, 10);
  const m = DATE_ONLY.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // A calendar date that does not exist (2026-02-30) is not a deadline.
  if (new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) !== date)
    return null;
  const nextUtc = Date.UTC(y, mo - 1, d + 1);
  if (zone) {
    const next = new Date(nextUtc).toISOString().slice(0, 10);
    const at = zonedWallClockToUtc(next, "00:00", zone).getTime();
    if (!Number.isFinite(at)) return null;
    return { date, earliest: at, latest: at, zone };
  }
  return {
    date,
    earliest: nextUtc - FURTHEST_EAST_MS,
    latest: nextUtc + FURTHEST_WEST_MS,
    zone: null,
  };
}

export type LandedVerdict = "on_time" | "late" | "undecided";

/** An arrival against its deadline. `undecided` only when no zone is known. */
export function landedVerdict(landedMs: number, d: Deadline): LandedVerdict {
  if (landedMs < d.earliest) return "on_time";
  if (landedMs >= d.latest) return "late";
  return "undecided";
}

/** An order not landed is late once its deadline has passed in every zone it could be read in. */
export function isPastDue(nowMs: number, d: Deadline): boolean {
  return nowMs >= d.latest;
}

/** Whole days past the deadline, the day after the expected day being day 1. */
export function daysPast(ms: number, d: Deadline): number {
  return Math.floor((ms - d.latest) / DAY_MS) + 1;
}
