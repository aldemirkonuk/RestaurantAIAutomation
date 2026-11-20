import {
  REVENUE_UNAVAILABLE_MESSAGE,
  drawSalesCard,
  resolvePulseStripView,
  salesWithheld,
} from "@/components/today/pulseStripView";
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

/**
 * Sales withheld for the signed-in role (ADR 0253, answered 2026-10-01 round
 * 2: owners and managers only). The gateway leaves the four sales keys out of
 * `GET /mobile/today-pulse` for anyone else (`mobile.service.ts`
 * `getTodayPulse`), and the phone must render no figure, no zero, and not the
 * "Connect Toast" line — that line would tell a staff member something false
 * about the house.
 */
describe("resolvePulseStripView — sales withheld for this role", () => {
  /** The body the gateway sends a staff member: the sales keys are absent. */
  function staffPulse(pendingDecisions: number): TodayPulse {
    return {
      pendingDecisions,
      criticalCount: 0,
      windowStart: "2026-10-01T00:00:00.000Z",
      windowEnd: "2026-10-01T20:00:00.000Z",
      generatedAt: "2026-10-01T20:00:00.000Z",
    };
  }

  it("reads absent sales keys as withheld, and null ones as unavailable", () => {
    expect(salesWithheld(staffPulse(0))).toBe(true);
    expect(salesWithheld(pulse({ revenueToday: null }))).toBe(false);
    expect(salesWithheld(pulse({ revenueToday: 4210 }))).toBe(false);
  });

  it("shows no revenue and not the Connect Toast line", () => {
    const view = resolvePulseStripView(staffPulse(2));

    expect(view.revenue).toEqual({ status: "withheld" });
    expect(JSON.stringify(view)).not.toContain(REVENUE_UNAVAILABLE_MESSAGE);
    expect(JSON.stringify(view)).not.toContain("$");
    expect(view.decisionsLabel).toBe("2 decisions waiting");
  });

  it("does not claim All clear for a role that cannot see the sales", () => {
    const view = resolvePulseStripView(staffPulse(0));

    expect(view.revenue.status).toBe("withheld");
    expect(view.decisionsLabel).toBeNull();
  });
});

/**
 * The Insights tab's "Sales tonight" card. When the pulse request has failed
 * there is no body to read the withholding from, and the card used to fall
 * through to "Connect Toast on the web dashboard", which is false for a staff
 * member. Without a body, the card is drawn for an owner or a manager only.
 */
describe("drawSalesCard", () => {
  const staffBody: TodayPulse = {
    pendingDecisions: 1,
    criticalCount: 0,
    windowStart: "2026-10-01T00:00:00.000Z",
    windowEnd: "2026-10-01T20:00:00.000Z",
    generatedAt: "2026-10-01T20:00:00.000Z",
  };

  it("draws nothing for a staff member, or an unknown role, with no pulse body", () => {
    expect(drawSalesCard(undefined, "staff")).toBe(false);
    expect(drawSalesCard(undefined, undefined)).toBe(false);
    expect(drawSalesCard(undefined, "OWNER")).toBe(false);
  });

  it("draws the card for an owner or a manager with no pulse body", () => {
    expect(drawSalesCard(undefined, "owner")).toBe(true);
    expect(drawSalesCard(undefined, "manager")).toBe(true);
  });

  it("lets the gateway's body decide once there is one", () => {
    expect(drawSalesCard(staffBody, "owner")).toBe(false);
    expect(drawSalesCard(pulse({ revenueToday: 4210 }), "staff")).toBe(true);
    expect(drawSalesCard(pulse({ revenueToday: null }), "manager")).toBe(true);
  });
});
