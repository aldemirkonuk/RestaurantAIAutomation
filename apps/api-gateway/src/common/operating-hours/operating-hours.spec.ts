/**
 * The TypeScript mirror against the SHARED fixture (ADR 0093 D1).
 *
 * `datasets/sim/fixtures/operating-hours-cases.json` is the same file
 * `scripts/test_simulate_hours.py` runs. Two implementations of one rule drift
 * the moment they stop reading the same cases, and the DST arithmetic here is
 * hand-rolled (`Intl`, no timezone library), so the fixture is the only thing
 * proving it reproduces `zoneinfo` at `fold=0`.
 *
 * Add cases to the fixture, not to this file — a case added here would be
 * invisible to the Python suite, which is the drift it is meant to prevent.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import {
  isOpenAt,
  OperatingHours,
  OperatingHoursError,
  parseOperatingHours,
  serviceWindows,
  toJson,
  wallToInstant,
  WEEKDAYS,
} from "./operating-hours";

// src/common/operating-hours -> src -> api-gateway -> apps -> <repo root>
const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../../datasets/sim/fixtures/operating-hours-cases.json",
);

interface Fixture {
  _contract: Record<string, unknown>;
  hours: Record<string, unknown>;
  parse_cases: Array<{
    name: string;
    hours?: string;
    raw?: unknown;
    valid: boolean;
  }>;
  open_cases: Array<{
    name: string;
    hours: string | null;
    timezone: string | null;
    instant: string;
    open: boolean | null;
    reason?: string;
  }>;
  window_cases: Array<{
    name: string;
    hours: string | Record<string, unknown>;
    timezone: string;
    date: string;
    windows: Array<[string, string]>;
  }>;
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function hoursOf(
  ref: string | Record<string, unknown> | null | undefined,
): unknown {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === "string") return fixture.hours[ref];
  return ref;
}

const iso = (s: string): Date => new Date(s);

describe("operating-hours (shared fixture)", () => {
  it("reads the same fixture the Python suite reads", () => {
    // A wrong relative depth would silently make every table below empty, and an
    // empty table is a passing suite. Prove the file is there and is the one.
    expect(existsSync(FIXTURE_PATH)).toBe(true);
    expect(FIXTURE_PATH).toContain(
      "datasets/sim/fixtures/operating-hours-cases.json",
    );
    expect(fixture._contract).toBeDefined();
  });

  it("fixture is not vacuous", () => {
    expect(fixture.parse_cases.length).toBeGreaterThanOrEqual(10);
    expect(fixture.open_cases.length).toBeGreaterThanOrEqual(20);
    expect(fixture.window_cases.length).toBeGreaterThanOrEqual(6);
    // The same three floors `test_fixture_is_not_vacuous` asserts in Python.
  });

  describe("parse_cases", () => {
    it.each(fixture.parse_cases.map((c) => [c.name, c] as const))(
      "%s",
      (_name, c) => {
        const raw =
          "hours" in c && c.hours !== undefined ? hoursOf(c.hours) : c.raw;
        if (c.valid) {
          const parsed = parseOperatingHours(raw);
          expect(toJson(parsed)).toEqual(raw);
        } else {
          expect(() => parseOperatingHours(raw)).toThrow(OperatingHoursError);
        }
      },
    );

    it("lists every fault, not just the first", () => {
      let caught: OperatingHoursError | null = null;
      try {
        parseOperatingHours({
          mon: [{ open: "25:00", close: "26:00" }],
          tue: "nope",
          wed: [],
          thu: [],
          fri: [],
          sat: [],
          sun: [],
          hol: [],
        });
      } catch (e) {
        caught = e as OperatingHoursError;
      }
      expect(caught).toBeInstanceOf(OperatingHoursError);
      expect(caught!.errors.length).toBeGreaterThanOrEqual(3);
      expect(caught!.errors.join("\n")).toContain("unknown keys: hol");
      expect(caught!.errors.join("\n")).toContain(
        "tue: must be a list of ranges",
      );
    });
  });

  describe("open_cases", () => {
    it.each(fixture.open_cases.map((c) => [c.name, c] as const))(
      "%s",
      (_name, c) => {
        const state = isOpenAt(hoursOf(c.hours), c.timezone, iso(c.instant));
        expect(state.open).toBe(c.open);
        if (c.reason !== undefined && c.reason !== null) {
          expect(state.reason).toBe(c.reason);
        }
        if (state.open === true) {
          expect(state.window).toBeDefined();
          expect(state.window!.start.getTime()).toBeLessThanOrEqual(
            iso(c.instant).getTime(),
          );
          expect(state.window!.end.getTime()).toBeGreaterThan(
            iso(c.instant).getTime(),
          );
        }
      },
    );
  });

  describe("window_cases", () => {
    it.each(fixture.window_cases.map((c) => [c.name, c] as const))(
      "%s",
      (_name, c) => {
        const got = serviceWindows(hoursOf(c.hours), c.timezone, c.date);
        expect(
          got.map((w) => [w.start.toISOString(), w.end.toISOString()]),
        ).toEqual(
          c.windows.map(([a, b]) => [
            iso(a).toISOString(),
            iso(b).toISOString(),
          ]),
        );
      },
    );
  });

  describe("unknown is never false (ADR 0020)", () => {
    const instant = new Date("2026-09-02T12:00:00Z");

    it("null hours", () => {
      expect(isOpenAt(null, "UTC", instant)).toEqual({
        open: null,
        reason: "hours_unknown",
      });
    });

    it("undefined hours — the shape a missing column takes in TypeScript", () => {
      expect(isOpenAt(undefined, "UTC", instant)).toEqual({
        open: null,
        reason: "hours_unknown",
      });
    });

    it("partial hours are invalid, not closed", () => {
      expect(isOpenAt({ mon: [] }, "UTC", instant)).toEqual({
        open: null,
        reason: "hours_invalid",
      });
    });

    it("null timezone", () => {
      expect(isOpenAt(fixture.hours.bistro, null, instant)).toEqual({
        open: null,
        reason: "timezone_unknown",
      });
    });

    it("empty-string timezone", () => {
      expect(isOpenAt(fixture.hours.bistro, "", instant)).toEqual({
        open: null,
        reason: "timezone_unknown",
      });
    });
  });

  describe("serviceWindows refuses rather than guessing", () => {
    it("unknown timezone throws", () => {
      expect(() =>
        serviceWindows(fixture.hours.bistro, "Mars/Olympus", "2026-09-02"),
      ).toThrow("timezone_unknown");
    });

    it("unknown hours throw", () => {
      expect(() => serviceWindows(null, "UTC", "2026-09-02")).toThrow(
        OperatingHoursError,
      );
    });

    it("invalid hours throw", () => {
      expect(() => serviceWindows({ mon: [] }, "UTC", "2026-09-02")).toThrow(
        OperatingHoursError,
      );
    });

    it("a malformed date is refused, not rolled over", () => {
      expect(() =>
        serviceWindows(fixture.hours.bistro, "UTC", "2026-02-30"),
      ).toThrow(RangeError);
      expect(() =>
        serviceWindows(fixture.hours.bistro, "UTC", "02/09/2026"),
      ).toThrow(RangeError);
    });
  });

  describe("toJson", () => {
    it("round-trips every named fixture shape", () => {
      for (const [name, raw] of Object.entries(fixture.hours)) {
        const parsed: OperatingHours = parseOperatingHours(raw);
        expect(toJson(parsed)).toEqual(raw);
        expect(Object.keys(toJson(parsed))).toEqual([...WEEKDAYS]);
        expect(name).toBeTruthy();
      }
    });
  });
  describe("DST resolution is zoneinfo fold=0, not the fixture prose", () => {
    // These cases CANNOT live in the shared fixture: the fixture's own
    // `_contract.resolution_rule` prescribes an algorithm that disagrees with
    // `fold=0` in positive-offset zones, and the fixture is not this builder's
    // file to edit. The expected instants below are what
    // `datetime(..., tzinfo=ZoneInfo(zone)).astimezone(utc)` returns — measured
    // with Python 2026-09-02, the same call `scripts/simulate/hours.py` makes.
    //
    // No venue in this repo is in one of these zones today (35 America/Chicago,
    // 12 America/New_York, 7 America/Los_Angeles, 3 Europe/Istanbul), so the
    // divergence is latent, not live. It is pinned here so the first European
    // or Australian tenant does not discover it as a one-hour-a-year bug.
    const cases: Array<[string, string, number[], string]> = [
      // zone, what it is, [Y, M, D, h, m] local, expected UTC instant
      [
        "Europe/Berlin",
        "fall-back ambiguous 02:30 → FIRST occurrence (CEST)",
        [2026, 10, 25, 2, 30],
        "2026-10-25T00:30:00.000Z",
      ],
      [
        "Europe/Berlin",
        "spring-forward gap 02:30 → PRE-transition offset (CET)",
        [2026, 3, 29, 2, 30],
        "2026-03-29T01:30:00.000Z",
      ],
      [
        "Europe/London",
        "fall-back ambiguous 01:30 → FIRST occurrence (BST)",
        [2026, 10, 25, 1, 30],
        "2026-10-25T00:30:00.000Z",
      ],
      [
        "Australia/Sydney",
        "fall-back ambiguous 02:30 → FIRST occurrence (AEDT)",
        [2026, 4, 5, 2, 30],
        "2026-04-04T15:30:00.000Z",
      ],
      [
        "Australia/Sydney",
        "spring-forward gap 02:30 → PRE-transition offset (AEST)",
        [2026, 10, 4, 2, 30],
        "2026-10-03T16:30:00.000Z",
      ],
      // The negative-offset cases the fixture DOES cover, restated here so a
      // regression in either direction is visible in one place.
      [
        "America/Chicago",
        "fall-back ambiguous 01:30 → FIRST occurrence (CDT)",
        [2026, 11, 1, 1, 30],
        "2026-11-01T06:30:00.000Z",
      ],
      [
        "America/Chicago",
        "spring-forward gap 02:30 → PRE-transition offset (CST)",
        [2026, 3, 8, 2, 30],
        "2026-03-08T08:30:00.000Z",
      ],
    ];

    it.each(cases)("%s: %s", (zone, _what, local, expected) => {
      const [y, mo, d, h, mi] = local;
      expect(wallToInstant(zone, y, mo, d, h, mi).toISOString()).toBe(expected);
    });

    it("the fixture discriminates the shorter recipe: it agrees west of Greenwich and fails east of it", () => {
      // Guards the claim above from the other side: wherever the fixture DOES
      // define the answer, the two rules must not part company, or this file
      // would be quietly asserting something the Python suite denies.
      const recipe = (
        zone: string,
        y: number,
        mo: number,
        d: number,
        h: number,
        mi: number,
      ): number => {
        const guess = Date.UTC(y, mo - 1, d, h, mi);
        const offsetAt = (ms: number): number => {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).formatToParts(new Date(ms));
          const g = (t: string) =>
            Number(parts.find((x) => x.type === t)!.value);
          return (
            Date.UTC(
              g("year"),
              g("month") - 1,
              g("day"),
              g("hour"),
              g("minute"),
              g("second"),
            ) - ms
          );
        };
        const rt = (ms: number): boolean => {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).formatToParts(new Date(ms));
          const g = (t: string) =>
            Number(parts.find((x) => x.type === t)!.value);
          return (
            g("year") === y &&
            g("month") === mo &&
            g("day") === d &&
            g("hour") === h &&
            g("minute") === mi
          );
        };
        const c1 = guess - offsetAt(guess);
        const c2 = guess - offsetAt(c1);
        if (rt(c1)) return c1;
        if (rt(c2)) return c2;
        return c1;
      };

      let compared = 0;
      const disagreeZones = new Set<string>();
      for (const c of fixture.window_cases) {
        const hours = hoursOf(c.hours) as Record<
          string,
          Array<{ open: string; close: string }>
        >;
        const [y, mo, d] = c.date.split("-").map(Number);
        for (const ranges of Object.values(hours)) {
          for (const r of ranges) {
            for (const hhmm of [r.open, r.close]) {
              const [h, mi] = hhmm.split(":").map(Number);
              const agree =
                recipe(c.timezone, y, mo, d, h, mi) ===
                wallToInstant(c.timezone, y, mo, d, h, mi).getTime();
              if (!agree) disagreeZones.add(c.timezone);
              else compared += 1;
            }
          }
        }
      }
      expect(compared).toBeGreaterThan(20);
      // The Berlin/Sydney cases were added to the fixture on 2026-09-02 precisely
      // because the naive recipe inverts both DST rules east of Greenwich. If this
      // set is ever empty again, the fixture has lost its discriminating cases.
      expect([...disagreeZones].sort()).toEqual(["Australia/Sydney", "Europe/Berlin"]);
    });
  });
});
