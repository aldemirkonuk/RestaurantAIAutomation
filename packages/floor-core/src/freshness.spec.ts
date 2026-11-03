import {
  exactMinutesSince,
  freshnessOf,
  liveOnTimePct,
  minutesSince,
  seatingFreshness,
  STATUS_LABEL,
  STATUS_RANK,
} from "./freshness";
import { at, LATE, MIN, T0, WARN } from "./test-fixtures";

describe("minutesSince and exactMinutesSince", () => {
  it("is null without a time, never NaN", () => {
    expect(minutesSince(null, T0)).toBeNull();
    expect(minutesSince("", T0)).toBeNull();
    expect(minutesSince("not a time", T0)).toBeNull();
    expect(exactMinutesSince("not a time", T0)).toBeNull();
    expect(minutesSince(at(0), NaN)).toBeNull();
  });

  it("reads a time without an offset as unreadable, not as local time", () => {
    expect(exactMinutesSince("2026-11-03T14:00:00", T0)).toBeNull();
    expect(exactMinutesSince("2026-11-03 14:00:00", T0)).toBeNull();
    const iso = at(-5);
    expect(exactMinutesSince(iso, T0)).toBe(5);
    expect(exactMinutesSince(iso.replace("Z", "+00:00"), T0)).toBe(exactMinutesSince(iso, T0));
    expect(exactMinutesSince(iso.replace("Z", "+0000"), T0)).toBe(exactMinutesSince(iso, T0));
    expect(exactMinutesSince(iso.replace("Z", "+00"), T0)).toBe(exactMinutesSince(iso, T0));
    expect(exactMinutesSince("2026-11-03 12:00:00+00", T0)).toBeNull();
    expect(exactMinutesSince("2026-13-03T12:00:00Z", T0)).toBeNull();
  });

  it("reads an offset the way it is written", () => {
    const utc = "2026-11-03T12:00:00Z";
    const now = Date.parse(utc) + 30 * MIN;
    expect(exactMinutesSince("2026-11-03T15:00:00+03:00", now)).toBe(30);
    expect(exactMinutesSince("2026-11-03T07:00:00-0500", now)).toBe(30);
    expect(exactMinutesSince("2026-11-03T12:00:00.500Z", now)).toBeCloseTo(29.99, 2);
  });

  it("floors for display and keeps the fraction for statuses", () => {
    expect(minutesSince(at(0), T0 + 9.5 * MIN)).toBe(9);
    expect(exactMinutesSince(at(0), T0 + 9.5 * MIN)).toBe(9.5);
  });

  it("reads a time up to a minute ahead of now as 0, and further as unreadable (OD-257)", () => {
    expect(exactMinutesSince(at(1), T0)).toBe(0);
    expect(minutesSince(at(0.5), T0)).toBe(0);
    expect(exactMinutesSince(at(1.01), T0)).toBeNull();
    expect(exactMinutesSince(at(20), T0)).toBeNull();
    expect(seatingFreshness({ seatedAt: at(20), lastVisitAt: null }, WARN, LATE, T0)).toBe("late");
  });

  it("refuses a calendar date that does not exist", () => {
    expect(exactMinutesSince("2026-02-31T12:00:00Z", T0)).toBeNull();
    expect(exactMinutesSince("0026-11-03T12:00:00Z", T0)).toBeNull();
  });
});

describe("freshnessOf (ADR 0346 D4 (d))", () => {
  it("is on time at exactly T and due soon past it", () => {
    expect(freshnessOf(WARN, WARN, LATE)).toBe("fresh");
    expect(freshnessOf(WARN + 0.01, WARN, LATE)).toBe("warn");
    expect(freshnessOf(LATE, WARN, LATE)).toBe("late");
  });

  it("keeps Due soon reachable when late = warn + 1", () => {
    expect(freshnessOf(9, 9, 10)).toBe("fresh");
    expect(freshnessOf(9.5, 9, 10)).toBe("warn");
    expect(freshnessOf(10, 9, 10)).toBe("late");
  });

  it("has no Due soon when late is at or below the one-minute floor", () => {
    expect(freshnessOf(1, 0, 1)).toBe("late");
    expect(freshnessOf(0.5, 0, 1)).toBe("fresh");
  });

  it("takes T = max(1, warn), as the score does", () => {
    expect(freshnessOf(1, 0, 5)).toBe("fresh");
    expect(freshnessOf(1.5, 0, 5)).toBe("warn");
  });

  it("is idle only for null", () => {
    expect(freshnessOf(null, WARN, LATE)).toBe("idle");
  });

  it("reads a non-finite minute, or a null, missing or non-finite setting, as late (OD-256)", () => {
    expect(freshnessOf(NaN, WARN, LATE)).toBe("late");
    expect(freshnessOf(Infinity, WARN, LATE)).toBe("late");
    expect(freshnessOf(3, NaN, LATE)).toBe("late");
    expect(freshnessOf(3, WARN, -Infinity)).toBe("late");
    expect(freshnessOf(3, null as unknown as number, LATE)).toBe("late");
    expect(freshnessOf(3, WARN, undefined as unknown as number)).toBe("late");
  });
});

it("freshnessOf reads an undefined minute as idle, as seatingFreshness does", () => {
  expect(freshnessOf(undefined as unknown as null, WARN, LATE)).toBe("idle");
});

describe("seatingFreshness", () => {
  const now = T0 + 9.5 * MIN;

  it("is idle only with no open seating", () => {
    expect(seatingFreshness({ seatedAt: null, lastVisitAt: null }, 9, 10, now)).toBe("idle");
  });

  it("falls back to the seat time for an unvisited party", () => {
    expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: null }, 9, 10, now)).toBe("warn");
  });

  it("prefers the last visit", () => {
    expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: at(5) }, 9, 10, now)).toBe("fresh");
  });

  it("reads an anchor that cannot be read as late", () => {
    expect(seatingFreshness({ seatedAt: "garbage", lastVisitAt: null }, 9, 10, now)).toBe("late");
    expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: null }, 9, 10, NaN)).toBe("late");
  });
});

describe("labels, ranks and the live on-time share", () => {
  it("freezes the label and rank tables", () => {
    expect(Object.isFrozen(STATUS_LABEL)).toBe(true);
    expect(Object.isFrozen(STATUS_RANK)).toBe(true);
    expect(STATUS_RANK.late).toBeLessThan(STATUS_RANK.warn);
  });

  it("prints no evidence as null (ADR 0346 D4 (a))", () => {
    expect(liveOnTimePct([])).toBeNull();
    expect(liveOnTimePct(["fresh", "late", "fresh"])).toBe(67);
  });
});
