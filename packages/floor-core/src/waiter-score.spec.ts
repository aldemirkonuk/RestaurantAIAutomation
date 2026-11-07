/**
 * The waiter score and its band. Every spec imports the real code; the
 * checker's scripts copied the logic into the test (`scripts/test-attribution.mjs:8`).
 */
import { freshnessOf } from "./freshness";
import { LATE, WARN } from "./test-fixtures";
import {
  latenessLambda,
  latenessSeverity,
  onTimePct,
  overdueGapCount,
  scoreBand,
  scoreBandLabel,
  SEVERITY_CAP,
  sortByScore,
  visitScore,
  waiterPerformanceScore,
} from "./waiter-score";

describe("ADR 0346 D4 (a): no evidence is not a score", () => {
  it("no gaps gives no score, no on-time share and no overdue count", () => {
    expect(waiterPerformanceScore([], WARN)).toBeNull();
    expect(onTimePct([], WARN)).toBeNull();
    expect(overdueGapCount([], LATE)).toBeNull();
  });
});

describe("the curve (ADR 0346 D4, unchanged)", () => {
  it("is full marks to T, then halves every T minutes", () => {
    expect(visitScore(WARN, WARN)).toBe(100);
    expect(visitScore(2 * WARN, WARN)).toBeCloseTo(50);
    expect(visitScore(3 * WARN, WARN)).toBeCloseTo(25);
    expect(latenessLambda(0)).toBeCloseTo(Math.LN2);
    expect(latenessLambda(Infinity)).toBeNaN();
    expect(latenessLambda(-Infinity)).toBeNaN();
    expect(waiterPerformanceScore([WARN, 2 * WARN], WARN)).toBe(75);
  });
});

describe("ADR 0346 D4 (d): one boundary on the board and in the report", () => {
  it("a gap of exactly T is on time in both", () => {
    expect(onTimePct([WARN, WARN], WARN)).toBe(100);
    expect(onTimePct([WARN + 0.01], WARN)).toBe(0);
    expect(freshnessOf(WARN, WARN, LATE)).toBe("fresh");
  });

  it("a gap of exactly the late minute is overdue in both", () => {
    expect(overdueGapCount([LATE], LATE)).toBe(1);
    expect(freshnessOf(LATE, WARN, LATE)).toBe("late");
    expect(overdueGapCount([LATE - 0.01], LATE)).toBe(0);
    expect(freshnessOf(LATE - 0.01, WARN, LATE)).not.toBe("late");
  });
});

describe("founder F2 (2026-10-31): the band describes the visits", () => {
  it("keeps the 90/80 cuts with the new words", () => {
    expect(scoreBandLabel(scoreBand(90))).toBe("Visits on time");
    expect(scoreBandLabel(scoreBand(89))).toBe("Some late");
    expect(scoreBandLabel(scoreBand(80))).toBe("Some late");
    expect(scoreBandLabel(scoreBand(79))).toBe("Many late");
  });

  it("gives no band and prints — for no score", () => {
    expect(scoreBand(null)).toBeNull();
    expect(scoreBand(NaN)).toBeNull();
    expect(scoreBandLabel(null)).toBe("—");
    expect(scoreBandLabel("unknown" as never)).toBe("—");
  });
});

const NON_FINITE: [string, number][] = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
];

describe("OD-256: a gap that is not finite reads late; an unreadable house minute gives no score", () => {
  describe.each(NON_FINITE)("%s", (_label, x) => {
    it("scores the gap 0 and the setting null", () => {
      expect(visitScore(x, WARN)).toBe(0);
      expect(visitScore(5, x)).toBeNull();
      expect(waiterPerformanceScore([5, x], WARN)).toBe(50);
      expect(waiterPerformanceScore([5, 5], x)).toBeNull();
    });

    it("counts the gap overdue and not on time; the setting gives null", () => {
      expect(onTimePct([5, x], WARN)).toBe(50);
      expect(onTimePct([1, 5], x)).toBeNull();
      expect(overdueGapCount([5, x], LATE)).toBe(1);
      expect(overdueGapCount([5, 20], x)).toBeNull();
    });
  });

  it("uses a finite late setting ≤ 0 as set, as OD-256 records", () => {
    expect(overdueGapCount([0, 5], 0)).toBe(2);
    expect(onTimePct([0, 5], WARN)).toBe(100);
    expect(onTimePct([7], 10)).toBe(100);
    expect(overdueGapCount([7], 5)).toBe(1);
    expect(freshnessOf(7, 10, 5)).toBe("late");
  });
});

describe("lateness severity", () => {
  it("is 0 to T, then doubles every T minutes up to the cap", () => {
    expect(latenessSeverity(WARN, WARN)).toBe(0);
    expect(latenessSeverity(2 * WARN, WARN)).toBeCloseTo(1);
    expect(latenessSeverity(3 * WARN, WARN)).toBeCloseTo(3);
    expect(latenessSeverity(100 * WARN, WARN)).toBe(SEVERITY_CAP);
  });

  it("reads an unreadable gap as the cap and an unreadable setting as null (OD-256)", () => {
    expect(latenessSeverity(NaN, WARN)).toBe(SEVERITY_CAP);
    expect(latenessSeverity(NaN, WARN, 7)).toBe(7);
    expect(latenessSeverity(5, NaN)).toBeNull();
  });

  it("falls back to SEVERITY_CAP for a NaN or negative cap; Infinity is uncapped", () => {
    expect(latenessSeverity(NaN, 10, NaN)).toBe(SEVERITY_CAP);
    expect(latenessSeverity(NaN, 10, -1)).toBe(SEVERITY_CAP);
    expect(latenessSeverity(100, 10, -Infinity)).toBe(SEVERITY_CAP);
    expect(latenessSeverity(100, 10, Infinity)).toBeCloseTo(2 ** 9 - 1);
  });
});

describe("founder F3 (2026-10-31): sort only, no rank", () => {
  it("adds no field and does not mutate the input", () => {
    const rows = [
      { id: "ana", score: 60 },
      { id: "cem", score: 100 },
    ];
    const best = sortByScore(rows);
    expect(best.map((r) => r.id)).toEqual(["cem", "ana"]);
    expect(Object.keys(best[0]).sort()).toEqual(["id", "score"]);
    expect(rows.map((r) => r.id)).toEqual(["ana", "cem"]);
  });

  it("OD-258: no score (null, NaN, Infinity) goes last in both orders; ties by id", () => {
    const rows = [
      { id: "f", score: 70 },
      { id: "b", score: NaN },
      { id: "c", score: 70 },
      { id: "a", score: Infinity },
      { id: "d", score: null },
      { id: "e", score: 90 },
    ];
    expect(sortByScore(rows).map((r) => r.id)).toEqual(["e", "c", "f", "a", "b", "d"]);
    expect(sortByScore(rows, "worst_first").map((r) => r.id)).toEqual(["c", "f", "e", "a", "b", "d"]);
  });
});
