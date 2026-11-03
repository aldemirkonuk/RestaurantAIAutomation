/**
 * Table freshness: how long since a table's last visit, against the house's
 * warn and late minutes.
 *
 * Ported from the Floor Checker's `lib/freshness.ts` (frozen at `5958689`,
 * p4-scratch/floor-checker-freeze-2026-10-31). No clock is read here: every
 * caller passes `now`, and the warn/late minutes are the house's settings.
 */

/** From the checker's `lib/types.ts:26` (at `5958689`). */
export type FreshnessStatus = "fresh" | "warn" | "late" | "idle";

/**
 * Whole minutes since `iso`, floored and never negative; null without a time.
 *
 * An unparseable time is no time: null, never NaN. The checker's
 * `minutesSince` (`lib/freshness.ts:3-6` at `5958689`) gave NaN here, which
 * its `freshnessOf` read as "fresh" and its `durationText` printed as "NaNh"
 * (`lib/format.ts:20-27`): a silent pass. A null here is not health either:
 * for a table with an open seating, use `seatingFreshness`, which reads an
 * unknown gap as late.
 */
export function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - ms) / 60000));
}

/**
 * fresh/warn/late by `sinceMin`, minutes since the seating's last anchor (the
 * later of the last visit and `paid_undone_at`, else `seated_at`: see
 * `SeatingAnchors`); idle for null, which means the table has no open
 * seating. A caller with an open seating must pass its anchors to
 * `seatingFreshness` instead, so an unvisited party or an unreadable time is
 * never read as idle.
 *
 * ADR 0346 D4 (d), one boundary: on time means `sinceMin <= warnAfter`, the
 * score's full-marks rule (`visitScore` gives 100 at t <= T). The checker
 * returned "warn" at `sinceMin >= warnAfter`, so a table at exactly the warn
 * minute read "Due soon" while the same gap scored full marks. Here "Due soon"
 * starts one whole minute later. The late boundary is unchanged.
 */
export function freshnessOf(
  sinceMin: number | null,
  warnAfter: number,
  lateAfter: number,
): FreshnessStatus {
  if (sinceMin === null) return "idle";
  // The executor's call under the founder's 2026-10-31T16:57:09Z delegation:
  // a minute count or a warn/late minute that is not a finite number (NaN,
  // Infinity or -Infinity) reads late, as an unreadable time does in
  // `seatingFreshness`. The checker's comparisons (`lib/freshness.ts:16-17`
  // at `5958689`) read NaN as "fresh". No decision record holds this call
  // yet; it is owed to the ADR 0346 docs PR (see `waiter-score.ts`'s header).
  if (
    !Number.isFinite(sinceMin) ||
    !Number.isFinite(warnAfter) ||
    !Number.isFinite(lateAfter)
  ) {
    return "late";
  }
  if (sinceMin >= lateAfter) return "late";
  // ADR 0346 D4 (d)'s strict `>` leaves "Due soon" empty when
  // lateAfter = warnAfter + 1 (warn 9, late 10: minute 9 is on time, minute 10
  // overdue). PR3's CHECK `floor_settings_minutes_in_range` asks only
  // warn < late, so a house can store that pair. Kept as ruled, not patched
  // here: D4 (d) is one boundary for score and board; whether the settings
  // form or the CHECK should require late >= warn + 2 is owed to the ADR 0346
  // docs PR (PR3 owns the CHECK, PR7 the settings route).
  if (sinceMin > warnAfter) return "warn";
  return "fresh";
}

/** A table's open seating, as the board and the Food-up brief read it. */
export interface SeatingAnchors {
  /** `floor_seatings.seated_at`; null only when the table has no open seating. */
  seatedAt: string | null;
  /**
   * The later of the last visit (`floor_visits.visited_at`) and
   * `paid_undone_at` (ADR 0347 D7: the late clock restarts from an undo of
   * Paid); null when neither exists.
   */
  lastVisitAt: string | null;
}

/**
 * A table's status from its open seating: minutes since the last visit, else
 * since the seat time. Mudavym stores no last-visit column and no seated
 * visit row (PR3's `floor_seatings` and `floor_visits`), so a party nobody
 * has visited has only its seat time; reading it as idle would be silence
 * read as health, which ADR 0346 D4 (b) removes.
 *
 * idle only when both anchors are null (no open seating). When an anchor is
 * given but none can be read (or `now` is not a time), the gap is unknown,
 * and an unknown gap is not on time: the status is "late", so the board shows
 * the table instead of "Empty". A caller with an open seating, a merged group
 * included, must use this rather than `freshnessOf` on the last visit alone.
 */
export function seatingFreshness(
  anchors: SeatingAnchors,
  warnAfter: number,
  lateAfter: number,
  now: number,
): FreshnessStatus {
  if (anchors.seatedAt == null && anchors.lastVisitAt == null) return "idle";
  const since =
    minutesSince(anchors.lastVisitAt, now) ??
    minutesSince(anchors.seatedAt, now);
  if (since === null) return "late";
  return freshnessOf(since, warnAfter, lateAfter);
}

export const STATUS_LABEL: Record<FreshnessStatus, string> = {
  fresh: "On time",
  warn: "Due soon",
  late: "Overdue",
  idle: "Empty",
};

export const STATUS_RANK: Record<FreshnessStatus, number> = {
  late: 0,
  warn: 1,
  fresh: 2,
  idle: 3,
};

/**
 * The live board's per-waiter "on time": the share (0-100, rounded) of the
 * waiter's seated tables that are fresh right now. Pass the statuses of that
 * waiter's seated tables only.
 *
 * ADR 0346 D4 (a): a waiter holding no seated table has no evidence, so this
 * returns null (printed "—"). The checker printed 100
 * (`components/ManagerBoard.tsx:1247` at `5958689`).
 */
export function liveOnTimePct(seatedStatuses: FreshnessStatus[]): number | null {
  if (seatedStatuses.length === 0) return null;
  const fresh = seatedStatuses.filter((s) => s === "fresh").length;
  return Math.round((fresh / seatedStatuses.length) * 100);
}
