import {
  ORDER_RECURRENCE_FREQUENCIES,
  ORDER_RECURRENCE_STATUSES,
  anchorKindFor,
  anchorRangeFor,
  firstOccurrenceOn,
  isDueOn,
  nextOccurrenceOn,
  occurrencesFrom,
  planRecurrence,
  readCalendarDate,
  readRecurrenceFrequency,
  readRecurrenceStatus,
  validateAnchorDay,
} from "./order-recurrence";
import { RECURRING_FREQUENCIES } from "./recurring-orders.service";

/**
 * The rule an order repeats by — the pure half.
 *
 * Everything here runs without a database, a Nest container or a clock, which
 * is the point of splitting `order-recurrence.ts` out of the service: a
 * statement about dates should be provable as a statement about dates.
 *
 * THE TWO BUGS THESE TESTS EXIST TO PIN
 *
 *   1. UTC-vs-local drift. `new Date("2026-09-01")` is UTC midnight and every
 *      JavaScript getter is local, so west of Greenwich a monthly rule set for
 *      the 1st came back as the 2nd — correct on Railway, wrong on a laptop.
 *      `describe("the timezone the machine is in")` runs the same assertions
 *      under a forced negative offset.
 *   2. The `default:` arm. `calculateNextOrderDate` used to return +1 month for
 *      anything it did not recognise, so a DAILY rule ran MONTHLY and nothing
 *      said so.
 */

describe("the vocabulary", () => {
  it("is the same five frequencies the recurring_orders table already speaks", () => {
    // Not a style assertion. `order-recurrence.ts` re-declares the five rather
    // than importing them, so that a pure module does not have to pull in Nest,
    // @nestjs/schedule, DatabaseService, ProcurementService and
    // OrchestratorService to learn five strings. This is the test that stops
    // the two copies drifting.
    expect([...ORDER_RECURRENCE_FREQUENCIES]).toEqual([
      ...RECURRING_FREQUENCIES,
    ]);
  });

  it("has exactly three statuses, and paused is not the same as ended", () => {
    expect([...ORDER_RECURRENCE_STATUSES]).toEqual([
      "active",
      "paused",
      "ended",
    ]);
  });

  it("reads a stored frequency, and refuses one it does not know", () => {
    expect(readRecurrenceFrequency("Weekly")).toBe("weekly");
    expect(readRecurrenceFrequency("  monthly ")).toBe("monthly");
    expect(readRecurrenceFrequency("fortnightly")).toBeNull();
    expect(readRecurrenceFrequency("")).toBeNull();
    expect(readRecurrenceFrequency(null)).toBeNull();
    expect(readRecurrenceFrequency(7)).toBeNull();
  });

  it("reads a stored status, and refuses one it does not know", () => {
    expect(readRecurrenceStatus("ACTIVE")).toBe("active");
    expect(readRecurrenceStatus("cancelled")).toBeNull();
    expect(readRecurrenceStatus(undefined)).toBeNull();
  });
});

