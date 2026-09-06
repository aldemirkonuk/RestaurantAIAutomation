import {
  EXPERIMENTS,
  EXPERIMENT_EVENTS,
  EXPERIMENT_QUARTER_DAYS,
  NOTE_CLOSE_CONTROL,
  armForBucket,
  assertRatioIsWhole,
  assignArm,
  experimentBucket,
  experimentByKey,
  experimentEndsAt,
  isDeclaredArm,
} from "./experiments";

/**
 * The ratio is a constant that decides what a real operator sees, so it is
 * pinned here in the founder's own numbers. A pass on this file is not a claim
 * that the split is right — only that the code implements the split that was
 * asked for, and that a house cannot slip between arms.
 */
describe("note_close_control — the ratio the founder set", () => {
  it("is 80 plain / 20 die, and carries the words that set it", () => {
    expect(NOTE_CLOSE_CONTROL.ratio).toEqual({ plain: 80, die: 20 });
    expect(NOTE_CLOSE_CONTROL.arms).toEqual(["plain", "die"]);
    expect(NOTE_CLOSE_CONTROL.founderWords).toBe(
      "lets try both, 80 percent simple 20 percent signature",
    );
    expect(NOTE_CLOSE_CONTROL.decidedOn).toBe("2026-09-05");
  });

  it("puts the product-as-built first, because the first arm is the fallback", () => {
    // A failed read renders arms[0]. If the die were first, an unreadable
    // experiment would put wax on a record — the exact thing commit be80f8b5
    // removed — and it would look like an assignment.
    expect(NOTE_CLOSE_CONTROL.arms[0]).toBe("plain");
  });

  it("records the same three events in both arms", () => {
    expect(EXPERIMENT_EVENTS).toEqual(["exposed", "completed", "abandoned"]);
  });
});

describe("armForBucket — where the boundary falls", () => {
  it("gives 0..79 to plain and 80..99 to die, with no gap at the seam", () => {
    expect(armForBucket(NOTE_CLOSE_CONTROL, 0)).toBe("plain");
    expect(armForBucket(NOTE_CLOSE_CONTROL, 79)).toBe("plain");
    expect(armForBucket(NOTE_CLOSE_CONTROL, 80)).toBe("die");
    expect(armForBucket(NOTE_CLOSE_CONTROL, 99)).toBe("die");
  });

  it("assigns exactly 80 of the 100 buckets to plain", () => {
    const counts: Record<string, number> = { plain: 0, die: 0 };
    for (let b = 0; b < 100; b++) counts[armForBucket(NOTE_CLOSE_CONTROL, b)!]++;
    expect(counts).toEqual({ plain: 80, die: 20 });
  });

  it("returns null outside 0..99 rather than rounding into an arm", () => {
    // -1 is what an unidentifiable caller gets. It must fall in NO arm: landing
    // in the biggest one would silently count a caller with no house as plain.
    expect(armForBucket(NOTE_CLOSE_CONTROL, -1)).toBeNull();
    expect(armForBucket(NOTE_CLOSE_CONTROL, 100)).toBeNull();
    expect(armForBucket(NOTE_CLOSE_CONTROL, 3.5)).toBeNull();
  });

  it("leaves a short ratio unassigned instead of giving the remainder away", () => {
    const short = {
      ...NOTE_CLOSE_CONTROL,
      ratio: { plain: 50, die: 20 },
    };
    expect(armForBucket(short, 10)).toBe("plain");
    expect(armForBucket(short, 65)).toBe("die");
    expect(armForBucket(short, 90)).toBeNull();
  });
});

describe("experimentBucket — deterministic, per house", () => {
  const HOUSE = "550e8400-e29b-41d4-a716-446655440000";

  it("gives the same house the same bucket every time", () => {
    const first = experimentBucket(NOTE_CLOSE_CONTROL.key, HOUSE);
    for (let i = 0; i < 50; i++)
      expect(experimentBucket(NOTE_CLOSE_CONTROL.key, HOUSE)).toBe(first);
  });

  it("is the arm the live tenant actually lands on", () => {
    // Measured against the house the local gateway reaches (owner@meyhouse-pa.com,
    // GET /auth/me, 2026-09-05): bucket 99, so this tenant is on the die. Pinned
    // so a change to the hash or the key is visible as a moved house rather than
    // as a quietly different screen.
    expect(experimentBucket(NOTE_CLOSE_CONTROL.key, HOUSE)).toBe(99);
    expect(assignArm(NOTE_CLOSE_CONTROL, HOUSE).arm).toBe("die");
  });

  it("separates experiments, so one key's split does not decide another's", () => {
    const a = experimentBucket("note_close_control", HOUSE);
    const b = experimentBucket("some_other_experiment", HOUSE);
    expect(a).not.toBe(b);
  });

  it("returns -1 for a caller with no house", () => {
    expect(experimentBucket(NOTE_CLOSE_CONTROL.key, null)).toBe(-1);
    expect(experimentBucket(NOTE_CLOSE_CONTROL.key, "")).toBe(-1);
    expect(assignArm(NOTE_CLOSE_CONTROL, null).arm).toBeNull();
  });

  it("splits a large sample close to the stated ratio", () => {
    // The point of a cryptographic digest over a homebrew polynomial hash: the
    // uniformity does not have to be argued. 10,000 v4-shaped ids, ±2 points.
    let die = 0;
    for (let i = 0; i < 10_000; i++) {
      const id = `550e8400-e29b-41d4-a716-${String(i).padStart(12, "0")}`;
      if (assignArm(NOTE_CLOSE_CONTROL, id).arm === "die") die++;
    }
    expect(die / 10_000).toBeGreaterThan(0.18);
    expect(die / 10_000).toBeLessThan(0.22);
  });
});

