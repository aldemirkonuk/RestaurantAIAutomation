/**
 * The reminder arithmetic, with no NestJS, no database and no wall clock.
 *
 * Every case here is one the sweep gets wrong if the arithmetic is wrong, and
 * each is written against an instant a human can check by hand.
 */

import {
  ALL_DAY_HOUR,
  eventStartInstant,
  isKnownTimeZone,
  isWithinQuietHours,
  nextTickAfter,
  parseWallTime,
  reminderDueAt,
  wallMinutesIn,
  zonedWallTimeToInstant,
  zoneOffsetMs,
} from "./reminder-window";

describe("zoneOffsetMs — a wall time is only an instant once you say whose wall", () => {
  it("reads a fixed-offset zone", () => {
    // 2026-01-15T12:00:00Z is 07:00 in New York (UTC-5, winter).
    const offset = zoneOffsetMs(
      new Date("2026-01-15T12:00:00Z"),
      "America/New_York",
    );
    expect(offset).toBe(-5 * 60 * 60 * 1000);
  });

  it("follows the zone across a DST boundary", () => {
    // Same zone, July: UTC-4.
    const summer = zoneOffsetMs(
      new Date("2026-07-15T12:00:00Z"),
      "America/New_York",
    );
    expect(summer).toBe(-4 * 60 * 60 * 1000);
  });

  it("reads a zone east of UTC", () => {
    const istanbul = zoneOffsetMs(
      new Date("2026-01-15T12:00:00Z"),
      "Europe/Istanbul",
    );
    expect(istanbul).toBe(3 * 60 * 60 * 1000);
  });
});

