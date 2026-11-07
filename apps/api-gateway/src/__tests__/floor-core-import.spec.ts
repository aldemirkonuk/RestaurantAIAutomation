/**
 * Smoke: the gateway runs @wineops/floor-core's source, not a stub.
 *
 * Jest maps the name to the package source (package.json `moduleNameMapper`)
 * and `tsconfig.spec.json` `paths` lets specs typecheck against it. The
 * running gateway imports the built package (`workspace:*`, built in the
 * Dockerfile and the CI boot job).
 */
import {
  buildMealBrief,
  freshnessOf,
  needsShortVisitConfirm,
  proposeReassignment,
  waiterPerformanceScore,
} from "@wineops/floor-core";

describe("@wineops/floor-core from the gateway", () => {
  it("runs the package source, not a stub", () => {
    expect(waiterPerformanceScore([], 10)).toBeNull();
    expect(waiterPerformanceScore([20], 10)).toBe(50);
    expect(freshnessOf(10, 10, 15)).toBe("fresh");
    expect(
      proposeReassignment({
        tables: [{ tableId: "t1", label: "1", sectionId: "A", seated: true }],
        candidates: [{ waiterId: "w2", sectionIds: ["A"], load: 0 }],
        fromWaiterId: "w1",
      }),
    ).toEqual([{ tableId: "t1", toWaiterId: "w2", reason: "lightest_in_section" }]);
    const now = Date.parse("2026-08-24T20:00:00.000Z");
    expect(
      buildMealBrief({
        tableLabel: "12",
        course: "mains",
        seats: 4,
        partySize: 3,
        seatedAt: new Date(now - 38 * 60_000).toISOString(),
        lastCheckInAt: new Date(now - 4 * 60_000).toISOString(),
        checkInCount: 2,
        warnAfterMin: 10,
        lateAfterMin: 15,
        now,
      }).title,
    ).toBe("Food up · Table 12");
    expect(needsShortVisitConfirm({ seatedAt: new Date(now - 5 * 60_000).toISOString(), lastCheckInAt: null, nowMs: now })).toBe(true);
  });
});
