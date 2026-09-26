/**
 * The one on-time rule — ADR 0207 (founder, 2026-09-21: question 6 "House's
 * local midnight", question 8 "count it as late"). Pure, nothing mocked.
 */

import {
  daysPast,
  deadlineOf,
  isPastDue,
  landedVerdict,
} from "./delivery-deadline";

const at = (iso: string) => Date.parse(iso);

describe("deadlineOf — midnight at the end of the expected day, on the house's clock", () => {
  it("is Istanbul's midnight for an Istanbul house", () => {
    const d = deadlineOf("2026-09-10", "Europe/Istanbul");
    expect(d).toMatchObject({ date: "2026-09-10", zone: "Europe/Istanbul" });
    expect(new Date(d!.earliest).toISOString()).toBe(
      "2026-09-10T21:00:00.000Z",
    );
    expect(d!.latest).toBe(d!.earliest);
  });

  it("follows daylight saving: Los Angeles in winter and in summer", () => {
    expect(
      new Date(
        deadlineOf("2026-01-15", "America/Los_Angeles")!.latest,
      ).toISOString(),
    ).toBe("2026-01-16T08:00:00.000Z");
    expect(
      new Date(
        deadlineOf("2026-07-15", "America/Los_Angeles")!.latest,
      ).toISOString(),
    ).toBe("2026-07-16T07:00:00.000Z");
  });

  it("reads only the date of a timestamp-shaped value and refuses a date that does not exist", () => {
    expect(deadlineOf("2026-09-10T15:00:00Z", "UTC")?.date).toBe("2026-09-10");
    expect(deadlineOf("2026-02-30", "UTC")).toBeNull();
    expect(deadlineOf("soon", "UTC")).toBeNull();
    expect(deadlineOf(null, "UTC")).toBeNull();
  });

  it("with no zone, spans every midnight the date could end at: UTC+14 to UTC-12", () => {
    const d = deadlineOf("2026-09-10", null)!;
    expect(new Date(d.earliest).toISOString()).toBe("2026-09-10T10:00:00.000Z");
    expect(new Date(d.latest).toISOString()).toBe("2026-09-11T12:00:00.000Z");
  });
});

describe("landedVerdict and isPastDue", () => {
  const ist = deadlineOf("2026-09-10", "Europe/Istanbul")!;

  it("is on time strictly before midnight, late from midnight on", () => {
    expect(landedVerdict(at("2026-09-10T20:59:59Z"), ist)).toBe("on_time");
    expect(landedVerdict(at("2026-09-10T21:00:00Z"), ist)).toBe("late");
  });

  it("with no zone, is undecided between the ends and decided outside them", () => {
    const d = deadlineOf("2026-09-10", null)!;
    expect(landedVerdict(at("2026-09-10T09:59:59Z"), d)).toBe("on_time");
    expect(landedVerdict(at("2026-09-10T10:00:00Z"), d)).toBe("undecided");
    expect(landedVerdict(at("2026-09-11T11:59:59Z"), d)).toBe("undecided");
    expect(landedVerdict(at("2026-09-11T12:00:00Z"), d)).toBe("late");
  });

  it("calls an order not landed past due only once midnight has passed everywhere it could be", () => {
    const d = deadlineOf("2026-09-10", null)!;
    expect(isPastDue(at("2026-09-11T11:59:59Z"), d)).toBe(false);
    expect(isPastDue(at("2026-09-11T12:00:00Z"), d)).toBe(true);
    expect(isPastDue(at("2026-09-10T21:00:00Z"), ist)).toBe(true);
    expect(isPastDue(at("2026-09-10T20:59:59Z"), ist)).toBe(false);
  });

  it("counts days late from the day after the expected day as day 1", () => {
    expect(daysPast(at("2026-09-10T21:00:00Z"), ist)).toBe(1);
    expect(daysPast(at("2026-09-11T20:59:59Z"), ist)).toBe(1);
    expect(daysPast(at("2026-09-11T21:00:00Z"), ist)).toBe(2);
  });
});
