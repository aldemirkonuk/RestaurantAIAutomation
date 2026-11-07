/**
 * Hybrid waiter attribution helpers.
 *
 * - Actions (check-ins, response gaps, score): credited to the event's actor
 *   by the handoff rules, which land in a later part (response time).
 * - Coverage (covered tonight): assignment intervals ∩ seating life, here.
 * - The seating's live caretaker is who holds the table now, never
 *   historical credit.
 *
 * Ported from the Floor Checker's `lib/attribution.ts` (frozen at
 * `5958689`). Shipping it is the founder's ADR 0346 D1 (`:41`); the 50% rule
 * is what the checker computes (`:113`, `lib/attribution.ts:63`). ADR 0346 is
 * Proposed; built under OD-242. Where the port differs:
 *
 * - `nowMs` is required (no clock is read here). A `nowMs` that is not a
 *   finite number reads as unreadable, so an open interval is skipped and an
 *   open seating scores nothing. That keeps the checker's behaviour, which
 *   skipped any non-finite interval end explicitly.
 * - Overlapping intervals are merged before they are summed, so covered means
 *   the union ADR 0346 `:113` describes. The checker summed them; its only
 *   guard is one active row per table
 *   (`supabase/migrations/0001_init.sql:79-80`), which does not stop closed
 *   intervals from overlapping. The port's floor schema (its migration is
 *   not on main yet) lets one waiter hold a table directly and through a
 *   section at once; summing those would count the same minutes twice and
 *   could cross the 50% line.
 *
 * Times are ISO strings with a zone; a zone-less string is read in the
 * runtime's zone. An empty `leftAt` or `endAt` reads as still open, as in the
 * checker.
 * The intervals passed in are one waiter's; the caller filters by waiter.
 */

export type AssignmentInterval = {
  tableId: string;
  startAt: string;
  /** null = still open */
  endAt: string | null;
};

/**
 * Milliseconds of the seating window covered by one waiter's assignment
 * intervals on `tableId`. Intervals are clipped to the window and merged, so
 * time covered twice counts once and the total never exceeds the window.
 */
export function assignmentOverlapMs(
  seatedAt: string,
  leftAt: string | null | undefined,
  intervals: AssignmentInterval[],
  tableId: string,
  nowMs: number,
): number {
  const now = Number.isFinite(nowMs) ? nowMs : NaN;
  const s0 = new Date(seatedAt).getTime();
  const s1 = leftAt ? new Date(leftAt).getTime() : now;
  if (!Number.isFinite(s0) || !Number.isFinite(s1) || s1 <= s0) return 0;

  const clipped: [number, number][] = [];
  for (const iv of intervals) {
    if (iv.tableId !== tableId) continue;
    const a0 = new Date(iv.startAt).getTime();
    const a1 = iv.endAt ? new Date(iv.endAt).getTime() : now;
    // An unreadable start or end is NaN, so `hi > lo` is false and the
    // interval is skipped (specs pin both).
    const lo = Math.max(s0, a0);
    const hi = Math.min(s1, a1);
    if (hi > lo) clipped.push([lo, hi]);
  }
  clipped.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let overlap = 0;
  let runLo = 0;
  let runHi = -Infinity;
  for (const [lo, hi] of clipped) {
    if (lo > runHi) {
      if (runHi > runLo) overlap += runHi - runLo;
      runLo = lo;
      runHi = hi;
    } else if (hi > runHi) {
      runHi = hi;
    }
  }
  if (runHi > runLo) overlap += runHi - runLo;
  // Disjoint runs inside [s0, s1]: the sum cannot exceed the window.
  return overlap;
}

/**
 * Covered credit: waiter owned ≥ 50% of the seated window on that table.
 * Ties / edge: any overlap ≥ 50% counts (plurality-or-equal), so at exactly
 * 50/50 both waiters get the party.
 */
export function seatingCoveredByWaiter(
  seatedAt: string,
  leftAt: string | null | undefined,
  tableId: string,
  intervals: AssignmentInterval[],
  nowMs: number,
): boolean {
  const s0 = new Date(seatedAt).getTime();
  const s1 = leftAt ? new Date(leftAt).getTime() : nowMs;
  // A non-finite now makes `duration` non-finite here, so it needs no guard.
  const duration = s1 - s0;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const overlap = assignmentOverlapMs(
    seatedAt,
    leftAt,
    intervals,
    tableId,
    nowMs,
  );
  return overlap / duration >= 0.5;
}
