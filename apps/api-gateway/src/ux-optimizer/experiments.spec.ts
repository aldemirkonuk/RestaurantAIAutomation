import {
  EXPERIMENTS,
  EXPERIMENT_EVENTS,
  NOTE_CLOSE_CONTROL,
  armForBucket,
  assertRatioIsWhole,
  assignArm,
  experimentBucket,
  experimentByKey,
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
