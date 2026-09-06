import {
  calendarDateToUtcMidnight,
  resolveZone,
  zoneOffsetMs,
  zonedWallClockToUtc,
} from "./zoned-time";

/**
 * The zone conversion behind the iCal feed's second defect.
 *
 * Every assertion here is a number an external calendar client would show. The
 * bug this replaces was invisible in every test that existed, because the test
 * runner and the code shared one clock: `new Date('2026-08-03T09:00:00')` is
 * "correct" on a laptop in California and an hour off in London and seven off on
 * the deployed gateway. So these tests never read the process's zone.
 */

const HOUR = 3_600_000;

describe("resolveZone", () => {
  it("accepts a real IANA name", () => {
    expect(resolveZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveZone("Europe/Istanbul")).toBe("Europe/Istanbul");
  });

  it("returns null rather than guessing, for anything it cannot resolve", () => {
    // Each of these is a value production could actually hold: an empty
    // restaurants.timezone, a legacy abbreviation, a typo.
    expect(resolveZone(null)).toBeNull();
    expect(resolveZone(undefined)).toBeNull();
    expect(resolveZone("")).toBeNull();
    expect(resolveZone("   ")).toBeNull();
    expect(resolveZone("Not/AZone")).toBeNull();
  });
});

describe("zoneOffsetMs", () => {
  it("reads the winter and summer offsets of one zone apart", () => {
    // Los Angeles is UTC-8 in January and UTC-7 in July. If a conversion is
    // built on a fixed offset this is the assertion that catches it.
    const jan = new Date("2026-01-15T12:00:00Z");
    const jul = new Date("2026-07-15T12:00:00Z");
    expect(zoneOffsetMs(jan, "America/Los_Angeles")).toBe(-8 * HOUR);
    expect(zoneOffsetMs(jul, "America/Los_Angeles")).toBe(-7 * HOUR);
  });

  it("handles a zone whose offset is not a whole hour", () => {
    // Kolkata is UTC+5:30 all year. A naive implementation that rounds to hours
    // publishes every Indian house's deliveries half an hour out.
    expect(zoneOffsetMs(new Date("2026-03-01T00:00:00Z"), "Asia/Kolkata")).toBe(
      5.5 * HOUR,
    );
  });

  it("reads midnight correctly", () => {
    // Some ICU builds render hour 0 as "24" under hour12:false; a conversion
    // that does not fold it lands a full day out.
    const utcMidnight = new Date("2026-06-10T00:00:00Z");
    expect(zoneOffsetMs(utcMidnight, "UTC")).toBe(0);
  });
});

describe("zonedWallClockToUtc", () => {
  it("turns a Palo Alto delivery slot into the instant it names", () => {
    // The founder's own house. 09:00 on 3 August is PDT, UTC-7, so 16:00Z.
    const at = zonedWallClockToUtc("2026-08-03", "09:00", "America/Los_Angeles");
    expect(at.toISOString()).toBe("2026-08-03T16:00:00.000Z");
  });

  it("uses the winter offset for a winter date", () => {
    const at = zonedWallClockToUtc("2026-01-12", "09:00", "America/Los_Angeles");
    expect(at.toISOString()).toBe("2026-01-12T17:00:00.000Z");
  });

  it("lands the hour after a spring-forward boundary correctly", () => {
    // 2026-03-08 is the US spring forward. 03:00 local is PDT (UTC-7) even
    // though the offset an hour earlier was PST (UTC-8) — this is the case a
    // single-pass conversion gets wrong by an hour.
    const at = zonedWallClockToUtc("2026-03-08", "03:00", "America/Los_Angeles");
    expect(at.toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });

  it("resolves a wall clock inside the spring-forward gap forward", () => {
    // 02:30 on 2026-03-08 does not exist in Los Angeles. It must produce an
    // instant rather than an Invalid Date, and it must be a real one.
    const at = zonedWallClockToUtc("2026-03-08", "02:30", "America/Los_Angeles");
    expect(Number.isNaN(at.getTime())).toBe(false);
    expect(at.toISOString()).toBe("2026-03-08T09:30:00.000Z");
  });

  it("works for a non-US house, which is the reason the zone is a column", () => {
    // Europe/Istanbul is UTC+3 year-round since 2016.
    const at = zonedWallClockToUtc("2026-08-03", "19:30", "Europe/Istanbul");
    expect(at.toISOString()).toBe("2026-08-03T16:30:00.000Z");
  });

  it("defaults a missing time to midnight rather than to now", () => {
    const at = zonedWallClockToUtc("2026-08-03", null, "UTC");
    expect(at.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("calendarDateToUtcMidnight", () => {
  it("puts a calendar date at UTC midnight, so VALUE=DATE round-trips", () => {
    expect(calendarDateToUtcMidnight("2026-08-03").toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });

  it("keeps the date across a month boundary", () => {
    expect(calendarDateToUtcMidnight("2026-12-31").toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
  });
});
