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
 * hours of work and ten hours of pay. `workedHours` subtracts the break the
 * shift carries.
 *
 * ANY SHIFT WITH NO BREAK ON RECORD HAS THE LEGAL MINIMUM
 * --------------------------------------------------------
 * The founder, 2026-09-21, picked "Take all five" (the options he picked, one
 * of which was this): a shift with no break recorded assumes the Art. 68
 * minimum, shown as an ASSUMED break, and whoever edits the shift can record
 * the real one. That round's relayed option named shifts over 4 hours only;
 * ADR 0215 returned shifts of 4 hours or less as a question, and the founder
 * answered it 2026-09-22 (round 6y): "Yes, follow Art. 68 (Recommended)" — so
 * the assumption is not gated on length any more; it applies from the
 * shortest shift up. Art. 68 keys the break on the length of the WORK, and
 * says in its last sentence "Ara dinlenmeleri çalışma süresinden sayılmaz" (a
 * break is not counted as working time), so the minimum for a shift is the
 * smallest of the three statutory breaks (15 / 30 / 60 min) that the shift's
 * worked time, after that break, still allows. A 4-hour shift is 15 minutes;
 * an 8-hour shift is 7.5 hours of work and a 30-minute break, not 60. See
 * `art68MinimumBreak`.
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

/**
 * Who may change the labour settings. The founder, 2026-09-21, picked "Take
 * all five" (ADR 0215; the options he picked): only the owner can switch
 * labour-cost tracking OFF or change the labour target. A manager's write that
 * does either is refused before anything is saved. Switching tracking ON is not
 * named in the pick, so it stays with whoever may save the settings (a manager
 * or the owner) and is returned to the founder as a question.
 *
 * Returns the refusal, in words, or `null` when the write may go ahead.
 */
export function labourSettingsRefusal(
  role: TeamRole,
  patch: { laborTrackingEnabled?: boolean; laborTargetPct?: number },
): string | null {
  if (role === "owner") return null;
  if (patch.laborTrackingEnabled === false) {
    return "Only the owner can switch labour-cost tracking off. Nothing was saved.";
  }
  if (patch.laborTargetPct !== undefined) {
    return "Only the owner can change the labour target. Nothing was saved.";
  }
  return null;
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

// ── the break a shift is counted with (4857 Art. 68) ────────────────────────

/**
 * 4857 Art. 68 (a)-(c), keyed on WORKING minutes, which do not include the
 * break (Art. 68, last sentence: "Ara dinlenmeleri çalışma süresinden
 * sayılmaz"): (a) 4 hours or less, 15 minutes; (b) over 4 hours up to and
 * including 7.5 hours, 30 minutes; (c) over 7.5 hours, one hour.
 */
export function art68BreakForWork(workedMin: number): number {
  if (workedMin <= 240) return 15;
  if (workedMin <= 450) return 30;
  return 60;
}

/**
 * The least of the three statutory breaks a shift spanning `spanMin` minutes
 * complies with: the first `b` of 15, 30, 60 such that `b` is at least what
 * Art. 68 owes for the `spanMin - b` minutes left to work. A 4h15m shift is
 * 15 (4 hours of work); a 4h16m-8h shift is 30 (an 8-hour shift is 7.5 hours
 * of work); longer is 60. Keyed on the span, the same 8-hour shift would be
 * 60 — the reading Art. 68 does not support, because it counts working time.
 */
export function art68MinimumBreak(spanMin: number): number {
  for (const b of [15, 30, 60]) {
    if (b >= art68BreakForWork(spanMin - b)) return b;
  }
  return 60;
}

/** A shift as the hour rules read it. */
export interface ShiftLike {
  start_time: string;
  end_time: string;
  /** Planned breaks (baseline table; no product path writes it). */
  shift_breaks?: BreakLike[] | null;
  /**
   * The break whoever edits the shift recorded, in minutes; `0` = recorded as
   * no break taken; `null` = nothing recorded (ADR 0215).
   */
  recorded_break_min?: number | string | null;
}

/**
 * The break on record, in minutes, or `null` when nothing is recorded. The
 * editor's `recorded_break_min` is the latest word and wins; without it, the
 * `shift_breaks` rows, when there are any.
 */
export function recordedBreakMinutes(s: ShiftLike): number | null {
  if (s?.recorded_break_min != null) {
    const n = Number(s.recorded_break_min);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (Array.isArray(s?.shift_breaks) && s.shift_breaks.length > 0) {
    return breakMinutes(s.shift_breaks);
  }
  return null;
}

/**
 * The break a shift is counted with, and whether it was assumed. Recorded
 * wins; a shift with nothing recorded — of any length, founder 2026-09-22
 * round 6y — is counted with the Art. 68 minimum for its length and says so
 * (`assumed: true`). A shift with no length (malformed times) assumes
 * nothing, so it is never priced on a negative span.
 */
export function breakCounted(s: ShiftLike): {
  minutes: number;
  assumed: boolean;
} {
  const recorded = recordedBreakMinutes(s);
  if (recorded != null) return { minutes: recorded, assumed: false };
  const span = Math.round(hoursBetween(s.start_time, s.end_time) * 60);
  if (span <= 0) return { minutes: 0, assumed: false };
  return { minutes: art68MinimumBreak(span), assumed: true };
}

/**
 * Hours worked on a shift: its span minus the break it is counted with (4857
 * Art. 68), never below zero.
 */
export function workedHours(s: ShiftLike): number {
  return Math.max(
    0,
    hoursBetween(s.start_time, s.end_time) - breakCounted(s).minutes / 60,
  );
}

/**
 * A shift's planned cost at `wage`, on worked hours, in the house's money.
 * `null` wage is an unpriced shift, never a free one (ADR 0088).
 */
export function priceShift(
  wage: number | string | null | undefined,
  s: ShiftLike,
): number | null {
  if (wage == null) return null;
  const rate = Number(wage);
  if (!Number.isFinite(rate)) return null;
  return Math.round(workedHours(s) * rate * 100) / 100;
}

/** A called-out shift was not worked: its person is replaced by a cover shift. */
export function isWorked(shift: { state?: string | null }): boolean {
  return shift?.state !== "callout";
}

/**
 * KEPT, NOT SHOWN (ADR 0215 item 20). A removed person's shifts and leave
 * requests are kept five years (founder, 2026-09-22 round 6y, "Keep them 5
 * years (Recommended)") — as a record, like the wage record, which no page
 * reads. Before migration 20260922013000 a removal deleted them, so no week,
 * copy or leave list ever held a person who had left. This keeps it that way:
 * a row whose `member_id` names nobody on `roster` (the house's live
 * `team_members` ids) is left out; a row with no person (an open shift) stays.
 * Without it, a removed person's NEXT week read as covered and costed by
 * someone who will not come, and "Copy last week" wrote them into new weeks.
 * Whether a removed person's hours should show on a PAST week is the
 * founder's question (ADR 0215), not decided here.
 */
export function onTheRoster<T extends { member_id?: string | null }>(
  rows: T[],
  roster: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => !r.member_id || roster.has(r.member_id));
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