describe("what an anchor means for each frequency", () => {
  it("is a weekday for weekly and biweekly, 0 = Monday", () => {
    expect(anchorKindFor("weekly")).toBe("weekday");
    expect(anchorKindFor("biweekly")).toBe("weekday");
    expect(anchorRangeFor("weekly")).toEqual({ min: 0, max: 6 });
  });

  it("is a day of the month for monthly and quarterly, and stops at 28", () => {
    expect(anchorKindFor("monthly")).toBe("monthday");
    expect(anchorKindFor("quarterly")).toBe("monthday");
    // 28, not 31: a rule anchored to the 30th has no February, and a date that
    // silently moves twice a year is not a rule anybody agreed to.
    expect(anchorRangeFor("monthly")).toEqual({ min: 1, max: 28 });
  });

  it("is nothing at all for daily, and an anchor on a daily rule is refused", () => {
    expect(anchorKindFor("daily")).toBe("none");
    expect(anchorRangeFor("daily")).toBeNull();
    const refused = validateAnchorDay("daily", 3);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("anchor_not_applicable");
  });

  it("refuses a weekday of 7 and a month day of 29, by name", () => {
    const weekday = validateAnchorDay("weekly", 7);
    expect(weekday.ok).toBe(false);
    if (!weekday.ok) expect(weekday.reason).toBe("anchor_out_of_range");

    const monthday = validateAnchorDay("monthly", 29);
    expect(monthday.ok).toBe(false);
    if (!monthday.ok) expect(monthday.reason).toBe("anchor_out_of_range");
  });

  it("refuses a fractional anchor rather than rounding it", () => {
    const r = validateAnchorDay("weekly", 2.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("anchor_not_whole");
  });

  it("treats an absent anchor as a real answer, not an error", () => {
    expect(validateAnchorDay("weekly", null)).toEqual({ ok: true, value: null });
    expect(validateAnchorDay("daily", undefined)).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe("reading a calendar date", () => {
  it("takes YYYY-MM-DD and nothing else", () => {
    const ok = readCalendarDate("2026-09-05");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toEqual({ y: 2026, m: 9, d: 5 });
  });

  it("refuses a timestamp, a slash date, and an empty string", () => {
    for (const bad of ["2026-09-05T00:00:00Z", "05/09/2026", "", "2026-9-5"]) {
      const r = readCalendarDate(bad);
      expect(r.ok).toBe(false);
    }
  });

  it("refuses 31 February — a date that parses is not a date that exists", () => {
    const r = readCalendarDate("2026-02-31");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("2026-02 has 28");
  });

  it("accepts 29 February in a leap year and refuses it otherwise", () => {
    expect(readCalendarDate("2028-02-29").ok).toBe(true);
    expect(readCalendarDate("2026-02-29").ok).toBe(false);
  });

  it("says what it got when it was not given a string at all", () => {
    const r = readCalendarDate(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("date_not_a_string");
  });
});

describe("the next occurrence", () => {
  const on = (from: string, f: any, a?: number | null) => {
    const r = nextOccurrenceOn(from, f, a);
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    return r.value;
  };

  it("daily is the next day, and crosses a month and a year end", () => {
    expect(on("2026-09-05", "daily")).toBe("2026-09-06");
    expect(on("2026-09-30", "daily")).toBe("2026-10-01");
    expect(on("2026-12-31", "daily")).toBe("2027-01-01");
  });

  it("weekly with no anchor is exactly seven days", () => {
    expect(on("2026-09-05", "weekly")).toBe("2026-09-12");
  });

  it("weekly anchored to Tuesday lands on a Tuesday", () => {
    // 2026-09-08 is a Tuesday. Stepping seven days from it and snapping to
    // Tuesday (anchor 1) must stay on Tuesday, not slide.
    expect(on("2026-09-08", "weekly", 1)).toBe("2026-09-15");
    // From a Saturday, the next weekly-on-Tuesday is the Tuesday after the step.
    expect(on("2026-09-05", "weekly", 1)).toBe("2026-09-15");
  });

  it("anchors Sunday as 6, not as 0 — the 0=Mon convention, written out", () => {
    // 2026-09-06 is a Sunday. Anchor 6 must mean Sunday; if the mapping were
    // JavaScript's own 0=Sun this would land on a Saturday.
    const landed = on("2026-09-06", "weekly", 6);
    expect(landed).toBe("2026-09-13");
    expect(new Date(`${landed}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it("biweekly is fourteen days, then snapped", () => {
    expect(on("2026-09-08", "biweekly")).toBe("2026-09-22");
    expect(on("2026-09-08", "biweekly", 1)).toBe("2026-09-22");
  });

  it("monthly clamps 31 January to the end of February rather than rolling into March", () => {
    // The single most reproduced bug in recurrence arithmetic.
    expect(on("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(on("2028-01-31", "monthly")).toBe("2028-02-29");
  });

  it("monthly anchored to a day of the month goes to that day", () => {
    expect(on("2026-09-05", "monthly", 12)).toBe("2026-10-12");
  });

  it("quarterly is three months, clamped the same way", () => {
    expect(on("2026-09-05", "quarterly")).toBe("2026-12-05");
    expect(on("2026-11-30", "quarterly")).toBe("2027-02-28");
  });

  it("refuses an unknown frequency instead of defaulting to monthly", () => {
    // The `default:` arm this file was written without. A daily rule that
    // quietly runs monthly is a wrong answer nobody can see.
    const r = nextOccurrenceOn("2026-09-05", "fortnightly" as any, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unknown_frequency");
      expect(r.message).toContain("daily, weekly, biweekly, monthly, quarterly");
    }
  });

  it("refuses a malformed start date rather than producing a date from it", () => {
    const r = nextOccurrenceOn("not-a-date", "weekly", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("date_not_calendar");
  });

  it("refuses an out-of-range anchor rather than ignoring it", () => {
    const r = nextOccurrenceOn("2026-09-05", "weekly", 9);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("anchor_out_of_range");
  });
});

describe("the timezone the machine is in", () => {
  /*
   * The whole point. `new Date("2026-09-01")` is UTC midnight; every getter and
   * setter on Date is LOCAL. In UTC-11 that instant reads 2026-08-31, so
   * `setMonth(+1)` asks for 31 September and JavaScript rolls it to 1 October —
   * a monthly rule set for the 1st comes back as the 2nd, in negative-offset
   * timezones only. Railway runs UTC and a developer's laptop usually does not,
   * which makes it correct in production and wrong in every local test, or the
   * reverse the day the region changes.
   *
   * TZ is set for the process, so these run in a child-visible offset; the
   * assertions are the same ones as above and must not move.
   */
  const original = process.env.TZ;
  afterAll(() => {
    process.env.TZ = original;
  });

  for (const tz of ["Pacific/Niue", "Pacific/Kiritimati", "UTC"]) {
    it(`gives the same answers in ${tz}`, () => {
      process.env.TZ = tz;
      const step = (from: string, f: any, a?: number | null) => {
        const r = nextOccurrenceOn(from, f, a);
        if (!r.ok) throw new Error(r.message);
        return r.value;
      };
      expect(step("2026-01-31", "monthly")).toBe("2026-02-28");
      expect(step("2026-09-01", "monthly")).toBe("2026-10-01");
      expect(step("2026-09-05", "daily")).toBe("2026-09-06");
      expect(step("2026-09-08", "weekly", 1)).toBe("2026-09-15");
    });
  }
});

describe("the first occurrence", () => {
  const first = (start: string, f: any, a?: number | null) => {
    const r = firstOccurrenceOn(start, f, a);
    if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
    return r.value;
  };

  it("can be the start date itself when it already satisfies the anchor", () => {
    // 2026-09-08 is a Tuesday. "Weekly on Tuesday, starting this Tuesday" must
    // mean THIS Tuesday. Stepping first would silently lose a week.
    expect(first("2026-09-08", "weekly", 1)).toBe("2026-09-08");
  });

  it("moves forward to the anchor when the start date is not on it", () => {
    expect(first("2026-09-05", "weekly", 1)).toBe("2026-09-08");
  });

  it("never goes backwards for a monthly rule started after its anchor day", () => {
    // Anchored to the 5th, started on the 20th: the first occurrence is NEXT
    // month, never three weeks in the past — which the generator would read as
    // overdue and mint against immediately.
    expect(first("2026-09-20", "monthly", 5)).toBe("2026-10-05");
  });

  it("is the start date when the rule takes no anchor", () => {
    expect(first("2026-09-05", "daily")).toBe("2026-09-05");
    expect(first("2026-09-05", "weekly", null)).toBe("2026-09-05");
  });
});

describe("projecting a series", () => {
  it("returns the occurrences in order, starting with the first", () => {
    const r = occurrencesFrom("2026-09-08", "weekly", 1, 4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([
        "2026-09-08",
        "2026-09-15",
        "2026-09-22",
        "2026-09-29",
      ]);
    }
  });

  it("walks a monthly series across a February without losing its anchor", () => {
    const r = occurrencesFrom("2026-01-28", "monthly", 28, 4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([
        "2026-01-28",
        "2026-02-28",
        "2026-03-28",
        "2026-04-28",
      ]);
    }
  });

  it("refuses rather than returning a short list when the rule breaks", () => {
    // A short list would read as "this rule has 1 occurrence", which is a
    // different and false statement from "this rule cannot be continued".
    const r = occurrencesFrom("2026-09-08", "fortnightly" as any, null, 3);
    expect(r.ok).toBe(false);
  });

  it("returns an empty list for a projection of zero, and refuses a negative one", () => {
    const zero = occurrencesFrom("2026-09-08", "weekly", null, 0);
    expect(zero.ok && zero.value).toEqual([]);
    expect(occurrencesFrom("2026-09-08", "weekly", null, -1).ok).toBe(false);
  });
});

describe("whether a series is due", () => {
  it("is due on its date, and stays due after it", () => {
    // `<=`, not `==`. A cron that did not run leaves a date in the past, and a
    // rule that only fires on exact equality skips that occurrence forever and
    // reports nothing wrong.
    expect(isDueOn("2026-09-05", "2026-09-05")).toBe(true);
    expect(isDueOn("2026-09-01", "2026-09-05")).toBe(true);
  });

  it("is not due before its date", () => {
    expect(isDueOn("2026-09-12", "2026-09-05")).toBe(false);
  });

  it("is not due when either date cannot be read — never true by accident", () => {
    expect(isDueOn("whenever", "2026-09-05")).toBe(false);
    expect(isDueOn("2026-09-05", "whenever")).toBe(false);
  });
});

describe("planning a whole recurrence", () => {
  it("derives the first date rather than taking one", () => {
    const r = planRecurrence({
      frequency: "weekly",
      anchorDay: 1,
      startsOn: "2026-09-05",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        frequency: "weekly",
        anchorDay: 1,
        anchoredOn: "2026-09-05",
        nextDueOn: "2026-09-08",
      });
    }
  });

  it("refuses an unknown frequency, an impossible anchor, and a bad start, by reason", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ frequency: "yearly", startsOn: "2026-09-05" }, "unknown_frequency"],
      [
        { frequency: "monthly", anchorDay: 31, startsOn: "2026-09-05" },
        "anchor_out_of_range",
      ],
      [{ frequency: "daily", anchorDay: 2, startsOn: "2026-09-05" }, "anchor_not_applicable"],
      [{ frequency: "weekly", startsOn: "5 September" }, "date_not_calendar"],
    ];
    for (const [input, reason] of cases) {
      const r = planRecurrence(input as any);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    }
  });

  it("keeps the anchored date and the next date apart", () => {
    // `anchoredOn` is where the series is measured from and never moves;
    // `nextDueOn` is derived and advances. Collapsing them is how a series
    // loses the ability to say what it was set to.
    const r = planRecurrence({
      frequency: "monthly",
      anchorDay: 12,
      startsOn: "2026-09-20",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.anchoredOn).toBe("2026-09-20");
      expect(r.value.nextDueOn).toBe("2026-10-12");
    }
  });
});
