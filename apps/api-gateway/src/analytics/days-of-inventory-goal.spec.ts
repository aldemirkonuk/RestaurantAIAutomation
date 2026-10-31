/**
 * A days-of-stock goal reads the figure `/reports` already draws, and refuses
 * to invent one (ADR 0120, founder decision 2026-09-04).
 *
 * WHY THIS METRIC NEEDED ITS OWN SPEC
 * -----------------------------------
 * The other six metrics are cumulative sums over a window, computed inside a
 * try/catch that logs a failure and falls through to a sum of nothing — so a
 * broken query returns `0`. For a revenue total that is a known, old defect.
 * For days of stock it would be a NEW one and a worse one: "0 days" reads as a
 * cellar running perfectly lean, which is the opposite of what an unreadable
 * inventory means. So this metric is computed ahead of that catch and throws
 * instead, and these cases pin that.
 *
 * `daysInventoryOutstanding` is `null` unless every on-hand row carries a
 * recorded cost (ADR 0051, `analytics.service.ts:444-451`), so the null path is
 * the common one on a house that has not costed its cellar — not an edge case.
 */

import { DAYS_OF_STOCK_WITHHELD, GoalsService } from "./goals.service";

/** Days of stock reads the till, so only an owner or a manager scores it (ADR 0298, decision 9). */
const HOLDER = { withSales: true };

const verdicts = { record: () => {}, recordForEvent: () => {} } as any;

/** A goals service whose financial register answers with `dio`. */
function serviceWith(dio: unknown, seen?: { patch: Record<string, unknown> }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    gte: () => chain,
    lte: () => chain,
    limit: async () => ({ data: [], error: null }),
    insert: (patch: Record<string, unknown>) => {
      if (seen) seen.patch = patch;
      return chain;
    },
    update: () => chain,
    single: async () => ({ data: { id: "g1" }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: undefined,
  };
  return new GoalsService(
    { getClient: () => ({ from: () => chain }) } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    verdicts,
    { getFinancialSummary: async () => ({ daysInventoryOutstanding: dio }) } as any,
  );
}

describe("days_of_inventory is a supported metric", () => {
  it("is declared, in days, with the cellar's own insight categories", () => {
    const spec = GoalsService.SUPPORTED_METRICS.days_of_inventory;
    expect(spec).toBeDefined();
    expect(spec.label).toBe("Days of stock");
    expect(spec.unit).toBe("days");
    expect(spec.insightCategories).toEqual(["purchasing", "risk"]);
  });

  it("is offered to the desk alongside the original six", () => {
    expect(Object.keys(GoalsService.SUPPORTED_METRICS)).toHaveLength(7);
  });
});

describe("days_of_inventory refuses rather than reporting zero", () => {
  it("creates a goal against the figure the financial register published", async () => {
    const seen = { patch: {} as Record<string, unknown> };
    const service = serviceWith(12.5, seen);
    await service.createGoal("r1", {
      name: "Hold fewer days of stock",
      metricKey: "days_of_inventory",
      targetValue: 9,
      direction: "at_most",
      period: "month",
    }, HOLDER);
    // The baseline is the register's own number, not a re-derivation.
    expect(seen.patch.baseline_value).toBe(12.5);
    expect(seen.patch.metric_key).toBe("days_of_inventory");
  });

  it("refuses to create the goal when the cellar's value is unknown", async () => {
    const service = serviceWith(null);
    await expect(
      service.createGoal("r1", {
        name: "Hold fewer days of stock",
        metricKey: "days_of_inventory",
        targetValue: 9,
        direction: "at_most",
      }, HOLDER),
    ).rejects.toThrow(/every bottle on hand carries a recorded cost/);
  });

  it("does NOT fall through to zero — the shape the other six still have", async () => {
    // The whole point. A goal written against a silent 0 would report a house
    // with an unreadable cellar as holding no stock at all.
    const service = serviceWith(null);
    let threw = false;
    try {
      await service.createGoal("r1", {
        name: "x",
        metricKey: "days_of_inventory",
        targetValue: 9,
      }, HOLDER);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("refuses a non-finite figure the same way as a null", async () => {
    for (const bad of [Number.NaN, Infinity, "12", undefined]) {
      const service = serviceWith(bad);
      await expect(
        service.createGoal("r1", {
          name: "x",
          metricKey: "days_of_inventory",
          targetValue: 9,
        }, HOLDER),
      ).rejects.toThrow(/Days of stock cannot be read/);
    }
  });

  it("is not scored for a caller who does not see sales, and the register is not read", async () => {
    for (const gate of [undefined, {}, { withSales: false }]) {
      const service = serviceWith(12.5);
      const read = jest.spyOn((service as any).analyticsService, "getFinancialSummary");
      await expect(
        service.createGoal(
          "r1",
          { name: "x", metricKey: "days_of_inventory", targetValue: 9 },
          gate,
        ),
      ).rejects.toThrow(DAYS_OF_STOCK_WITHHELD);
      expect(read).not.toHaveBeenCalled();
    }
  });
});
