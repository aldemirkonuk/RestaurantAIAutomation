import { RecommendationsService } from "./recommendations.service";

/**
 * A goal whose stored value is withheld is not "0% done" (cost-math walk
 * 2026-11-11).
 *
 * `GoalsService.listGoals` blanks a days-of-stock goal's stored
 * `current_value` for a caller without sales. The goal rule read
 * `Number(null) || 0` and so called that goal behind at "0% done" for staff.
 */

const DAY_MS = 86400000;

function makeService(goals: Array<Record<string, unknown>>) {
  const supabase = {
    from: () => {
      const builder: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq"])
        builder[m] = () => builder;
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return builder;
    },
  };
  return new RecommendationsService(
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
    { listGoals: async () => goals } as any,
    {
      readDispositions: async () => ({
        map: new Map(),
        readable: true,
        problem: null,
      }),
    } as any,
    { supabase, getClient: () => supabase } as any,
  );
}

/** A goal half way to its deadline with `current` of 100 done. */
function goal(id: string, current: number | null) {
  return {
    id,
    name: `Goal ${id}`,
    metric_key: current === null ? "days_of_inventory" : "wine_revenue",
    target_value: 100,
    current_value: current,
    created_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    deadline: new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10),
  };
}

async function behindKeys(goals: Array<Record<string, unknown>>) {
  const out = await makeService(goals).getRecommendations("r-1");
  return out.recommendations
    .map((r) => r.ruleKey)
    .filter((k) => k.startsWith("goal_behind_"));
}

describe("a withheld goal is not called behind", () => {
  it("control: a goal 10% done half way to its deadline is behind", async () => {
    expect(await behindKeys([goal("a", 10)])).toEqual(["goal_behind_a"]);
  });

  it("a goal whose stored value is withheld (null) is left out, not '0% done'", async () => {
    expect(await behindKeys([goal("b", null)])).toEqual([]);
  });
});
