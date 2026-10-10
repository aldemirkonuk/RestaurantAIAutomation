import { houseDayOf, houseToday, shiftHouseDay } from "../common/house-day";
import { localMidnight } from "../notifications/producers/service-day";

/**
 * A GOAL'S WINDOW AND ITS PACE SCHEDULE, ON THE HOUSE'S DAYS: one answer for
 * the goals desk (`GoalsService.getGoalProgress`) and the insight feed's goal
 * card (`computeGoalsFamily`), which paced the same goal from different start
 * days once F-628 moved only the desk (F-864).
 *
 * Pure: no database. The clock is a parameter.
 */

/** The house date a `period` opened on, as of the house day `on`. */
export function goalPeriodStart(
  period: string | undefined,
  zone: string,
  on: string = houseToday(zone),
): string {
  const today = on;
  const [y, m, d] = today.split("-").map(Number);
  const two = (n: number) => String(n).padStart(2, "0");
  switch (period) {
    case "day":
      return today;
    case "week":
      return shiftHouseDay(today, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
    case "quarter":
      return `${y}-${two(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
    case "month":
      return `${y}-${two(m)}-01`;
    default:
      return shiftHouseDay(today, -30); // custom default: trailing 30d
  }
}

/**
 * The first house date AFTER the period that opened on `start`: the day
 * after a day, a week on, the next month's or quarter's 1st. Null for a
 * custom goal, which has no period to end.
 */
export function goalPeriodEndAfter(
  period: string | undefined,
  start: string,
): string | null {
  const [y, m] = start.split("-").map(Number);
  const two = (n: number) => String(n).padStart(2, "0");
  const monthOn = (months: number) => {
    const n = y * 12 + (m - 1) + months;
    return `${Math.floor(n / 12)}-${two((n % 12) + 1)}-01`;
  };
  switch (period) {
    case "day":
      return shiftHouseDay(start, 1);
    case "week":
      return shiftHouseDay(start, 7);
    case "month":
      return monthOn(1);
    case "quarter":
      return monthOn(3);
    default:
      return null;
  }
}

export interface GoalWindow {
  /** The first house day counted. */
  periodStart: string;
  /** The first house day AFTER a counted-over period; null for a custom goal. */
  periodEnd: string | null;
  /** The deadline's house day, counted in full; undefined with no deadline. */
  deadlineDay: string | undefined;
}

/**
 * The days a goal counts (ADR 0296). A goal "counted over" a day, week, month
 * or quarter counts the current one, and starts again when the next opens
 * (F-628). A custom goal opens on the house date it was created: a goal set
 * at 22:00 in Los Angeles was set that day. Either way the count stops on the
 * deadline's house day: a quarter goal that missed on 30 Sep does not go on
 * adding October's sales.
 */
export function goalWindow(
  goal: { period?: string; deadline?: unknown; created_at?: unknown },
  zone: string,
  today: string = houseToday(zone),
): GoalWindow {
  const deadlineDay = goal.deadline
    ? String(goal.deadline).slice(0, 10)
    : undefined;
  const anchor = deadlineDay && deadlineDay < today ? deadlineDay : today;
  const periodic = ["day", "week", "month", "quarter"].includes(
    goal.period ?? "",
  );
  const periodStart = periodic
    ? goalPeriodStart(goal.period, zone, anchor)
    : (houseDayOf(goal.created_at as string, zone) ??
      goalPeriodStart(goal.period, zone));
  // The period's own end, when it closes before the deadline: the pace of a
  // weekly goal is judged against this week, not the months to its deadline.
  const periodEnd = periodic
    ? goalPeriodEndAfter(goal.period, periodStart)
    : null;
  return { periodStart, periodEnd, deadlineDay };
}

export interface GoalSchedule {
  /** The midnight that opened the first counted day. */
  startAt: number;
  /** The midnight that closes the last counted day of this window. */
  endAt: number;
  totalDays: number;
  elapsedDays: number;
  /** Whole days until the deadline day is over; 1 all through that day. */
  daysLeft: number;
}

/**
 * The linear schedule a goal is paced on: from the midnight that opens its
 * first day to the midnight that CLOSES its last counted day — the deadline
 * day, or the period's last day when the period ends first. Both on the
 * house's clock (ADR 0296). The deadline day is counted in full
 * (`houseDayBounds`), so the schedule runs through it: ending at the midnight
 * that opens it read a month as 30 of its 31 days, a week as 6 of 7, and the
 * whole last day as "0 days left" with the full target expected (F-865).
 */
export function goalSchedule(
  win: { periodStart: string; periodEnd: string | null; deadlineDay: string },
  zone: string,
  now: number = Date.now(),
): GoalSchedule {
  const afterDeadline = shiftHouseDay(win.deadlineDay, 1);
  const lastEnd =
    win.periodEnd && win.periodEnd < afterDeadline
      ? win.periodEnd
      : afterDeadline;
  const startAt = localMidnight(win.periodStart, zone).getTime();
  const endAt = localMidnight(lastEnd, zone).getTime();
  const deadlineEnd = localMidnight(afterDeadline, zone).getTime();
  const totalDays = Math.max(1, (endAt - startAt) / 86400000);
  const elapsedDays = Math.min(
    totalDays,
    Math.max(0, (now - startAt) / 86400000),
  );
  const daysLeft = Math.max(0, Math.ceil((deadlineEnd - now) / 86400000));
  return { startAt, endAt, totalDays, elapsedDays, daysLeft };
}
