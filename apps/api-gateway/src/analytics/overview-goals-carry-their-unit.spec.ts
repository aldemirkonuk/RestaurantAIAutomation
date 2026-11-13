import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { GoalsService } from "./goals.service";

/**
 * The overview's running goals carry their metric's unit (r28 /reports audit,
 * gap 6). The "Against ourselves" cutting and its export printed a goal's
 * baseline, current and target as bare numbers: a money goal had no currency,
 * a rate no percent sign, a days goal no "days". The unit comes from the one
 * catalogue `createGoal` checks a key against, `GoalsService.SUPPORTED_METRICS`.
 */
const refuse = async () => {
  throw new Error("not read in this spec");
};
const db = {
  getClient: () => {
    throw new Error("not read in this spec");
  },
} as any;

function overviewWith(goals: unknown[]) {
  return new AdvancedAnalyticsService(
    db,
    {
      getFinancialSummary: refuse,
      getRiskProfile: refuse,
      getInventoryScience: refuse,
    } as any,
    { getStored: async () => [] } as any,
    { listGoals: async () => goals } as any,
  ).getOverview("r1", { withSales: true });
}

describe("the overview's goals carry their unit", () => {
  it("[REVERT-FAILS] each goal names its metric's unit from the catalogue", async () => {
    const out: any = await overviewWith([
      { name: "Revenue", metric_key: "wine_revenue", baseline_value: 100 },
      { name: "Attach", metric_key: "wine_attach_rate", baseline_value: 0.2 },
      { name: "Cover", metric_key: "days_of_inventory", baseline_value: 21 },
      { name: "Bottles", metric_key: "bottles_sold", baseline_value: 40 },
    ]);
    expect(out.activeGoals.map((g: any) => [g.metric_key, g.unit])).toEqual([
      ["wine_revenue", GoalsService.SUPPORTED_METRICS.wine_revenue.unit],
      ["wine_attach_rate", "percent"],
      ["days_of_inventory", "days"],
      ["bottles_sold", "units"],
    ]);
    expect(out.activeGoals[0].unit).toBe("currency");
    // The goal row is otherwise as listGoals gave it.
    expect(out.activeGoals[0]).toMatchObject({ name: "Revenue", baseline_value: 100 });
  });

  it("[REVERT-FAILS] a key outside the catalogue says no unit rather than borrowing one", async () => {
    const out: any = await overviewWith([{ name: "Old", metric_key: "retired_metric" }, { name: "None" }]);
    expect(out.activeGoals.map((g: any) => g.unit)).toEqual([null, null]);
  });

  it("a goals read that failed is still an empty list, not an error", async () => {
    const out: any = await new AdvancedAnalyticsService(
      db,
      { getFinancialSummary: refuse, getRiskProfile: refuse, getInventoryScience: refuse } as any,
      { getStored: async () => [] } as any,
      { listGoals: refuse } as any,
    ).getOverview("r1", {});
    expect(out.activeGoals).toEqual([]);
  });
});