describe("assertRatioIsWhole — a mis-split fails the process, not the experiment", () => {
  it("accepts every registered experiment", () => {
    for (const spec of Object.values(EXPERIMENTS))
      expect(() => assertRatioIsWhole(spec)).not.toThrow();
  });

  it("refuses a ratio that does not sum to 100", () => {
    expect(() =>
      assertRatioIsWhole({ ...NOTE_CLOSE_CONTROL, ratio: { plain: 70, die: 20 } }),
    ).toThrow(/sum to 90/);
  });

  it("refuses a ratio naming an arm that is not declared", () => {
    expect(() =>
      assertRatioIsWhole({
        ...NOTE_CLOSE_CONTROL,
        ratio: { plain: 80, die: 10, wax: 10 },
      }),
    ).toThrow(/not declared/);
  });

  it("refuses a declared arm with no percentage", () => {
    expect(() =>
      assertRatioIsWhole({
        ...NOTE_CLOSE_CONTROL,
        arms: ["plain", "die", "third"],
        ratio: { plain: 80, die: 20 },
      }),
    ).toThrow(/no percentage/);
  });
});

describe("experimentByKey", () => {
  it("finds the registered experiment", () => {
    expect(experimentByKey("note_close_control")).toBe(NOTE_CLOSE_CONTROL);
  });

  it("returns null for an unknown key and for a prototype property", () => {
    expect(experimentByKey("nope")).toBeNull();
    // A bare `EXPERIMENTS[key]` would answer with Object.prototype.constructor
    // here, and the caller would then read `.arms` off a function.
    expect(experimentByKey("constructor")).toBeNull();
    expect(experimentByKey("__proto__")).toBeNull();
  });
});

/**
 * The end the founder set on 2026-09-05: one quarter after the FIRST exposure.
 *
 * The arithmetic is pinned here rather than described, because "a quarter" has
 * three defensible readings (90, 91 and 92 days) and the one this repository
 * chose is load-bearing: 91 is 13 WHOLE WEEKS, so the window covers each
 * weekday the same number of times. Restaurant covers are strongly
 * weekly-periodic; a part-week window would put whichever weekday got the extra
 * turn into the answer.
 */
describe("the quarter", () => {
  it("is 91 days — 13 whole weeks", () => {
    expect(EXPERIMENT_QUARTER_DAYS).toBe(91);
    expect(EXPERIMENT_QUARTER_DAYS % 7).toBe(0);
    expect(EXPERIMENT_QUARTER_DAYS / 7).toBe(13);
  });

  it("lands on the same weekday it started, which is the reason for 13 weeks", () => {
    const start = "2026-09-05T12:00:00.000Z";
    const end = experimentEndsAt(start);
    expect(new Date(end).getUTCDay()).toBe(new Date(start).getUTCDay());
    expect(end).toBe("2026-12-05T12:00:00.000Z");
  });

  it("adds exactly 91 days, to the millisecond", () => {
    const start = "2026-01-01T00:00:00.000Z";
    const ms = new Date(experimentEndsAt(start)).getTime() - new Date(start).getTime();
    expect(ms).toBe(91 * 24 * 60 * 60 * 1000);
  });

  it("crosses a leap day without drifting", () => {
    // 2028 is a leap year. Days are days: the window is a fixed number of them,
    // not three calendar months, which would be 89 to 92 depending on the start.
    const start = "2027-12-31T00:00:00.000Z";
    const ms = new Date(experimentEndsAt(start)).getTime() - new Date(start).getTime();
    expect(ms).toBe(91 * 24 * 60 * 60 * 1000);
  });

  it("THROWS on an unreadable start rather than returning Invalid Date", () => {
    // `new Date("nonsense")` is NaN, and a NaN end date compares false against
    // every `now` — an experiment that never ends, reported as one still running.
    expect(() => experimentEndsAt("nonsense")).toThrow(/not a readable first-exposure time/);
    expect(() => experimentEndsAt("")).toThrow(/not a readable first-exposure time/);
  });

  it("refuses an interval that is not a whole number of days", () => {
    expect(() => experimentEndsAt("2026-09-05T12:00:00.000Z", 0)).toThrow(/whole number of days/);
    expect(() => experimentEndsAt("2026-09-05T12:00:00.000Z", 91.5)).toThrow(/whole number of days/);
  });
});

describe("isDeclaredArm", () => {
  it("accepts the arms the spec declares and nothing else", () => {
    expect(isDeclaredArm(NOTE_CLOSE_CONTROL, "plain")).toBe(true);
    expect(isDeclaredArm(NOTE_CLOSE_CONTROL, "die")).toBe(true);
    // A winner is stored in a column that only bounds the length, so a typo
    // that got past this would be frozen and then served as the product.
    expect(isDeclaredArm(NOTE_CLOSE_CONTROL, "plane")).toBe(false);
    expect(isDeclaredArm(NOTE_CLOSE_CONTROL, "Plain")).toBe(false);
    expect(isDeclaredArm(NOTE_CLOSE_CONTROL, "")).toBe(false);
  });
});
