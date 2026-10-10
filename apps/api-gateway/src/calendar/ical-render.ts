import ical from "ical-generator";
import { calendarDateToUtcMidnight, zonedWallClockToUtc } from "./zoned-time";

/**
 * The iCal text a calendar link answers with. Pure: the rows go in, the
 * VCALENDAR comes out, and nothing here reads the database or the clock —
 * `CalendarLinksService` decides WHAT a person may see (`feed-scope.ts`) and
 * hands only that here.
 *
 * The event half moved here unchanged from `CalendarService.getICalFeed`
 * (ADR 0111 §5's four subscribe fixes: the restaurant's zone, floating when it
 * has none, a UTC-midnight carrier for all-day dates, and the refresh hint).
 * `ical-feed.spec.ts` pins all of it against this function.
 */

/**
 * How often a subscriber should come back, in seconds.
 *
 * Emitted as both `REFRESH-INTERVAL` (RFC 7986 §5.7) and the pre-standard
 * `X-PUBLISHED-TTL` that Outlook and Apple actually read. Without either,
 * every client picks its own interval — Google's has been observed at up to
 * 24 hours — and a delivery moved this morning shows up tomorrow. One hour is
 * the shortest value the major clients honour; asking for less does not make
 * them poll faster.
 */
export const ICAL_TTL_SECONDS = 3600;

/**
 * No leading dash: ical-generator prepends the "-" that RFC 5545's FPI
 * convention requires, so "-//…" here emitted "PRODID:--//WineOps//…".
 */
const PROD_ID = "//WineOps//Restaurant Calendar//EN";

/** The words the expired notice carries. The founder's, 2026-09-21. */
export const EXPIRED_NOTICE_TITLE = "Calendar link expired - connect again";
const EXPIRED_NOTICE_BODY =
  "This calendar link no longer works. Open Mudavym and connect your calendar again.";

export interface FeedEventRow {
  id: string;
  title: string;
  description?: string | null;
  start_date: string;
  start_time?: string | null;
  end_date?: string | null;
  end_time?: string | null;
  all_day?: boolean | null;
  status?: string | null;
  is_recurring?: boolean | null;
  event_type?: string | null;
}

export interface FeedRecurrenceRule {
  calendar_event_id: string;
  frequency: string;
  interval_value?: number | null;
  end_on_date?: string | null;
  end_after_count?: number | null;
  days_of_week?: number[] | null;
  day_of_month?: number | null;
}

/** A shift, already worded for this reader. Labor cost never reaches here. */
export interface FeedShift {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  summary: string;
  /** The schedule for that week is not published: a draft, said so. */
  draft: boolean;
  /** The person called out of this shift. */
  calledOut: boolean;
}

export interface FeedInput {
  calendarName: string;
  /** An IANA zone this Node build resolves, or null (see `resolveZone`). */
  zone: string | null;
  events: readonly FeedEventRow[];
  rules: readonly FeedRecurrenceRule[];
  shifts: readonly FeedShift[];
}

const FREQ: Record<string, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

// RFC 5545 day codes indexed by JS day number (0=Sunday … 6=Saturday)
const DAY_CODES: Record<number, string> = {
  0: "SU",
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
};

