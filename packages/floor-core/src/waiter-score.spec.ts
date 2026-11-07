/**
 * The waiter score and its band. Every spec imports the real code; the
 * checker's scripts copied the logic into the test (`scripts/test-attribution.mjs:8`).
 */
import { freshnessOf } from "./freshness";
import { LATE, WARN } from "./test-fixtures";
import {
  latenessLambda,
  onTimePct,
  overdueGapCount,
  scoreBand,
  scoreBandLabel,
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
  });
});
