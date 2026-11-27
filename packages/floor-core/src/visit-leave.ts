/**
 * Short-visit leave confirm: dwell < 12m AND honor check-ins < 2.
 *
 * Ported from the Floor Checker's `lib/visit-leave.ts` (frozen at `5958689`)
 * with one change: `nowMs` is required (no clock is read here; pass the
 * server's, as `freshness.ts` says), and a `nowMs` that is not a finite
 * number gives no dwell (null), not NaN. The checker's confirm already stayed
 * shut on a NaN clock; only -Infinity opened it. An unreadable seat time gives
 * null, as in the checker. A seat time ahead of `nowMs` still counts as 0
 * minutes, as in the checker, so with under 2 honor check-ins it opens the
 * confirm: the executor's reading under OD-242. Freshness reads the same input as late (OD-257); whether this
 * rule follows OD-257's answer is not decided. Seat times are read with
 * `new Date`, as the checker did; pass ISO strings with a zone.
 */

export const SHORT_VISIT_DWELL_MAX_MIN = 12;
/** Prompt when honor check-ins are below this (0 or 1 still confirms). */
export const SHORT_VISIT_CHECKINS_MAX = 2;

export type VisitKind = "stayed" | "quick_leave";

/**
 * Honor check-ins only (not the initial seated bump).
 * Prefer the real seating event count (`checkInCount`) when available — it
 * survives waiter reassign. Timestamp proxy is 0|1 only.
 */
export function honorCheckInCount(
  seatedAt: string | null | undefined,
  lastCheckInAt: string | null | undefined,
  checkInCount?: number | null,
): number {
  if (typeof checkInCount === "number" && Number.isFinite(checkInCount)) {
    return Math.max(0, Math.floor(checkInCount));
  }
  if (!seatedAt || !lastCheckInAt) return 0;
  const seatedMs = new Date(seatedAt).getTime();
  const lastMs = new Date(lastCheckInAt).getTime();
  if (!Number.isFinite(seatedMs) || !Number.isFinite(lastMs)) return 0;
  return Math.abs(lastMs - seatedMs) < 2_000 ? 0 : 1;
}

/** Whole minutes seated, rounded and never negative; null without a time. */
export function dwellMinutesSince(
  seatedAt: string | null | undefined,
  nowMs: number,
): number | null {
  if (!seatedAt || !Number.isFinite(nowMs)) return null;
  const seatedMs = new Date(seatedAt).getTime();
  if (!Number.isFinite(seatedMs)) return null;
  return Math.max(0, Math.round((nowMs - seatedMs) / 60_000));
}

/** True when Group left should open the short-seating confirm sheet. */
export function needsShortVisitConfirm(opts: {
  seatedAt: string | null | undefined;
  lastCheckInAt: string | null | undefined;
  checkInCount?: number | null;
  nowMs: number;
}): boolean {
  const dwell = dwellMinutesSince(opts.seatedAt, opts.nowMs);
  if (dwell == null) return false;
  const checks = honorCheckInCount(
    opts.seatedAt,
    opts.lastCheckInAt,
    opts.checkInCount,
  );
  return dwell < SHORT_VISIT_DWELL_MAX_MIN && checks < SHORT_VISIT_CHECKINS_MAX;
}

export function isQuickLeaveMeta(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.visit_kind === "quick_leave";
}
