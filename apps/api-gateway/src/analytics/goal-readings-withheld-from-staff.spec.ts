import { GoalsService } from "./goals.service";
import {
  GOAL_READING_CLASSES,
  goalReadingWithheldFor,
} from "./sales-gated-goals";

/**
 * A goal's reading is money or the till for every metric but bottles sold,
 * and staff are not sent it (ADR 0348 item 3; walk r31 F7 and r33 R-F4: a
 * staff login read "Wine revenue to 60k $50.1K of $60K"). The route stays,
 * the goal's own setting stays, the reading does not.
 */

const verdicts = { record: () => {}, recordForEvent: () => {} } as any;

const REVENUE = {
  id: "g1",
  restaurant_id: "r1",
  name: "Wine revenue to 60k",
  metric_key: "wine_revenue",
  direction: "at_least",
  target_value: 60000,
  baseline_value: 41000,
  current_value: 50100,
  current_read_at: "2026-11-12T10:00:00Z",
  current_unread: null,
  deadline: "2026-12-31",
  period: "custom",
  created_at: "2026-10-01T10:00:00Z",
};

const BOTTLES = {
  ...REVENUE,
  id: "g2",
  name: "Sell 400 bottles",
  metric_key: "bottles_sold",
  target_value: 400,
  baseline_value: 120,
  current_value: 210,
};

const ZONE = { zone: "Europe/Istanbul", source: "restaurant" } as any;

function harness(goal: Record<string, unknown>, listed: Record<string, unknown>[] = [goal]) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const stored: unknown[] = [];
  const from = () => {
    let written: "update" | "insert" | null = null;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: (p: Record<string, unknown>) => {
        written = "update";
        updates.push(p);
        return chain;
      },
      insert: (p: Record<string, unknown>) => {
        written = "insert";
        inserts.push(p);
        return chain;
      },
      single: async () => ({
        data: written === "insert" ? { ...goal, ...inserts[inserts.length - 1] } : goal,
        error: null,
      }),
      maybeSingle: async () => ({ data: { timezone: "Europe/Istanbul", country: "TR" }, error: null }),
      then: (resolve: any, reject: any) =>
        Promise.resolve(written ? { error: null } : { data: listed, error: null }).then(resolve, reject),
    };
    return chain;
  };
  const service = new GoalsService(
    { getClient: () => ({ from }) } as any,
    {
      getStored: async (...args: unknown[]) => {
        stored.push(args);
        return [{ sentence: "Revenue is up 12% on last month", category: "sales", score: 1 }];
      },
    } as any,
    { get: () => undefined } as any,
    {} as any,
    verdicts,
    { getFinancialSummary: async () => ({ daysInventoryOutstanding: 12 }) } as any,
  );
  const computed: unknown[][] = [];
  (service as any).computeMetricWithSeries = async (...args: unknown[]) => {
    computed.push(args);
    return { current: 50100, dailySeries: [], dailyDates: [], units: null, rowCount: 1 };
  };
  return { service, updates, inserts, computed, stored };
}

describe("which goal readings are withheld (ADR 0348 item 3)", () => {
  it("classifies every metric the desk offers, and only those", () => {
    expect(Object.keys(GOAL_READING_CLASSES).sort()).toEqual(
      Object.keys(GoalsService.SUPPORTED_METRICS).sort(),
    );
  });

  it("withholds money and till readings from a caller without sales, and keeps bottles open", () => {
    for (const gate of [{ withSales: false }, {}, undefined]) {
      expect(goalReadingWithheldFor("wine_revenue", gate)).toEqual(["money", "sales"]);
      expect(goalReadingWithheldFor("purchase_spend", gate)).toEqual(["money", "suppliers"]);
      expect(goalReadingWithheldFor("checks", gate)).toEqual(["sales"]);
      expect(goalReadingWithheldFor("avg_check", gate)).toEqual(["money", "sales"]);
      expect(goalReadingWithheldFor("wine_attach_rate", gate)).toEqual(["sales"]);
      expect(goalReadingWithheldFor("days_of_inventory", gate)).toEqual(["money", "sales"]);
      expect(goalReadingWithheldFor("bottles_sold", gate)).toEqual([]);
    }
    for (const key of Object.keys(GOAL_READING_CLASSES))
      expect(goalReadingWithheldFor(key, { withSales: true })).toEqual([]);
  });

  it("withholds a goal read without its key, or with a key it does not know", () => {
    for (const key of [undefined, null, "", "toString", "gross_margin"])
      expect(goalReadingWithheldFor(key, { withSales: false })).toEqual(["money", "sales"]);
  });
});

