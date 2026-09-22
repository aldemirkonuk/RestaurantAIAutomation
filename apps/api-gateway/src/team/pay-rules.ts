/**
 * The rules /team applies to hours and money. ADR 0215.
 *
 * WHO SEES MONEY
 * --------------
 * The founder, 2026-09-21, asked who may see wages and labour cost, picked
 * "Owner only": managers see hours but not money. Before this file the only
 * thing between a manager and a colleague's wage was `team_settings.wage_visible`,
 * and it did not hold:
 *
 *   - it blanked `hourly_wage` on the roster (`listMembers`) and nowhere else, so
 *     `getWeek` still handed every manager each shift's `labor_cost`, and
 *     `labor_cost / (end - start)` IS the wage, to the cent;
 *   - it had no role in it at all, so switching it off hid wages from the owner
 *     too.
 *
 * So the rule is a role, applied where a response is built, and it is the same
 * rule for every response that carries money: a wage (`hourly_wage`), a shift's
 * cost (`labor_cost`), and every total derived from them. A caller who is not
 * the owner gets the hours and not the money. The flag is no longer read.
 *
 * HOURS ARE WORKED HOURS
 * ----------------------
 * Labour Law 4857 Art. 68: a break is not working time. `hoursBetween` used to be
 * end minus start and was the only input to cost, to the week's hours and to the
 * over-the-week flag, so a 10-hour shift with a one-hour break counted as ten
 * hours of work and ten hours of pay. `workedHours` subtracts the breaks the
 * shift carries (`shift_breaks.duration_min`). It does not invent a break the
 * shift does not carry: whether the legal minimum should be assumed when none is
 * recorded is a question for the founder, not a default (ADR 0215).
 *
 * THE WEEK'S HOURS ARE A REVIEW, NOT OVERTIME PAY
 * -----------------------------------------------
 * The flag was `h > 40`, the US FLSA week. The Turkish week is 45 hours (Art. 63),
 * and whether an hour over it is overtime pay depends on things Mudavym does not
 * hold: averaging agreements, part-time contracts, the worker's written consent.
 * So a person over 45 worked hours is a flag to REVIEW, and it never carries a
 * price.
 */

/** The three roles `user_restaurant_access_role_check` allows. */
export type TeamRole = "owner" | "manager" | "staff";

/** The Turkish statutory week (4857 Art. 63). Over it is a review, not a price. */
export const WEEKLY_REVIEW_HOURS = 45;

/** The one test. Every money-carrying /team response goes through it. */
export function seesMoney(role: TeamRole): boolean {
  return role === "owner";
}

/** The money fields a shift row carries. */
const SHIFT_MONEY = ["labor_cost"] as const;
/** The money fields a roster row carries. */
const MEMBER_MONEY = ["hourly_wage"] as const;

function without<T extends Record<string, any>>(
  row: T,
  keys: readonly string[],
): T {
  if (row == null || typeof row !== "object") return row;
  const out: Record<string, any> = { ...row };
  for (const k of keys) delete out[k];
  return out as T;
}

/**
 * A shift as this viewer may receive it. The key is REMOVED, not nulled: `null`
 * on `labor_cost` already means "no wage on file", and a withheld figure is not
 * an unknown one.
 */
export function shiftForViewer<T extends Record<string, any>>(
  shift: T,
  role: TeamRole,
): T {
  return seesMoney(role) ? shift : without(shift, SHIFT_MONEY);
}

/** A roster row as this viewer may receive it. Same rule, same reason. */
export function memberForViewer<T extends Record<string, any>>(
  member: T,
  role: TeamRole,
): T {
  return seesMoney(role) ? member : without(member, MEMBER_MONEY);
}

/** Minutes since midnight from an "HH:MM" string. */
function toMinutes(t: string): number {
  const [h, m] = String(t ?? "")
    .split(":")
    .map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/** The span a shift is scheduled across, breaks included. Overnight wraps. */
export function hoursBetween(start: string, end: string): number {
  let diff = toMinutes(end) - toMinutes(start);
  if (diff < 0) diff += 24 * 60; // crosses midnight
  return diff / 60;
}

export interface BreakLike {
  duration_min?: number | string | null;
}

/** Total minutes of the breaks a shift carries. A malformed duration is 0. */
export function breakMinutes(breaks: BreakLike[] | null | undefined): number {
  if (!Array.isArray(breaks)) return 0;
  let total = 0;
  for (const b of breaks) {
    const n = Number(b?.duration_min);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/**
 * Hours worked on a shift: its span minus its breaks (4857 Art. 68), never
 * below zero.
 */
export function workedHours(
  start: string,
  end: string,
  breaks: BreakLike[] | null | undefined,
): number {
  return Math.max(0, hoursBetween(start, end) - breakMinutes(breaks) / 60);
}

/**
 * A shift's planned cost at `wage`, on worked hours, in the house's money.
 * `null` wage is an unpriced shift, never a free one (ADR 0088).
 */
export function priceShift(
  wage: number | string | null | undefined,
  start: string,
  end: string,
  breaks: BreakLike[] | null | undefined,
): number | null {
  if (wage == null) return null;
  const rate = Number(wage);
  if (!Number.isFinite(rate)) return null;
  return Math.round(workedHours(start, end, breaks) * rate * 100) / 100;
}

/** A called-out shift was not worked: its person is replaced by a cover shift. */
export function isWorked(shift: { state?: string | null }): boolean {
  return shift?.state !== "callout";
}

// ── leave ──────────────────────────────────────────────────────────────────

/**
 * `time_off_requests.leave_type`. `unknown` is the default and the state of
 * every row written before the column existed: nobody said which it was.
 */
export const LEAVE_TYPES = ["unknown", "paid", "unpaid"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export interface LeaveRow {
  member_id: string;
  start_date: string;
  end_date: string;
  status: string;
  leave_type?: string | null;
}

export interface LeaveInWeek {
  /** Approved paid leave days that fall in the week, per person. */
  paid: { memberId: string; days: number }[];
  paidDays: number;
  /** Approved leave nobody has typed as paid or unpaid. */
  unknownTypeDays: number;
}

function isoDay(d: string): number {
  return Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / 86_400_000;
}

/**
 * Days of APPROVED leave inside the seven days from `weekStart`, split by type.
 * Dates only: the request's free-text `reason` is never read for this (KVKK:
 * the minimum), and a day is a calendar day, not a number of hours, because
 * nothing records how many hours a day of leave is worth.
 */
export function leaveInWeek(rows: LeaveRow[], weekStart: string): LeaveInWeek {
  const w0 = isoDay(weekStart);
  const w6 = w0 + 6;
  const paid = new Map<string, number>();
  let unknownTypeDays = 0;
  for (const r of rows ?? []) {
    if (r?.status !== "approved") continue;
    const a = Math.max(isoDay(r.start_date), w0);
    const b = Math.min(isoDay(r.end_date), w6);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    const days = b - a + 1;
    const type = (r.leave_type ?? "unknown") as LeaveType;
    if (type === "paid") {
      paid.set(r.member_id, (paid.get(r.member_id) ?? 0) + days);
    } else if (type !== "unpaid") {
      unknownTypeDays += days;
    }
  }
  const list = [...paid.entries()].map(([memberId, days]) => ({
    memberId,
    days,
  }));
  return {
    paid: list,
    paidDays: list.reduce((n, p) => n + p.days, 0),
    unknownTypeDays,
  };
}
