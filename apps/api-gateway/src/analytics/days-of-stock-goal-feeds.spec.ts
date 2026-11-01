import { RecommendationsService } from "./recommendations.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { stateBookFrom } from "./insights/item-state";
import { GOAL_PACE_INSIGHT, goalPaceForViewer } from "./sales-gated-goals";

/**
 * A days-of-stock goal's score is a sales holder's figure (ADR 0298 decision 9):
 * kept in both feeds for a viewer who sees sales, left out for any other.
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

  it("the stored insight feed holds every goal's pace", () => {
    const pushed: any[] = [];
    Object.create(InsightGeneratorService.prototype).computeGoalsFamily(
      { availability: new Set(["goals"]), goals: GOALS },
      (r: any) => pushed.push(r),
    );
    expect(pushed.map((r) => r?.evidence?.goalName)).toEqual([
      "goal dio",
      "goal sold",
    ]);
  });

  const pace = (measureLabel?: string) => ({
    candidate_key: GOAL_PACE_INSIGHT,
    evidence: { measureLabel },
  });
  const other = {
    candidate_key: "overall.revenue.vs_prev_period_7d",
    evidence: { measureLabel: "days_of_inventory" },
  };

  it("a reading leaves a gated pace out unless the viewer sees sales", () => {
    const rows = [pace("days_of_inventory"), pace("bottles_sold"), other];
    expect(goalPaceForViewer(rows, true)).toEqual({
      kept: rows,
      salesGated: 0,
    });
    expect(goalPaceForViewer(rows, false)).toEqual({
      kept: [rows[1], other],
      salesGated: 1,
    });
    // A live record names its type as candidateKey; a pace without its key
    // counts as gated.
    const live = { candidateKey: GOAL_PACE_INSIGHT, evidence: {} };
    expect(goalPaceForViewer([live], false).salesGated).toBe(1);
  });

  it("readStored applies the gate before the cut, and missing reads as no", async () => {
    const gen = Object.create(InsightGeneratorService.prototype);
    gen.queryStored = async () => [
      pace("days_of_inventory"),
      pace("bottles_sold"),
    ];
    gen.actions = {
      readState: async () => ({ book: stateBookFrom([]), readable: true }),
    };
    const closed = await gen.readStored("r1", { limit: 1 });
    expect(closed.rows.map((r: any) => r.evidence.measureLabel)).toEqual([
      "bottles_sold",
    ]);
    expect(closed.salesGated).toBe(1);
    const open = await gen.readStored("r1", { limit: 2, withSales: true });
    expect(open.rows).toHaveLength(2);
    expect(open.salesGated).toBe(0);
  });
});
