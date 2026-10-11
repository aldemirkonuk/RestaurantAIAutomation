import type { CalendarEvent } from "@/api/types";
import { houseClock, houseDay } from "@/lib/houseMoney";
import type { ReadState } from "@/components/today/pulseStripView";

/**
 * The Team tab's calendar lines (F-1071). `/calendar/today` and
 * `/calendar/upcoming` send the gateway's `mapCalendarEvent` shape —
 * `eventDate`, `eventTime`, `allDay`, `eventType` — and the tab read
 * `start_time` / `all_day`, which never arrive, so no line ever showed a time
 * or a day.
 */

export function eventTitle(e: CalendarEvent): string {
  return e.title ?? e.eventType ?? "Event";
}

/** "All day", the time on the house's clock, or null when the event names none. */
export function eventTimeLabel(e: CalendarEvent, locale: string | null | undefined): string | null {
  if (e.allDay) return "All day";
  return houseClock(e.eventTime, locale) || null;
}

/**
 * The event's day in the house's words. `eventDate` is already the house's
 * date, so it is printed as written, never moved by a zone (F-1029).
 */
export function eventDayLabel(e: CalendarEvent, locale: string | null | undefined): string | null {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(e.eventDate ?? "")?.[0];
  if (!day) return null;
  return (
    houseDay(`${day}T12:00:00Z`, locale, "UTC", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }) || null
  );
}

/** Said when `/calendar/today` failed and nothing saved is on the phone (F-1375). */
export const TODAY_CALENDAR_READ_FAILED = "Couldn't read today's calendar.";
/** Said when `/calendar/upcoming` failed and nothing saved is on the phone (F-1375). */
export const UPCOMING_CALENDAR_READ_FAILED = "Couldn't read what's coming up.";

/**
 * "Quiet in here" only when every read answered and found nothing (F-1375,
 * ADR 0020): the rota read says nobody is on, and both calendar reads came
 * back empty. A failed or pending read is never quiet.
 */
export function teamIsQuiet(input: {
  tonight: "loading" | "shifts" | "none" | "error";
  today: ReadState;
  todayCount: number;
  upcoming: ReadState;
  upcomingCount: number;
}): boolean {
  return (
    input.tonight === "none" &&
    input.today === "ready" &&
    input.todayCount === 0 &&
    input.upcoming === "ready" &&
    input.upcomingCount === 0
  );
}
