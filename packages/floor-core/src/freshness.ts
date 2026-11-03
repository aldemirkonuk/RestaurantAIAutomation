/**
 * Table freshness: how long since a table's last visit, against the house's
 * warn and late minutes.
 *
 * Ported from the Floor Checker's `lib/freshness.ts` (frozen at `5958689`,
 * p4-scratch/floor-checker-freeze-2026-10-31). No clock is read here: every
 * caller passes `now`, and the warn/late minutes are the house's settings.
 * `now` must come from the server's clock, never a phone's or browser's: a
 * slow client clock would read every overdue table as on time, since a time
 * ahead of `now` counts as 0 minutes.
 */

/** From the checker's `lib/types.ts:26` (at `5958689`). */
export type FreshnessStatus = "fresh" | "warn" | "late" | "idle";

/**
 * Minutes since `iso`, unfloored and never negative; null without a time.
 * Statuses compare these (ADR 0346 D4 (d): the board compares unfloored
 * minutes). `minutesSince` floors them for display.
 */
export function exactMinutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return null;
  return Math.max(0, (now - ms) / 60000);
}

/**
 * Whole minutes since `iso`, floored and never negative; null without a time.
 * The minute count shown (ADR 0346 D4 (d): it stays floored).
 *
 * An unparseable time is no time: null, never NaN. The checker's
 * `minutesSince` (`lib/freshness.ts:3-6` at `5958689`) gave NaN here, which
 * its `freshnessOf` read as "fresh" and its `durationText` printed as "NaNh"
 * (`lib/format.ts:20-27`): a silent pass. A null here is not health either:
 * for a table with an open seating, use `seatingFreshness`, which reads an
 * unknown gap as late.
 */
export function minutesSince(iso: string | null, now: number): number | null {
  const exact = exactMinutesSince(iso, now);
  return exact === null ? null : Math.floor(exact);
}

/**
 * fresh/warn/late by `sinceMin`, minutes since the seating's last anchor (the
 * later of the last visit and `paid_undone_at`, else `seated_at`: see
 * `SeatingAnchors`); idle for null, which means the table has no open
 * seating. A caller with an open seating must pass its anchors to
 * `seatingFreshness` instead, so an unvisited party or an unreadable time is
 * never read as idle.
 *
 * ADR 0346 D4 (d), one boundary: on time means `sinceMin <= T`, the score's
 * full-marks rule, with T = max(1, `warnAfter`) as the score takes it (ADR
 * 0346 `:110`). `sinceMin` is unfloored (`exactMinutesSince`), so "Due soon"
 * starts the moment a table passes T and runs to `lateAfter` for every
 * warn < late pair, late = warn + 1 included (ADR 0346 `:204`). The checker
 * returned "warn" at floored `sinceMin >= warnAfter`; the two differ only at
 * exactly t = T. The late boundary is unchanged.
 */
export function freshnessOf(
  sinceMin: number | null,
  warnAfter: number,
  lateAfter: number,
): FreshnessStatus {
  if (sinceMin === null) return "idle";
  // Open as OD-256, the executor's reading under OD-242, not the founder's
  // pick: a minute count or a warn/late minute that is not a finite number
  // (NaN, Infinity or -Infinity) reads late, as an unreadable time does in
  // `seatingFreshness`. The checker's comparisons (`lib/freshness.ts:16-17`
  // at `5958689`) read NaN as "fresh".
  if (
    !Number.isFinite(sinceMin) ||
    !Number.isFinite(warnAfter) ||
    !Number.isFinite(lateAfter)
  ) {
    return "late";
  }
  if (sinceMin >= lateAfter) return "late";
  if (sinceMin > Math.max(1, warnAfter)) return "warn";
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
    exactMinutesSince(anchors.lastVisitAt, now) ??
    exactMinutesSince(anchors.seatedAt, now);
  if (since === null) return "late";
  return freshnessOf(since, warnAfter, lateAfter);
}

/** Frozen: one gateway process serves every house, so no caller may edit it. */
export const STATUS_LABEL: Readonly<Record<FreshnessStatus, string>> = Object.freeze({
  fresh: "On time",
  warn: "Due soon",
  late: "Overdue",
  idle: "Empty",
});

export const STATUS_RANK: Readonly<Record<FreshnessStatus, number>> = Object.freeze({
  late: 0,
  warn: 1,
  fresh: 2,
  idle: 3,
});

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
