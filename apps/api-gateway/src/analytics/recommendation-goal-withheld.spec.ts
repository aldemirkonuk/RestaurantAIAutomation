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

/** A goal half way to its deadline with `current` of 100 done, read just now. */
function goal(
  id: string,
  current: number | null,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    name: `Goal ${id}`,
    metric_key: current === null ? "days_of_inventory" : "wine_revenue",
    target_value: 100,
    current_value: current,
    current_read_at: new Date().toISOString(),
    current_unread: null,
    direction: "at_least",
    created_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    deadline: new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10),
    ...over,
  };
}

async function observations(goals: Array<Record<string, unknown>>) {
  const out = await makeService(goals).getRecommendations("r-1");
  return out.recommendations
    .filter((r) => r.ruleKey.startsWith("goal_behind_"))
    .map((r) => r.observation);
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

  it("a stored value whose latest reading was refused is left out", async () => {
    expect(
      await behindKeys([goal("c", 10, { current_unread: "no time zone is set" })]),
    ).toEqual([]);
  });

  it("a row with no dated reading (never read, the column's default 0) is left out", async () => {
    expect(await behindKeys([goal("d", 0, { current_read_at: null })])).toEqual([]);
  });
});

describe("the goal rule reads the goal's direction (reports lane r2)", () => {
  it("a ceiling held at a slow burn is not behind", async () => {
    expect(
      await behindKeys([goal("e", 30, { direction: "at_most", metric_key: "purchase_spend" })]),
    ).toEqual([]);
  });

  it("a ceiling spent faster than its schedule says so in ceiling words", async () => {
    expect(
      await observations([goal("f", 90, { direction: "at_most", metric_key: "purchase_spend" })]),
    ).toEqual(['Goal "Goal f" is on course to go over its ceiling (90% of it used).']);
  });

  it("a ceiling already broken says over", async () => {
    expect(
      await observations([goal("g", 130, { direction: "at_most", metric_key: "purchase_spend" })]),
    ).toEqual(['Goal "Goal g" is over its ceiling (130% of it).']);
  });

  it("a level already under its ceiling is not behind on day one", async () => {
    expect(
      await behindKeys([
        goal("h", 25, {
          direction: "at_most",
          metric_key: "avg_check",
          target_value: 30,
          baseline_value: 45,
          created_at: new Date(Date.now() - DAY_MS).toISOString(),
        }),
      ]),
    ).toEqual([]);
  });

  it("an older reading is dated", async () => {
    const at = new Date(Date.now() - 3 * DAY_MS);
    const [line] = await observations([goal("i", 10, { current_read_at: at.toISOString() })]);
    expect(line).toBe(`Goal "Goal i" is behind its pace (10% done, read on ${at.toISOString().slice(0, 10)}).`);
  });
});