describe("a staff caller is sent the goal, not its reading", () => {
  it("progress: nothing is computed, recorded or sent but the house's own setting", async () => {
    const { service, updates, computed, stored } = harness(REVENUE);
    const out: any = await service.getGoalProgress("r1", "g1", ZONE, { withSales: false });
    expect(computed).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(stored).toHaveLength(0);
    expect(out.withheldForRole).toEqual(["money", "sales"]);
    expect(out).toMatchObject({
      metricLabel: "Wine revenue",
      unit: "currency",
      current: null,
      target: 60000,
      progressPct: null,
      expectedByNow: null,
      onTrack: null,
      projectedAtDeadline: null,
      projectionHitsTarget: null,
      suggestedActions: [],
    });
    expect(out.goal).toMatchObject({
      id: "g1",
      name: "Wine revenue to 60k",
      deadline: "2026-12-31",
      target_value: 60000,
      current_value: null,
      baseline_value: null,
    });
  });

  it("progress: an absent gate is closed", async () => {
    const { service, computed } = harness(REVENUE);
    const out: any = await service.getGoalProgress("r1", "g1", ZONE);
    expect(computed).toHaveLength(0);
    expect(out.current).toBeNull();
    expect(out.withheldForRole).toEqual(["money", "sales"]);
  });

  it("progress: an owner or manager is read the goal as before", async () => {
    const { service, updates, computed } = harness(REVENUE);
    const out: any = await service.getGoalProgress("r1", "g1", ZONE, { withSales: true });
    expect(computed).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(out.current).toBe(50100);
    expect(out.progressPct).not.toBeNull();
    expect(out.suggestedActions).toHaveLength(1);
    expect(out).not.toHaveProperty("withheldForRole");
  });

  it("progress: a bottles goal is read for staff, as a volume", async () => {
    const { service, computed } = harness(BOTTLES);
    const out: any = await service.getGoalProgress("r1", "g2", ZONE, { withSales: false });
    expect(computed).toHaveLength(1);
    expect(out.current).toBe(50100);
    expect(out).not.toHaveProperty("withheldForRole");
  });

  it("the list: a days-of-stock goal is withheld, not 'could not be scored'", async () => {
    const dio = { ...REVENUE, id: "g3", metric_key: "days_of_inventory" };
    const { service } = harness(dio, [dio]);
    const out: any = await service.listGoalsWithProgress("r1", "active", { withSales: false });
    expect(out.goals).toHaveLength(1);
    expect(out.goals[0].unreadable).toBeUndefined();
    expect(out.goals[0].withheldForRole).toEqual(["money", "sales"]);
  });

  it("the stored rows: a revenue goal's reading is null for staff, a bottles goal's is kept", async () => {
    const { service } = harness(REVENUE, [REVENUE, BOTTLES]);
    const rows = await service.listGoals("r1", "all", { withSales: false });
    expect(rows[0]).toMatchObject({ id: "g1", current_value: null, baseline_value: null, target_value: 60000 });
    expect(rows[1]).toMatchObject({ id: "g2", current_value: 210, baseline_value: 120 });
    const owner = await service.listGoals("r1", "all", { withSales: true });
    expect(owner[0]).toMatchObject({ current_value: 50100, baseline_value: 41000 });
  });

  it("a goal staff create keeps its baseline for the house and answers them without it", async () => {
    const { service, inserts } = harness(REVENUE);
    const out: any = await service.createGoal(
      "r1",
      { name: "Wine revenue to 60k", metricKey: "wine_revenue", targetValue: 60000 },
      { withSales: false },
    );
    expect(inserts[0]).toMatchObject({ baseline_value: 50100, current_value: 50100 });
    expect(out).toMatchObject({ baseline_value: null, current_value: null, target_value: 60000 });
  });
});
