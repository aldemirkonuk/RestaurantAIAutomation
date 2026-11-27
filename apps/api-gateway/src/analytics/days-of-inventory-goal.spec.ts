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

import { GoalsService } from "./goals.service";

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
    });
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
      }, { withSales: true }),
    ).rejects.toThrow(/every wine on hand has a recorded cost/);
  });

  it("names which input is missing when the cost of what sold is withheld (batch review 2026-11-11)", async () => {
    const service = serviceWith(12.5);
    (service as any).analyticsService = {
      getFinancialSummary: async () => ({
        daysInventoryOutstanding: null,
        cogs: null,
        cogsCoverage: { itemsMoved: 12, itemsCosted: 11 },
        inventoryValue: 900,
        cogsWindow: { spanDays: 120 },
      }),
    };
    await expect(
      service.createGoal("r1", { name: "x", metricKey: "days_of_inventory", targetValue: 9 }, { withSales: true }),
    ).rejects.toThrow(/known for 11 of 12 items sold\.$/);
  });

  it("refuses, naming the gate, for a caller who does not see sales (cost-math 3.1)", async () => {
    const service = serviceWith(12.5);
    (service as any).analyticsService = {
      getFinancialSummary: async () => ({ daysInventoryOutstanding: null }),
    };
    await expect(
      service.createGoal("r1", { name: "x", metricKey: "days_of_inventory", targetValue: 9 }),
    ).rejects.toThrow(/owners and managers only/);
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
      });
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
        }, { withSales: true }),
      ).rejects.toThrow(/Days of stock cannot be read/);
    }
  });
});

describe("the goal methods hand their sales gate to the register (ADR 0298 decision 9, cost-math 3.1)", () => {
  it("createGoal passes the gate on, closed when absent, and stores the register's baseline", async () => {
    const calls: unknown[][] = [];
    const baselines: unknown[] = [];
    for (const gate of [{ withSales: true }, { withSales: false }, undefined]) {
      const seen = { patch: {} as Record<string, unknown> };
      const service = serviceWith(12.5, seen);
      (service as any).analyticsService = {
        getFinancialSummary: async (...args: unknown[]) => {
          calls.push(args);
          return { daysInventoryOutstanding: 12.5 };
        },
      };
      await service.createGoal(
        "r1",
        { name: "g", metricKey: "days_of_inventory", targetValue: 9 },
        gate,
      );
      baselines.push(seen.patch.baseline_value);
    }
    // Days of stock now divides by the cost of what the till sold, so the
    // register reads the till only for a caller who sees sales.
    expect(calls).toEqual([
      ["r1", 0, { withSales: true }],
      ["r1", 0, { withSales: false }],
      ["r1", 0, { withSales: false }],
    ]);
    expect(baselines).toEqual([12.5, 12.5, 12.5]);
  });

  it("listGoals withholds a days-of-stock goal's stored scores from a caller without sales (cost-math walk 2026-11-11)", async () => {
    // Measured on the local stack before this: staff read current_value
    // 312.07 on the row whose progress said "cannot be read here".
    const dio = {
      id: "g1",
      metric_key: "days_of_inventory",
      current_value: 12.5,
      baseline_value: 14,
      target_value: 30,
    };
    const revenue = {
      id: "g2",
      metric_key: "wine_revenue",
      current_value: 900,
      baseline_value: 100,
      target_value: 1000,
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      then: (ok: (v: unknown) => unknown) =>
        ok({ data: [dio, revenue], error: null }),
    };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: () => undefined } as any,
      {} as any,
      verdicts,
      {} as any,
    );
    expect(await service.listGoals("r1", "all", { withSales: true })).toEqual([
      dio,
      revenue,
    ]);
    for (const gate of [{ withSales: false }, undefined]) {
      expect(await service.listGoals("r1", "all", gate)).toEqual([
        { ...dio, current_value: null, baseline_value: null },
        revenue,
      ]);
    }
  });

  it("an edit or a status change answers a caller without sales the same withheld row", async () => {
    const dio = {
      id: "g1",
      metric_key: "days_of_inventory",
      current_value: 312.07,
      baseline_value: 290,
      target_value: 30,
      status: "archived",
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      update: () => chain,
      single: async () => ({ data: dio, error: null }),
      maybeSingle: async () => ({ data: dio, error: null }),
    };
    const service = new GoalsService(
      { getClient: () => ({ from: () => chain }) } as any,
      {} as any,
      { get: () => undefined } as any,
      {} as any,
      verdicts,
      {} as any,
    );
    const withheld = { ...dio, current_value: null, baseline_value: null };
    expect(await service.updateGoal("r1", "g1", { name: "Lean cellar" })).toEqual(withheld);
    expect(await service.updateGoalStatus("r1", "g1", "archived")).toEqual(withheld);
    expect(
      await service.updateGoal("r1", "g1", { name: "Lean cellar" }, { withSales: true }),
    ).toEqual(dio);
    expect(
      await service.updateGoalStatus("r1", "g1", "archived", { withSales: true }),
    ).toEqual(dio);
  });
});
