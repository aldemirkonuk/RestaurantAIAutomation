/**
 * @wineops/floor-core — the waiter score, its band and sort, and live on-time.
 *
 * Every spec here imports the real code. The checker's own scripts copied the
 * logic into the test file (`scripts/test-attribution.mjs:8`), so they could
 * pass while the app drifted; that is not repeated.
 *
 * One spec per module, so each part stays under the CI audit gate's diff
 * limit; shared fixtures live in `test-fixtures.ts`.
 */
import {
  freshnessOf,
  latenessSeverity,
  liveOnTimePct,
  onTimePct,
  overdueGapCount,
  scoreBand,
  scoreBandLabel,
  SEVERITY_CAP,
  seatingFreshness,
  sortByScore,
  visitScore,
  waiterPerformanceScore,
} from "./index";
import { MIN, T0, at, WARN, LATE } from "./test-fixtures";

// ---------------------------------------------------------------------------
// 3. Corrections — each fails against the checker's original formula
// ---------------------------------------------------------------------------

describe("ADR 0346 D4 (a): no evidence is not a score", () => {
  it("a waiter with no gaps has no score, not 100", () => {
    expect(waiterPerformanceScore([], WARN)).toBeNull();
  });

  it("the live board's on-time is empty for a waiter with no seated table, not 100%", () => {
    expect(liveOnTimePct([])).toBeNull();
  });

  it("the report's on-time share is empty with no gaps, not 100%", () => {
    expect(onTimePct([], WARN)).toBeNull();
  });
});

describe("ADR 0346 D4 (d): one on-time boundary, t ≤ T", () => {
  it("a gap of exactly T is on time in the report", () => {
    expect(onTimePct([WARN, WARN], WARN)).toBe(100);
  });

  it("a table at exactly the warn minute is on time on the board", () => {
    expect(freshnessOf(WARN, WARN, LATE)).toBe("fresh");
    expect(freshnessOf(WARN + 1, WARN, LATE)).toBe("warn");
  });
});

describe("founder F2 (2026-10-31): the band describes the visits", () => {
  it("keeps the 90/80 cuts with the new words", () => {
    expect(scoreBandLabel(scoreBand(90))).toBe("Visits on time");
    expect(scoreBandLabel(scoreBand(89))).toBe("Some late");
    expect(scoreBandLabel(scoreBand(80))).toBe("Some late");
    expect(scoreBandLabel(scoreBand(79))).toBe("Many late");
  });
});

describe("founder F3 (2026-10-31): sort only, no rank", () => {
  it("a waiter with no evidence sorts last in either order, and rows carry no rank", () => {
    const rows = [
      { id: "ana", score: waiterPerformanceScore([12], WARN) },
      { id: "ben", score: waiterPerformanceScore([], WARN) },
      { id: "cem", score: waiterPerformanceScore([5], WARN) },
    ];
    const best = sortByScore(rows, "best_first");
    expect(best.map((r) => r.id)).toEqual(["cem", "ana", "ben"]);
    expect(sortByScore(rows, "worst_first").map((r) => r.id)).toEqual(["ana", "cem", "ben"]);
    expect(Object.keys(best[0]).sort()).toEqual(["id", "score"]);
    expect(rows.map((r) => r.id)).toEqual(["ana", "ben", "cem"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Review fixes (PR2a review, 2026-10-31)
// ---------------------------------------------------------------------------

/**
 * Every gap and house-minute argument of every guarded function gets all
 * three values (the severity cap is not a house minute and is not guarded).
 * For some pairs the unguarded formula already reads late (a +Infinity gap
 * scores 0), so those assertions pin the outcome, not the guard; the rest
 * fail when the guard for that argument is narrowed to skip that value.
 */
const NON_FINITE: ReadonlyArray<readonly [string, number]> = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
];


describe("a gap or house minute that is not a finite number reads late (executor's call)", () => {
  describe.each(NON_FINITE)("%s", (_label, x) => {
    it("visitScore gives 0, not full marks, and the waiter score follows", () => {
      expect(visitScore(x, WARN)).toBe(0);
      expect(visitScore(5, x)).toBe(0);
      expect(waiterPerformanceScore([5, x], WARN)).toBe(50);
      expect(waiterPerformanceScore([5, 5], x)).toBe(0);
    });

    it("latenessSeverity gives the cap, not 0", () => {
      expect(latenessSeverity(x, WARN)).toBe(SEVERITY_CAP);
      expect(latenessSeverity(5, x)).toBe(SEVERITY_CAP);
      expect(latenessSeverity(x, WARN, 7)).toBe(7);
      expect(latenessSeverity(5, x, 7)).toBe(7);
    });

    it("the report's on-time share counts none of them on time", () => {
      expect(onTimePct([5, x], WARN)).toBe(50);
      expect(onTimePct([1, 5], x)).toBe(0);
    });

    it("the overdue count counts every one of them", () => {
      expect(overdueGapCount([5, x], LATE)).toBe(1);
      expect(overdueGapCount([5, 20], x)).toBe(2);
    });

    it("freshnessOf reads late, not fresh; null is still no open seating", () => {
      expect(freshnessOf(x, WARN, LATE)).toBe("late");
      expect(freshnessOf(5, x, LATE)).toBe("late");
      expect(freshnessOf(5, WARN, x)).toBe("late");
      expect(freshnessOf(null, x, x)).toBe("idle");
      expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: null }, x, LATE, T0 + 4 * MIN)).toBe("late");
      expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: null }, WARN, x, T0 + 4 * MIN)).toBe("late");
    });
  });

  it("the guards leave finite values alone", () => {
    expect(visitScore(5, WARN)).toBe(100);
    expect(waiterPerformanceScore([5, 5], WARN)).toBe(100);
    expect(latenessSeverity(5, WARN)).toBe(0);
    expect(onTimePct([5, 5], WARN)).toBe(100);
    expect(overdueGapCount([5, 20], LATE)).toBe(1);
    expect(freshnessOf(5, WARN, LATE)).toBe("fresh");
  });
});

describe("a severity cap that is not finite (OD-256)", () => {
  it("falls back to SEVERITY_CAP, never NaN", () => {
    expect(latenessSeverity(20, 10, NaN)).toBeCloseTo(Math.exp((Math.LN2 / 10) * 10) - 1);
    expect(latenessSeverity(NaN, 10, NaN)).toBe(SEVERITY_CAP);
  });
});
