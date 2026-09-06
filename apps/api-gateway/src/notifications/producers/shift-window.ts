import {
  parseDateOnly,
  parseWallTime,
  zonedWallTimeToInstant,
} from "../../calendar/reminder-window";

/**
 * Who was on the floor at a given instant.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The founder's requirement for the goal-reached notification is "who were at
 * shift" at the moment the goal crossed. There was no such read.
 * `ScheduleService` answers WEEK questions — `getWeek` (schedule.service.ts:90)
 * and `getMyWeek` (:137) both take a `weekStart` and both are manager-gated
 * through `TeamService.assertAccess` — and nothing in the module asks "who was
 * working at 23:04 on Tuesday". This is the smallest read that answers it, and
 * it is pure so the arithmetic can be tested without a database or a clock.
 *
 * It is NOT gated on `assertAccess`, and that is correct rather than an
 * oversight: this runs inside a per-tenant cron with no caller, and the answer
 * it produces is written into the tenant's own notification, never returned to
 * a request. The tenant comes from `ScheduledTenant.id`, not from anyone.
 *
 * THE THREE THINGS THE COLUMNS FORCE
 * ----------------------------------
 * 1. `shifts.start_time` and `end_time` are TEXT `HH:MM`, not timestamps
 *    (baseline:5378-5392). A wall time is only an instant once you say whose
 *    wall it is; this says the restaurant's, from `ScheduledTenant.timezone`,
 *    through the same `zonedWallTimeToInstant` the calendar reminder job uses.
 * 2. A shift whose `end_time` is at or before its `start_time` crosses
 *    midnight. That is `ScheduleService.hoursBetween`'s own rule
 *    (schedule.service.ts:29-33, `if (diff < 0) diff += 24 * 60`) and this
 *    keeps it, so a close-down shift ending 02:00 is not read as a 22-hour
 *    negative.
 * 3. `state` decides presence. `open` means nobody is assigned and `callout`
 *    means the assigned person is not coming — both are the ABSENCE of a
 *    person, and counting either as "on shift" would put a name against a goal
 *    nobody was there to reach. The predicate is copied verbatim from the two
 *    places the module already uses it (schedule.service.ts:280 and :787-788).
 *
 * WHAT IT CANNOT TELL YOU
 * -----------------------
 * That these people were physically present. There is no clock-in table in this
 * schema; `shifts` is a PLAN. Callers say "on the schedule" rather than "on the
 * floor", and an empty result is reported as "the schedule names nobody",
 * never as "nobody was working".
 */

/** The subset of a `shifts` row this needs. */
export interface ShiftRow {
  member_id?: string | null;
  shift_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  role?: string | null;
  state?: string | null;
}

export interface OnShift {
  memberId: string;
  role: string | null;
  /** Resolved by the caller from `team_members`; null when the row is gone. */
  name?: string | null;
}

/** `open` and `callout` are the absence of a person, not a person. */
export function isPresenceState(state: string | null | undefined): boolean {
  const s = String(state ?? "scheduled").toLowerCase();
  return s !== "open" && s !== "callout";
}

/**
 * The `[start, end)` instants a shift row occupies, or `null` when the row's
 * date or times cannot be read. Half-open for the same reason
 * `isWithinQuietHours` is: it makes "covered" and "not covered" exhaustive, so
 * a shift ending at 23:00 and one starting at 23:00 do not both claim 23:00.
 */
export function shiftWindow(
  row: ShiftRow,
  timeZone: string,
): { start: Date; end: Date } | null {
  const date = parseDateOnly(row.shift_date ?? null);
  if (!date) return null;
  const startMin = parseWallTime(row.start_time ?? null);
  const endMin = parseWallTime(row.end_time ?? null);
  if (startMin === null || endMin === null) return null;

  const start = zonedWallTimeToInstant(
    date.year,
    date.month,
    date.day,
    Math.floor(startMin / 60),
    startMin % 60,
    timeZone,
  );

  // Crosses midnight when the end is at or before the start — ScheduleService's
  // own rule. `end === start` is read as a full 24 hours rather than as a
  // zero-length shift, because a zero-length shift is not a thing a scheduler
  // creates and a 24-hour one (a two-day event) is.
  const crosses = endMin <= startMin;
  const endDay = crosses
    ? new Date(Date.UTC(date.year, date.month - 1, date.day + 1))
    : new Date(Date.UTC(date.year, date.month - 1, date.day));

  const end = zonedWallTimeToInstant(
    endDay.getUTCFullYear(),
    endDay.getUTCMonth() + 1,
    endDay.getUTCDate(),
    Math.floor(endMin / 60),
    endMin % 60,
    timeZone,
  );

  return { start, end };
}

/**
 * Which of these rows cover `instant`, de-duplicated by member.
 *
 * A member with two overlapping rows (a split shift wrongly entered, a cover
 * assigned on top of the original) appears once, keeping the first row's role.
 * Reporting them twice would make the sentence read as two people.
 */
export function onShiftAt(
  rows: ShiftRow[],
  instant: Date,
  timeZone: string,
): OnShift[] {
  const seen = new Set<string>();
  const out: OnShift[] = [];
  const t = instant.getTime();

  for (const row of rows) {
    if (!row.member_id) continue;
    if (!isPresenceState(row.state)) continue;
    const window = shiftWindow(row, timeZone);
    if (!window) continue;
    if (t < window.start.getTime() || t >= window.end.getTime()) continue;
    if (seen.has(row.member_id)) continue;
    seen.add(row.member_id);
    out.push({ memberId: row.member_id, role: row.role ?? null });
  }
  return out;
}

/**
 * The two local dates whose shifts could cover `instant`: the day itself and the
 * one before it, because a shift that began yesterday at 22:00 is still running
 * at 01:00 today. Returned as `YYYY-MM-DD` for the `shift_date` filter.
 */
export function candidateShiftDates(
  instant: Date,
  timeZone: string,
): [string, string] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(instant);
  const yesterday = fmt.format(new Date(instant.getTime() - 86_400_000));
  return [yesterday, today];
}
