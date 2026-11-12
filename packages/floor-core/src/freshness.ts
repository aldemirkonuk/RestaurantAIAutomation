/**
 * Table freshness: how long since a table's last visit, against the house's
 * warn and late minutes.
 *
 * Ported from the Floor Checker's `lib/freshness.ts` (its repo frozen at
 * commit `5958689`). No clock is read here: every
 * caller passes `now`, and the warn/late minutes are the house's settings.
 * `now` must come from the server's clock, never a phone's or browser's. A
 * time more than a minute ahead of `now` is unreadable, so a fast device
 * clock reads late rather than on time (OD-257); within a minute it counts
 * as 0. A time must carry its offset (`Z` or
 * `+03:00`): an offset-less one would parse as the reader's local time, so it
 * is unreadable here, and an unreadable time reads late (OD-256).
 *
 * ADR 0346 and ADR 0353 are Proposed; every clause cited from them below is
 * built as the executor's reading under OD-242 (OD-255 records why), and is
 * re-read when the founder locks them.
 */

/** From the checker's `lib/types.ts:26` (at `5958689`). */
export type FreshnessStatus = "fresh" | "warn" | "late" | "idle";

/**
 * The one shape read: `YYYY-MM-DDTHH:MM[:SS[.fff]]` plus `Z`, `±HH`, `±HH:MM`
 * or `±HHMM`, as PostgREST prints `timestamptz`. It is parsed by hand, not by
 * `Date`, whose reading of anything else differs between browsers.
 */
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/i;

function parseIsoMs(iso: string): number | null {
  const m = ISO_WITH_OFFSET.exec(iso);
  if (!m) return null;
  const [y, mo, d, h, mi, sec = 0] = m.slice(1, 7).map((v) => Number(v ?? 0));
  const offH = Number(m[9] ?? 0);
  const offM = Number(m[10] ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  if (offH > 23 || offM > 59) return null;
  const fracMs = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
  const offset = (m[8] === "-" ? -1 : 1) * (offH * 60 + offM) * 60000;
  const utc = Date.UTC(y, mo - 1, d, h, mi, sec);
  // `Date.UTC` rolls 31 February into March and maps years below 100 to
  // 1900s; a date that does not round-trip is no date.
  const back = new Date(utc);
  if (y < 1970 || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return utc + fracMs - offset;
}

/** How far ahead of `now` a time may sit and still count as 0 (OD-257). */
const FUTURE_SKEW_MS = 60000;

/**
 * Minutes since `iso`, unfloored and never negative; null without a time or
 * for a time more than a minute ahead of `now`. Statuses compare these
 * (Proposed ADR 0346 D4 (d): the board compares unfloored minutes).
 * `minutesSince` floors them for display.
 */
export function exactMinutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const ms = parseIsoMs(iso);
  if (ms === null || !Number.isFinite(now) || ms - now > FUTURE_SKEW_MS) return null;
  return Math.max(0, (now - ms) / 60000);
}

/**
 * Whole minutes since `iso`, floored and never negative; null without a time.
 * The minute count shown (Proposed ADR 0346 D4 (d): it stays floored).
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
 * Proposed ADR 0346 D4 (d), one boundary: on time means `sinceMin <= T`, the score's
 * full-marks rule, with T = max(1, `warnAfter`) as the score takes it (ADR
 * 0346 `:110`). `sinceMin` is unfloored (`exactMinutesSince`), so "Due soon"
 * starts the moment a table passes T and runs to `lateAfter` whenever
 * `lateAfter` > T, late = warn + 1 included for `warnAfter >= 1` (ADR 0346
 * `:204`). With `lateAfter <= 1` (warn 0, late 1) the window is empty and a
 * table goes from on time straight to late; a spec pins that. The checker
 * returned "warn" at floored `sinceMin >= warnAfter`; for `warnAfter >= 1` the
 * two differ only at exactly t = T, and below 1 the floor of T = 1 keeps a
 * table on time for its first minute. The late boundary is unchanged.
 */
export function freshnessOf(
  sinceMin: number | null,
  warnAfter: number,
  lateAfter: number,
): FreshnessStatus {
  if (sinceMin == null) return "idle";
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
   * `paid_undone_at` (Proposed ADR 0353 `:43`: the late clock restarts from
   * the moment of an undo of Paid); null when neither exists.
   */
  lastVisitAt: string | null;
}

/**
 * A table's status from its open seating: minutes since the last visit, else
 * since the seat time. Mudavym stores no last-visit column and no seated
 * visit row (the `floor_seatings` and `floor_visits` tables a later part
 * adds), so a party nobody
 * has visited has only its seat time; reading it as idle would be silence
 * read as health, which Proposed ADR 0346 D4 (b) removes.
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
 * Proposed ADR 0346 D4 (a): a waiter holding no seated table has no evidence, so this
 * returns null (printed "—"). The checker printed 100
 * (`components/ManagerBoard.tsx:1247` at `5958689`).
 */
export function liveOnTimePct(seatedStatuses: FreshnessStatus[]): number | null {
  if (seatedStatuses.length === 0) return null;
  const fresh = seatedStatuses.filter((s) => s === "fresh").length;
  return Math.round((fresh / seatedStatuses.length) * 100);
}
