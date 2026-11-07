/**
 * @wineops/floor-core — coverage attribution (who covered a seating).
 *
 * Every spec here imports the real code. The checker's own scripts copied the
 * logic into the test file (`scripts/test-attribution.mjs:8`), so they could
 * pass while the app drifted; that is not repeated.
 */
import {
  assignmentOverlapMs,
  seatingCoveredByWaiter,
  type AssignmentInterval,
} from "./index";
import { MIN, T0, at } from "./test-fixtures";

// ---------------------------------------------------------------------------
// 1. Parity with the checker's scripts
// ---------------------------------------------------------------------------

describe("parity: coverage overlap ≥50% (test-attribution.mjs)", () => {
  const seated = "2026-07-22T12:00:00Z";
  const left = "2026-07-22T13:00:00Z";
  const duration = Date.parse(left) - Date.parse(seated);

  it("counts covered when waiter owned most of the party", () => {
    const intervals: AssignmentInterval[] = [
      { tableId: "t1", startAt: "2026-07-22T12:00:00Z", endAt: "2026-07-22T12:40:00Z" },
    ];
    const o = assignmentOverlapMs(seated, left, intervals, "t1", Date.parse(left));
    expect(o / duration).toBeGreaterThanOrEqual(0.5);
    expect(seatingCoveredByWaiter(seated, left, "t1", intervals, Date.parse(left))).toBe(true);
  });

  it("does not count covered for a brief claim at the end", () => {
    const intervals: AssignmentInterval[] = [
      { tableId: "t1", startAt: "2026-07-22T12:55:00Z", endAt: "2026-07-22T13:00:00Z" },
    ];
    const o = assignmentOverlapMs(seated, left, intervals, "t1", Date.parse(left));
    expect(o / duration).toBeLessThan(0.5);
    expect(seatingCoveredByWaiter(seated, left, "t1", intervals, Date.parse(left))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Review fixes (PR2a review, 2026-10-31)
// ---------------------------------------------------------------------------

describe("coverage counts time covered twice once", () => {
  it("two identical 40-of-100-minute intervals are 40 minutes, not covered", () => {
    const seated = at(0);
    const left = at(100);
    const iv: AssignmentInterval = { tableId: "t1", startAt: at(0), endAt: at(40) };
    expect(assignmentOverlapMs(seated, left, [iv, { ...iv }], "t1", T0 + 100 * MIN)).toBe(40 * MIN);
    expect(seatingCoveredByWaiter(seated, left, "t1", [iv, { ...iv }], T0 + 100 * MIN)).toBe(false);
  });

  it("an interval reaching past both ends of the window counts only the window", () => {
    const intervals: AssignmentInterval[] = [
      { tableId: "t1", startAt: at(-50), endAt: at(150) },
      { tableId: "t1", startAt: at(20), endAt: at(200) },
    ];
    expect(assignmentOverlapMs(at(0), at(100), intervals, "t1", T0 + 300 * MIN)).toBe(100 * MIN);
  });

  it("overlapping intervals merge and disjoint ones add", () => {
    const intervals: AssignmentInterval[] = [
      { tableId: "t1", startAt: at(0), endAt: at(30) },
      { tableId: "t1", startAt: at(20), endAt: at(50) },
      { tableId: "t1", startAt: at(70), endAt: null },
    ];
    expect(assignmentOverlapMs(at(0), at(100), intervals, "t1", T0 + 100 * MIN)).toBe(80 * MIN);
  });
});

describe("the 50% line and unreadable times", () => {
  const iv = (startAt: string, endAt: string | null) => ({ tableId: "t1", startAt, endAt });

  it("exactly half the window counts as covered, for both waiters", () => {
    expect(seatingCoveredByWaiter(at(0), at(100), "t1", [iv(at(0), at(50))], T0 + 200 * MIN)).toBe(true);
    expect(seatingCoveredByWaiter(at(0), at(100), "t1", [iv(at(50), at(100))], T0 + 200 * MIN)).toBe(true);
    expect(seatingCoveredByWaiter(at(0), at(100), "t1", [iv(at(0), at(49))], T0 + 200 * MIN)).toBe(false);
  });

  it("an open interval and an open seating run to nowMs", () => {
    expect(assignmentOverlapMs(at(0), null, [iv(at(0), null)], "t1", T0 + 30 * MIN)).toBe(30 * MIN);
  });

  it("an unreadable seat time, leave time or nowMs gives 0 and not covered", () => {
    expect(assignmentOverlapMs("not a date", at(100), [iv(at(0), at(100))], "t1", T0)).toBe(0);
    expect(assignmentOverlapMs(at(0), null, [iv(at(0), at(100))], "t1", NaN)).toBe(0);
    expect(seatingCoveredByWaiter(at(0), "not a date", "t1", [iv(at(0), at(100))], T0)).toBe(false);
  });

  it("an unreadable interval is skipped, not counted", () => {
    expect(assignmentOverlapMs(at(0), at(100), [iv("bad", at(100)), iv(at(0), at(30))], "t1", T0)).toBe(30 * MIN);
  });

  it("another table's interval does not count", () => {
    expect(assignmentOverlapMs(at(0), at(100), [{ tableId: "t2", startAt: at(0), endAt: at(100) }], "t1", T0)).toBe(0);
  });
});
