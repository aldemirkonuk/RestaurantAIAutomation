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

/** Days of stock is behind the sales gate, so only an owner or a manager scores it (ADR 0298, decision 9). */
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

/** A reader that hands the row to a caller without sales blanks its scores (ADR 0298 decision 9). */
describe("a days-of-stock goal read without sales", () => {
  const ROW = {
    id: "g1",
    restaurant_id: "r1",
    metric_key: "days_of_inventory",
    target_value: 30,
    baseline_value: 41.2,
    current_value: 37.9,
    status: "active",
    created_at: "2026-10-01T10:00:00Z",
    deadline: null,
  };
  const OTHER = { ...ROW, id: "g2", metric_key: "bottles_sold" };

  /** A goals service over `rows`, counting writes and register reads. */
  function over(rows: Array<Record<string, unknown>>) {
    const seen = { updates: 0 };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: () => {
        seen.updates += 1;
        return chain;
      },
      single: async () => ({ data: rows[0], error: null }),
      maybeSingle: async () => ({ data: { timezone: "Europe/Istanbul" }, error: null }),
      then: (ok: (v: unknown) => unknown) => ok({ data: rows, error: null }),
    };
    const financial = jest.fn(async () => ({ daysInventoryOutstanding: 37.9 }));
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      { getStored: async () => [] } as any,
      { get: () => undefined } as any,
      {} as any,
      verdicts,
      { getFinancialSummary: financial } as any,
    );
    return { service, seen, financial };
  }

  it("answers the one-goal read with the reason, computes nothing and writes nothing", async () => {
    for (const gate of [undefined, {}, { withSales: false }]) {
      const { service, seen, financial } = over([ROW]);
      const out: any = await service.getGoalProgress("r1", "g1", undefined, gate);
      expect(out.unreadable).toBe(true);
      expect(out.withheld).toBe(true);
      expect(out.reason).toBe(DAYS_OF_STOCK_WITHHELD);
      expect(out.goal.current_value).toBeNull();
      expect(out.goal.baseline_value).toBeNull();
      expect(out.goal.target_value).toBe(30);
      expect(financial).not.toHaveBeenCalled();
      expect(seen.updates).toBe(0);
    }
  });

  it("blanks the stored scores on the goal list, and only on a days-of-stock goal", async () => {
    const { service } = over([ROW, OTHER]);
    const rows: any[] = await service.listGoals("r1", "active", {});
    expect(rows[0].current_value).toBeNull();
    expect(rows[0].baseline_value).toBeNull();
    expect(rows[0].withheld).toBe(DAYS_OF_STOCK_WITHHELD);
    expect(rows[1].current_value).toBe(37.9);
    expect(rows[1].withheld).toBeUndefined();
  });

  it("keeps the stored scores for a caller who sees sales", async () => {
    const { service } = over([ROW]);
    const rows: any[] = await service.listGoals("r1", "active", HOLDER);
    expect(rows[0].current_value).toBe(37.9);
    expect(rows[0].baseline_value).toBe(41.2);
    expect(rows[0].withheld).toBeUndefined();
  });
});
