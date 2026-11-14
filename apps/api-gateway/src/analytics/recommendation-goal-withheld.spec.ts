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

function makeService(
  goals: Array<Record<string, unknown>>,
  zone: string | Error = "America/Los_Angeles",
) {
  const supabase = {
    from: () => {
      const builder: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq"])
        builder[m] = () => builder;
      // The house's zone (`readHouseZone` reads `restaurants` by id).
      builder.maybeSingle = async () =>
        zone instanceof Error
          ? { data: null, error: { message: zone.message } }
          : { data: { timezone: zone, country: "US" }, error: null };
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

async function behindKeys(
  goals: Array<Record<string, unknown>>,
  zone?: string | Error,
) {
  const out = await makeService(goals, zone).getRecommendations("r-1");
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
    // Dated by the house's day (Los Angeles), as the desk files its days.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(at);
    expect(line).toBe(`Goal "Goal i" is behind its pace (10% done, read on ${day}).`);
  });
});

describe("the goal rule schedules a goal on the desk's clock (fix round 2026-11-12)", () => {
  // Los Angeles in January (UTC-8). Created 10:00 on the 13th, deadline the
  // 15th, read at 20:00 on the 14th: the desk's schedule runs from the
  // midnight opening the 13th to the midnight opening the 15th (48 h), and 44
  // of them have run. The rule used the raw creation instant and UTC's
  // midnight, which had closed four hours before the reading: it called the
  // goal at the deadline already and behind at 85 of 100.
  const edge = (over: Record<string, unknown> = {}) =>
    goal("k", 85, {
      created_at: "2026-01-13T18:00:00Z",
      deadline: "2026-01-15",
      current_read_at: "2026-01-15T04:00:00Z",
      ...over,
    });

  it("a goal the desk calls on pace near its deadline day is not behind here", async () => {
    expect(await behindKeys([edge()])).toEqual([]);
  });

  it("control: the same goal well short of its pace is behind", async () => {
    expect(await behindKeys([edge({ current_value: 60 })])).toEqual(["goal_behind_k"]);
  });

  it("an older reading is dated by the house's day, not UTC's", async () => {
    const [line] = await observations([edge({ current_value: 60 })]);
    // 04:00Z on the 15th is the evening of the 14th in Los Angeles.
    expect(line).toBe('Goal "Goal k" is behind its pace (60% done, read on 2026-01-14).');
  });

  it("with the zone unread no pace is judged, and the zone is named as unread", async () => {
    const out = await makeService([edge({ current_value: 60 })], new Error("down")).getRecommendations("r-1");
    expect(out.recommendations.filter((r) => r.ruleKey.startsWith("goal_behind_"))).toEqual([]);
    expect(out.sourcesUnread).toContain("house time zone");
  });

  it("with the zone unread and no goal to judge, nothing is named", async () => {
    const out = await makeService([], new Error("down")).getRecommendations("r-1");
    expect(out.sourcesUnread).not.toContain("house time zone");
  });
});
