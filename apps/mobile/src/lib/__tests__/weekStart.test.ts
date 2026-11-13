/**
 * The phone asks for the week it is in on its own calendar. In Turkey a Monday
 * before 03:00 is still Sunday in UTC; printing through UTC asked for last week.
 */
// The zone comes from jest.tz.js (globalSetup); the first case proves it took.
import { localDate, weekStartOf } from "@/lib/weekStart";

/** A wall-clock moment on the phone's calendar (month is 1-based here). */
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min);

describe("weekStartOf (phone in Europe/Istanbul)", () => {
  it("runs in the zone it claims to (UTC+3), or every case below is moot", () => {
    expect(at(2026, 11, 16, 1).getTimezoneOffset()).toBe(-180);
  });

  it("Monday 01:30 is this Monday, not the Sunday before (UTC is still Sunday)", () => {
    expect(weekStartOf(at(2026, 11, 16, 1, 30))).toBe("2026-11-16");
  });

  it("Monday 00:00 is this Monday", () => {
    expect(weekStartOf(at(2026, 11, 16, 0, 0))).toBe("2026-11-16");
  });

  it("Sunday 23:59 belongs to the week that began the Monday before", () => {
    expect(weekStartOf(at(2026, 11, 22, 23, 59))).toBe("2026-11-16");
  });

  it("mid-week days fall back to their Monday", () => {
    expect(weekStartOf(at(2026, 11, 18, 2, 0))).toBe("2026-11-16");
    expect(weekStartOf(at(2026, 11, 21, 12, 0))).toBe("2026-11-16");
  });

  it("a week that starts in the previous month and year", () => {
    expect(weekStartOf(at(2027, 1, 1, 1, 0))).toBe("2026-12-28");
  });

  it("does not move the moment it was given", () => {
    const now = at(2026, 11, 19, 1, 0);
    const before = now.getTime();
    weekStartOf(now);
    expect(now.getTime()).toBe(before);
  });
});

describe("localDate", () => {
  it("prints the phone's calendar date, not the UTC one", () => {
    expect(localDate(at(2026, 3, 9, 0, 30))).toBe("2026-03-09");
  });
});
