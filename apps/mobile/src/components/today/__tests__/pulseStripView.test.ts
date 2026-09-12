import { REVENUE_UNAVAILABLE_MESSAGE, resolvePulseStripView } from "@/components/today/pulseStripView";
import type { TodayPulse } from "@/api/types";

function pulse(overrides: Partial<TodayPulse>): TodayPulse {
  return {
    revenueToday: null,
    checksToday: null,
    revenueLastWeek: null,
    deltaPct: null,
    pendingDecisions: 0,
    criticalCount: 0,
    windowStart: "2026-09-01T00:00:00.000Z",
    windowEnd: "2026-09-01T23:59:59.999Z",
    generatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePulseStripView", () => {
  /**
   * The defect this guards: `PulseStrip.tsx` used to fall through to
   * `pendingDecisions === 0 ? "All clear" : ...` whenever `revenueToday`
   * was null — collapsing "we don't have tonight's revenue" into a
   * reassuring "All clear". ADR 0020 names this exact shape ("a green
   * 'All clear' badge over a failed request") as a fabrication. This test
   * fails against the pre-fix branching and passes against the resolver.
   */
  it("does not claim All clear when revenue is unavailable, even with zero pending decisions", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: null, pendingDecisions: 0 }));

    expect(view.decisionsLabel).not.toBe("All clear");
    expect(view.decisionsLabel).toBeNull();
    expect(view.revenue.status).toBe("unavailable");
    expect(view.revenue.status === "unavailable" && view.revenue.message).toBe(
      REVENUE_UNAVAILABLE_MESSAGE,
    );
  });

  it("still reports pending decisions honestly when revenue is unavailable", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: null, pendingDecisions: 3 }));

    expect(view.revenue.status).toBe("unavailable");
    expect(view.decisionsLabel).toBe("3 decisions waiting");
  });

  /**
   * The legitimate case: revenue IS known and pending decisions are
   * genuinely zero. "All clear" is an honest claim here and must keep
   * rendering — this is the regression guard for requirement 3.
   */
  it("renders All clear when revenue is known and pending decisions are genuinely zero", () => {
    const view = resolvePulseStripView(
      pulse({ revenueToday: 4210, checksToday: 62, deltaPct: 8, pendingDecisions: 0 }),
    );

    expect(view.revenue.status).toBe("known");
    expect(view.revenue.status === "known" && view.revenue.amount).toBe(4210);
    expect(view.decisionsLabel).toBe("All clear");
  });

  it("reports singular decision phrasing for exactly one pending decision", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 100, pendingDecisions: 1 }));

    expect(view.decisionsLabel).toBe("1 decision waiting");
  });

  it("reports plural decision phrasing for more than one pending decision", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 100, pendingDecisions: 5 }));

    expect(view.decisionsLabel).toBe("5 decisions waiting");
  });

  it("falls back to a generic checks label when checksToday is unavailable but revenue is known", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 100, checksToday: null }));

    expect(view.revenue.status === "known" && view.revenue.checksLabel).toBe("sales so far");
  });
});