describe("zonedWallTimeToInstant", () => {
  it("turns 09:00 New York into the right UTC instant in winter", () => {
    expect(
      zonedWallTimeToInstant(2026, 1, 15, 9, 0, "America/New_York").toISOString(),
    ).toBe("2026-01-15T14:00:00.000Z");
  });

  it("turns 09:00 New York into the right UTC instant in summer", () => {
    expect(
      zonedWallTimeToInstant(2026, 7, 15, 9, 0, "America/New_York").toISOString(),
    ).toBe("2026-07-15T13:00:00.000Z");
  });

  it("is correct on the morning the clocks go forward", () => {
    // US DST starts 2026-03-08. 09:00 local that day is UTC-4, not UTC-5 —
    // the single-pass version of this function gets it wrong by an hour.
    expect(
      zonedWallTimeToInstant(2026, 3, 8, 9, 0, "America/New_York").toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");
  });

  it("handles a zone east of UTC", () => {
    expect(
      zonedWallTimeToInstant(2026, 1, 15, 9, 0, "Europe/Istanbul").toISOString(),
    ).toBe("2026-01-15T06:00:00.000Z");
  });
});

describe("eventStartInstant", () => {
  it("uses start_time for a timed entry", () => {
    const at = eventStartInstant(
      {
        start_date: "2026-01-15",
        start_time: "18:30:00",
        all_day: false,
      },
      "America/New_York",
    );
    expect(at?.toISOString()).toBe("2026-01-15T23:30:00.000Z");
  });

  it("uses 09:00 local for an all-day entry — the hour the browser scheduler used", () => {
    const at = eventStartInstant(
      { start_date: "2026-01-15", start_time: null, all_day: true },
      "America/New_York",
    );
    expect(ALL_DAY_HOUR).toBe(9);
    expect(at?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("ignores a stored time on an all-day entry", () => {
    const at = eventStartInstant(
      { start_date: "2026-01-15", start_time: "18:30:00", all_day: true },
      "America/New_York",
    );
    expect(at?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("falls back to event_date when start_date is absent", () => {
    const at = eventStartInstant(
      { start_date: null, event_date: "2026-01-15", all_day: true },
      "America/New_York",
    );
    expect(at?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("returns null rather than guessing a date", () => {
    expect(
      eventStartInstant({ start_date: null, event_date: null }, "UTC"),
    ).toBeNull();
    expect(eventStartInstant({ start_date: "not-a-date" }, "UTC")).toBeNull();
  });
});

describe("reminderDueAt", () => {
  it("subtracts whole days from the start", () => {
    const when = reminderDueAt(
      {
        start_date: "2026-01-15",
        start_time: "18:30:00",
        all_day: false,
        reminder_days_before: 2,
      },
      "America/New_York",
    );
    expect(when?.startAt.toISOString()).toBe("2026-01-15T23:30:00.000Z");
    expect(when?.dueAt.toISOString()).toBe("2026-01-13T23:30:00.000Z");
  });

  it("treats 0 as due at the start", () => {
    const when = reminderDueAt(
      {
        start_date: "2026-01-15",
        all_day: true,
        reminder_days_before: 0,
      },
      "America/New_York",
    );
    expect(when?.dueAt.toISOString()).toBe(when?.startAt.toISOString());
  });

  it("uses the column default of 1 when the value is absent or negative", () => {
    for (const value of [null, undefined, -3]) {
      const when = reminderDueAt(
        {
          start_date: "2026-01-15",
          all_day: true,
          reminder_days_before: value as number | null,
        },
        "America/New_York",
      );
      expect(when?.dueAt.toISOString()).toBe("2026-01-14T14:00:00.000Z");
    }
  });
});

describe("isWithinQuietHours", () => {
  const overnight = { enabled: true, start: "22:00", end: "08:00" };

  it("is quiet late at night inside an overnight window", () => {
    // 2026-01-15T04:00:00Z is 23:00 on the 14th in New York.
    expect(
      isWithinQuietHours(
        new Date("2026-01-15T04:00:00Z"),
        "America/New_York",
        overnight,
      ),
    ).toBe(true);
  });

  it("is quiet early in the morning inside an overnight window", () => {
    // 12:00Z is 07:00 New York.
    expect(
      isWithinQuietHours(
        new Date("2026-01-15T12:00:00Z"),
        "America/New_York",
        overnight,
      ),
    ).toBe(true);
  });

  it("is not quiet in the middle of the working day", () => {
    // 18:00Z is 13:00 New York.
    expect(
      isWithinQuietHours(
        new Date("2026-01-15T18:00:00Z"),
        "America/New_York",
        overnight,
      ),
    ).toBe(false);
  });

  it("reads the RESTAURANT's clock, not the server's", () => {
    // One instant, two houses: 06:00 in Istanbul (quiet) and 23:00 in New York
    // (also quiet) — but 14:00 in Istanbul vs 06:00 New York separates them.
    const instant = new Date("2026-01-15T11:00:00Z"); // 14:00 Istanbul, 06:00 NY
    expect(isWithinQuietHours(instant, "Europe/Istanbul", overnight)).toBe(false);
    expect(isWithinQuietHours(instant, "America/New_York", overnight)).toBe(true);
  });

  it("handles a same-day window", () => {
    const daytime = { enabled: true, start: "09:00", end: "17:00" };
    // 18:00Z = 13:00 NY, inside 09:00-17:00.
    expect(
      isWithinQuietHours(
        new Date("2026-01-15T18:00:00Z"),
        "America/New_York",
        daytime,
      ),
    ).toBe(true);
    // 03:00Z = 22:00 NY the previous day, outside it.
    expect(
      isWithinQuietHours(
        new Date("2026-01-15T03:00:00Z"),
        "America/New_York",
        daytime,
      ),
    ).toBe(false);
  });

  it("is never quiet when the preference is off", () => {
    expect(
      isWithinQuietHours(new Date("2026-01-15T04:00:00Z"), "America/New_York", {
        ...overnight,
        enabled: false,
      }),
    ).toBe(false);
  });

  it("does NOT silence a reminder for ever on a malformed window", () => {
    // A garbage preference must not become permanent quiet. Reported by the
    // caller, treated as not-quiet here.
    expect(
      isWithinQuietHours(new Date("2026-01-15T04:00:00Z"), "America/New_York", {
        enabled: true,
        start: "nonsense",
        end: "08:00",
      }),
    ).toBe(false);
    expect(
      isWithinQuietHours(new Date("2026-01-15T04:00:00Z"), "America/New_York", {
        enabled: true,
        start: "22:00",
        end: "22:00",
      }),
    ).toBe(false);
  });
});

describe("nextTickAfter", () => {
  it("lands on the next quarter hour", () => {
    expect(
      nextTickAfter(new Date("2026-01-15T12:07:31Z"), 15).toISOString(),
    ).toBe("2026-01-15T12:15:00.000Z");
  });

  it("moves on when the clock is exactly on a boundary", () => {
    expect(
      nextTickAfter(new Date("2026-01-15T12:15:00Z"), 15).toISOString(),
    ).toBe("2026-01-15T12:30:00.000Z");
  });

  it("rolls the hour", () => {
    expect(
      nextTickAfter(new Date("2026-01-15T12:52:00Z"), 15).toISOString(),
    ).toBe("2026-01-15T13:00:00.000Z");
  });
});

describe("small readers", () => {
  it("parses a wall time and rejects nonsense", () => {
    expect(parseWallTime("22:00")).toBe(22 * 60);
    expect(parseWallTime("07:30:00")).toBe(7 * 60 + 30);
    expect(parseWallTime("25:00")).toBeNull();
    expect(parseWallTime("")).toBeNull();
    expect(parseWallTime(null)).toBeNull();
  });

  it("reports an unknown zone rather than pretending", () => {
    expect(isKnownTimeZone("America/New_York")).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("reads minutes past local midnight", () => {
    expect(
      wallMinutesIn(new Date("2026-01-15T18:30:00Z"), "America/New_York"),
    ).toBe(13 * 60 + 30);
  });
});
