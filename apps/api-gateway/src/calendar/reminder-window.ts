/**
 * When a calendar reminder is due, and whether the person it is for is asleep.
 *
 * Every function here is pure and exported so the arithmetic can be tested
 * without NestJS, a database or a clock — the same shape `computeNextFireAt`
 * takes in `communications/scheduled-tasks.service.ts:30`.
 *
 * THE TIMEZONE IS THE RESTAURANT'S, AND THAT IS A CHOICE
 * -----------------------------------------------------
 * A calendar event carries a `date` and a `time` with no zone
 * (`calendar_events.start_date` is `date`, `start_time` is `time without time
 * zone` — baseline:2371-2373). A wall time is only an instant once you say
 * whose wall it is. This module says: the restaurant's, from
 * `restaurants.timezone` (carried on `ScheduledTenant.timezone`,
 * scheduled-tenants.service.ts:18).
 *
 * The alternative — the server's local zone — is what the orchestrator's
 * notification agent does today: `_is_quiet_hours` compares against
 * `datetime.now()`
 * (`services/agent-orchestrator/agents/notification_agent.py:1487-1512`), so a
 * 22:00–08:00 window means 22:00 wherever the process happens to run. That is
 * wrong for a house in Istanbul and it is why this reads the tenant's zone
 * instead. The divergence is deliberate and recorded (calendar.md §9).
 */

/** Minutes past local midnight, in a named zone. */
export function wallMinutesIn(instant: Date, timeZone: string): number {
  const p = zoneParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * Offset of `timeZone` from UTC at `instant`, in ms (positive east of UTC).
 * Derived from `Intl`, so it is correct across DST without a tz database.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // `instant` carries ms; strip them so the difference is a whole-second offset.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a given wall-clock time occurs in `timeZone`.
 *
 * Two passes: guess the instant as if the wall time were UTC, measure the zone's
 * offset there, correct, then re-measure at the corrected instant. The second
 * pass is what makes a DST boundary come out right — the offset an hour before a
 * transition is not the offset an hour after it.
 */
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  const second = guess - zoneOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** `YYYY-MM-DD` → parts, or null when the string is not one. */
export function parseDateOnly(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

/** `HH:MM[:SS]` → minutes past midnight, or null. */
export function parseWallTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!m) return null;
  const hour = +m[1];
  const minute = +m[2];
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * An all-day entry has no time of its own, so the reminder needs one. 09:00
 * local is not invented here: it is the hour the browser scheduler this job
 * replaces has always used (`apps/web/src/lib/reminder-scheduler.ts:57`), and
 * keeping it means a house that was already being reminded at 9 keeps being
 * reminded at 9.
 */
export const ALL_DAY_HOUR = 9;

export interface ReminderEventShape {
  start_date?: string | null;
  event_date?: string | null;
  start_time?: string | null;
  event_time?: string | null;
  all_day?: boolean | null;
  reminder_days_before?: number | null;
}

/**
 * The instant the entry begins, in the restaurant's zone. `null` when the row
 * carries no readable date — which is a row this job must skip and say so, not
 * one it should guess a date for.
 */
export function eventStartInstant(
  row: ReminderEventShape,
  timeZone: string,
): Date | null {
  const date = parseDateOnly(row.start_date ?? row.event_date ?? null);
  if (!date) return null;
  const timed = row.all_day
    ? null
    : parseWallTime(row.start_time ?? row.event_time ?? null);
  const minutes = timed ?? ALL_DAY_HOUR * 60;
  return zonedWallTimeToInstant(
    date.year,
    date.month,
    date.day,
    Math.floor(minutes / 60),
    minutes % 60,
    timeZone,
  );
}

/**
 * When the reminder for that entry comes due.
 *
 * `reminder_days_before` is an INTEGER of days (baseline:2358), so this job is
 * day-granular by construction: "15 minutes before" is not representable in the
 * column and the page says so rather than offering a control that rounds. A
 * negative or absent value is read as 1, the column's own default.
 */
export function reminderDueAt(
  row: ReminderEventShape,
  timeZone: string,
): { dueAt: Date; startAt: Date } | null {
  const startAt = eventStartInstant(row, timeZone);
  if (!startAt) return null;
  const raw = row.reminder_days_before;
  const days = typeof raw === "number" && raw >= 0 ? Math.floor(raw) : 1;
  return {
    startAt,
    dueAt: new Date(startAt.getTime() - days * 24 * 60 * 60 * 1000),
  };
}

export interface QuietHours {
  enabled: boolean;
  /** `HH:MM`, the house's own vocabulary. */
  start: string;
  end: string;
}

/**
 * Is `instant` inside this person's quiet window, read on the restaurant's wall
 * clock? An unreadable window is NOT quiet — a malformed preference must not
 * silence a reminder for ever, and the caller logs it.
 */
export function isWithinQuietHours(
  instant: Date,
  timeZone: string,
  quiet: QuietHours,
): boolean {
  if (!quiet.enabled) return false;
  const start = parseWallTime(quiet.start);
  const end = parseWallTime(quiet.end);
  if (start === null || end === null) return false;
  if (start === end) return false;
  const now = wallMinutesIn(instant, timeZone);
  return start < end
    ? now >= start && now < end // same-day window, e.g. 09:00–17:00
    : now >= start || now < end; // overnight window, e.g. 22:00–08:00
}

/**
 * The next fire of a fixed every-N-minutes cron after `from`.
 *
 * Exact for minute-step expressions, which is the only shape this job uses, and
 * zone-independent for the same reason — a 15-minute step lands on the same
 * instants in every zone. Reported to the page as the *scheduled* next tick; the
 * page still pairs it with the last actual run, because a schedule is not
 * evidence that a process is alive.
 */
export function nextTickAfter(from: Date, intervalMinutes: number): Date {
  const step = Math.max(1, Math.floor(intervalMinutes));
  const stepMs = step * 60_000;
  const floored = Math.floor(from.getTime() / stepMs) * stepMs;
  return new Date(floored + stepMs);
}

/* ── internals ─────────────────────────────────────────────────────────────── */

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const hit = FORMATTERS.get(timeZone);
  if (hit) return hit;
  let made: Intl.DateTimeFormat;
  try {
    made = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // An unknown zone name must not throw a whole tenant's sweep away. UTC is
    // the substitution, and the caller records that the zone was unreadable.
    made = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  FORMATTERS.set(timeZone, made);
  return made;
}

/** True when `Intl` recognises the zone — so the caller can say it did not. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(instant: Date, timeZone: string): ZoneParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => {
    const found = parts.find((p) => p.type === type);
    return found ? parseInt(found.value, 10) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/* ── arming ───────────────────────────────────────────────────────────────── */

/**
 * The single env var that arms the calendar reminder cron.
 *
 * Off by default, and deliberately not wired to the page's Mudavym flag: the
 * job writes real notifications to real members' inboxes and phones, and the
 * design flag is about what a page LOOKS like. Nothing turns this on as a side
 * effect of enabling something else.
 *
 * The shape is copied from `RECURRING_ORDER_REMINDERS_ENABLED`
 * (`communications/recurring-order-reminder.ts:20`) for the same reason it was
 * written that way: an allow-list turns a typo into silence, a deny-list turns a
 * typo into a live sender, and silence is the recoverable failure.
 */
export const CALENDAR_REMINDER_FLAG = "CALENDAR_REMINDERS_ENABLED";

/** Only `"true"` and `"1"` (trimmed, lower-cased) arm it. Everything else is OFF. */
export function calendarRemindersArmed(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}
