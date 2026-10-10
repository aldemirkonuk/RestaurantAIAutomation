import type { CalendarEvent } from "@/api/types";
import { eventDayLabel, eventTimeLabel, eventTitle } from "@/components/team/teamEvents";

/**
 * F-1071: `/calendar/today` and `/calendar/upcoming` send the gateway's
 * `mapCalendarEvent` shape. The Team tab read `start_time` / `all_day`, which
 * that shape never carries, so no line ever showed a time or a day. These
 * fixtures are the wire shape (apps/api-gateway/src/calendar/calendar.service.ts).
 */
const wire = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "ev-1",
  restaurantId: "r-1",
  title: "Wine delivery",
  eventType: "delivery",
  eventDate: "2026-10-10",
  allDay: false,
  eventTime: "19:00:00",
  source: "manual",
  status: "scheduled",
  ...over,
});

describe("Team tab calendar lines read the gateway's shape (F-1071)", () => {
  const phoneZone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Detroit";
  });
  afterAll(() => {
    process.env.TZ = phoneZone;
  });

  it("shows the event's time on the house's clock", () => {
    expect(eventTimeLabel(wire({}), "tr-TR")).toBe("19:00");
    expect(eventTimeLabel(wire({}), "en-US")).toBe("7pm");
  });

  it("says all day for an all-day event, and nothing when no time is set", () => {
    expect(eventTimeLabel(wire({ allDay: true, eventTime: undefined }), "en-US")).toBe("All day");
    expect(eventTimeLabel(wire({ eventTime: undefined }), "en-US")).toBeNull();
  });

  it("prints the house's date as sent, never shifted by the phone's zone", () => {
    expect(eventDayLabel(wire({}), "en-US")).toBe("Sat, Oct 10");
    expect(eventDayLabel(wire({ eventDate: undefined }), "en-US")).toBeNull();
  });

  it("names the event by its title, then its kind", () => {
    expect(eventTitle(wire({}))).toBe("Wine delivery");
    expect(eventTitle(wire({ title: undefined }))).toBe("delivery");
  });
});
