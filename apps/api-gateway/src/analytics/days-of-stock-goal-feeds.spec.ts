import { RecommendationsService } from "./recommendations.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { GoalsService } from "./goals.service";
import { SALES_GATED_GOAL_METRICS } from "./sales-gated-goals";

/**
 * A days-of-stock goal's score is a sales holder's figure (ADR 0298 decision 9):
 * left out of both feeds for a viewer without sales.
 */
const DAY = 86_400_000;
const behind = (id: string, metric_key: string) => ({
  id,
  name: `goal ${id}`,
  metric_key,
  target_value: 10,
  current_value: 1,
  created_at: new Date(Date.now() - 50 * DAY).toISOString(),
  deadline: new Date(Date.now() + 10 * DAY).toISOString(),
});
const GOALS = [
  behind("dio", "days_of_inventory"),
  behind("sold", "bottles_sold"),
];

function feed(goals: unknown[] = GOALS) {
  const b: any = {};
  for (const m of [
    "select",
    "order",
    "limit",
    "insert",
    "eq",
    "gte",
    "in",
    "is",
    "gt",
    "neq",
  ])
    b[m] = () => b;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (ok: any, no: any) =>
    Promise.resolve({ data: [], error: null }).then(ok, no);
  const client = { from: () => b };
  const listGoals = jest.fn(async () => goals);
  const svc = new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => null,
    } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals } as any,
    {
      readDispositions: async () => ({
        map: new Map(),
        readable: true,
        problem: null,
      }),
    } as any,
    { supabase: client, getClient: () => client } as any,
  );
  return { svc, listGoals };
}

const keys = (out: any) => out.recommendations.map((r: any) => r.ruleKey);

describe("a days-of-stock goal's stored pace stays with a sales holder", () => {
  it("every sales-gated key is a goal metric createGoal accepts and stores", () => {
    // createGoal refuses a key outside SUPPORTED_METRICS and stores the one
    // it accepts as metric_key, so a renamed key fails here, not in silence.
    const supported = Object.keys(GoalsService.SUPPORTED_METRICS);
    expect(SALES_GATED_GOAL_METRICS.size).toBeGreaterThan(0);
    for (const key of SALES_GATED_GOAL_METRICS)
      expect(supported).toContain(key);
  });

  it("recommendations: the next readable goal takes a left-out goal's slot", async () => {
    const goals = [
      behind("dio", "days_of_inventory"),
      behind("a", "bottles_sold"),
      behind("b", "checks"),
      behind("c", "wine_revenue"),
    ];
    const { svc } = feed(goals);
    const k = keys(await svc.getRecommendations("r1", { withSales: false }));
    expect(k).toEqual(
      expect.arrayContaining([
        "goal_behind_a",
        "goal_behind_b",
        "goal_behind_c",
      ]),
    );
    expect(k).not.toContain("goal_behind_dio");
  });

  it("recommendations: left out without sales, and the gate goes to the goal list", async () => {
    for (const opts of [undefined, {}, { withSales: false }]) {
      const { svc, listGoals } = feed();
      const k = keys(await svc.getRecommendations("r1", opts as any));
      expect(k).toContain("goal_behind_sold");
      expect(k).not.toContain("goal_behind_dio");
      expect(listGoals).toHaveBeenCalledWith("r1", "active", {
        withSales: false,
      });
    }
  });

  it("recommendations: kept for a viewer who sees sales", async () => {
    const { svc, listGoals } = feed();
    const k = keys(await svc.getRecommendations("r1", { withSales: true }));
    expect(k).toEqual(
      expect.arrayContaining(["goal_behind_dio", "goal_behind_sold"]),
    );
    expect(listGoals).toHaveBeenCalledWith("r1", "active", { withSales: true });
  });

  it("the stored insight feed writes no pace for it", () => {
    const pushed: any[] = [];
    Object.create(InsightGeneratorService.prototype).computeGoalsFamily(
      { availability: new Set(["goals"]), goals: GOALS },
      (r: any) => pushed.push(r),
    );
    expect(pushed.map((r) => r?.evidence?.goalName)).toEqual(["goal sold"]);
  });
});