function addDaysIso(date: string, days: number): string {
  const d = calendarDateToUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "9:00" / "09:00" / "09:00:00" → "09:00". */
function hhmm(time: string): string {
  const [h, m] = time.split(":");
  return `${String(Number(h)).padStart(2, "0")}:${String(Number(m ?? 0)).padStart(2, "0")}`;
}

/**
 * A stored wall clock as the Date ical-generator should print.
 *
 * With a zone: the true instant. Without one: a carrier whose UTC fields ARE
 * the wall clock, printed floating (RFC 5545 §3.3.5 form one) — "09:00
 * wherever you are", which is the honest reading of a time with no zone.
 */
function wallClock(date: string, time: string, zone: string | null): Date {
  return zone
    ? zonedWallClockToUtc(date, time, zone)
    : new Date(`${date}T${time}:00.000Z`);
}

/** A Date as an RFC 5545 UTC DATE-TIME: "20261014T205959Z". */
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

/**
 * The UNTIL for a series whose last kept day is `lastDay` (F-376, F-792).
 *
 * UNTIL is inclusive, so it has to land AFTER that day's occurrence: the end
 * of the house's own day, as UTC. Midnight UTC at the start of the day came
 * before that day's occurrence and dropped it. An all-day series
 * ends on the date itself, and a floating one ends on a floating time — RFC
 * 5545 §3.3.10 wants UNTIL in the same form as DTSTART.
 */
function untilFor(
  lastDay: string,
  allDay: boolean,
  zone: string | null,
): string {
  const compact = lastDay.replace(/-/g, "");
  if (allDay) return compact;
  if (!zone) return `${compact}T235959`;
  const nextMidnight = zonedWallClockToUtc(
    addDaysIso(lastDay, 1),
    "00:00",
    zone,
  );
  return utcStamp(new Date(nextMidnight.getTime() - 1000));
}

export function renderFeed(input: FeedInput): string {
  const { zone } = input;
  const calendar = ical({
    name: input.calendarName,
    prodId: PROD_ID,
    // REFRESH-INTERVAL + X-PUBLISHED-TTL. See ICAL_TTL_SECONDS.
    ttl: ICAL_TTL_SECONDS,
  });

  const rulesByEvent = new Map<string, FeedRecurrenceRule>();
  for (const rule of input.rules)
    rulesByEvent.set(rule.calendar_event_id, rule);

  for (const event of input.events) {
    const status =
      event.status === "cancelled" || event.status === "dismissed"
        ? "CANCELLED"
        : event.status === "pending"
          ? "TENTATIVE"
          : "CONFIRMED";

    const startDateStr = event.start_date;
    const endDateStr = event.end_date || event.start_date;

    let start: Date;
    let end: Date;
    if (event.all_day) {
      // A calendar date has no zone. ical-generator renders VALUE=DATE from
      // the Date's UTC fields, so UTC midnight is the only carrier that
      // round-trips the stored date unchanged on any server.
      start = calendarDateToUtcMidnight(startDateStr);
      end = calendarDateToUtcMidnight(endDateStr);
      end.setUTCDate(end.getUTCDate() + 1);
    } else {
      start = wallClock(startDateStr, event.start_time || "00:00", zone);
      // An entry that ends before it starts, with no end date or one equal to
      // its start date, runs past midnight to the next morning (F-790, F-820).
      // Equal times are a zero-length moment that day, as the grid draws it.
      // The sheet and the grid (EventSheet.tsx, TimeGrid.tsx) read the same.
      const overnight =
        (!event.end_date || event.end_date === startDateStr) &&
        !!event.start_time &&
        !!event.end_time &&
        hhmm(event.end_time) < hhmm(event.start_time);
      end = wallClock(
        overnight ? addDaysIso(startDateStr, 1) : endDateStr,
        event.end_time || "23:59",
        zone,
      );
    }

    const calEvent = calendar.createEvent({
      id: `${event.id}@wineops.app`,
      start,
      end,
      summary: event.title,
      description: event.description || undefined,
      allDay: !!event.all_day,
      // Floating only where the zone is genuinely unknown; an all-day event
      // is already zone-free and must not be marked floating as well.
      floating: !event.all_day && !zone,
      status: status as any,
    });

    const rule = rulesByEvent.get(event.id);
    if (event.is_recurring && rule && FREQ[rule.frequency]) {
      let rrule = `FREQ=${FREQ[rule.frequency]}`;
      if (rule.interval_value && rule.interval_value > 1)
        rrule += `;INTERVAL=${rule.interval_value}`;
      if (rule.end_on_date)
        rrule += `;UNTIL=${untilFor(rule.end_on_date, !!event.all_day, zone)}`;
      if (rule.end_after_count) rrule += `;COUNT=${rule.end_after_count}`;
      // A monthly entry on the 29th-31st falls on the last day of a shorter
      // month, as the app shows it (F-199, F-791). A plain FREQ=MONTHLY skips
      // those months instead, so name every day up to the chosen one and keep
      // the last that the month has.
      const monthDay = rule.day_of_month ?? Number(startDateStr.slice(8, 10));
      if (
        rule.frequency === "monthly" &&
        monthDay > 28 &&
        !rule.days_of_week?.length
      ) {
        const days: number[] = [];
        for (let d = 28; d <= monthDay; d++) days.push(d);
        rrule += `;BYMONTHDAY=${days.join(",")};BYSETPOS=-1`;
      }
      if (rule.days_of_week && rule.days_of_week.length > 0) {
        const codes = rule.days_of_week
          .map((d) => DAY_CODES[d])
          .filter(Boolean);
        if (codes.length > 0) rrule += `;BYDAY=${codes.join(",")}`;
      }
      (calEvent as any).repeating(rrule);
    }
  }

  for (const shift of input.shifts) {
    const startTime = hhmm(shift.start_time);
    const endTime = hhmm(shift.end_time);
    // A shift that ends before it starts runs past midnight. Equal times are
    // a zero-length moment that day, the same rule as entries (F-820, F-821):
    // a shift row has no end date, so it cannot say "a full 24 hours".
    const endDate =
      endTime < startTime ? addDaysIso(shift.shift_date, 1) : shift.shift_date;
    calendar.createEvent({
      id: `shift-${shift.id}@wineops.app`,
      start: wallClock(shift.shift_date, startTime, zone),
      end: wallClock(endDate, endTime, zone),
      summary: shift.draft ? `${shift.summary} (draft)` : shift.summary,
      description: shift.draft
        ? "The schedule for this week is not published yet, so this shift may still change."
        : undefined,
      floating: !zone,
      status: (shift.calledOut
        ? "CANCELLED"
        : shift.draft
          ? "TENTATIVE"
          : "CONFIRMED") as any,
    });
  }

  return calendar.toString();
}

/**
 * The one answer every dead address gets: a revoked link, a rotated-away
 * secret, a person who left the house, the retired shared house link, and a
 * string that was never a link at all.
 *
 * The founder, 2026-09-21: *"an empty calendar with a little text appeared,
 * and saying calendar link expired, connect again"*. So a subscriber's app
 * shows a line in the calendar itself — which is where the person is looking
 * — instead of an error their app would bury or a silently empty calendar.
 *
 * It carries NO data: no house name, no person, nothing from the address. And
 * it is byte-identical for every one of those causes at a given moment, so
 * the answer cannot be used to tell a once-real secret from a guessed one
 * (T-30-09's reason for never answering 404). Everything in it is derived from
 * the calendar date alone: a fixed UID, and DTSTAMP pinned to that date, so
 * two requests on the same UTC day are the same bytes.
 *
 * The event spans yesterday to tomorrow (UTC) so it sits on "today" in every
 * zone; the hourly refresh keeps moving it along.
 */
export function expiredNoticeFeed(now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const calendar = ical({
    name: "Mudavym",
    prodId: PROD_ID,
    ttl: ICAL_TTL_SECONDS,
  });
  calendar.createEvent({
    id: "calendar-link-expired@wineops.app",
    start: calendarDateToUtcMidnight(addDaysIso(today, -1)),
    end: calendarDateToUtcMidnight(addDaysIso(today, 2)),
    stamp: calendarDateToUtcMidnight(today),
    allDay: true,
    summary: EXPIRED_NOTICE_TITLE,
    description: EXPIRED_NOTICE_BODY,
  });
  return calendar.toString();
}
