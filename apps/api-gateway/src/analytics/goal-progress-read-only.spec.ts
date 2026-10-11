import { GoalsService } from "./goals.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";

/**
 * F-264: a progress read writes nothing.
 *
 * `GET /analytics/goals/:restaurantId/progress` (listGoalsWithProgress) and
 * the one-goal read both ran through `getGoalProgress`, which issued an UPDATE
 * of `analytics_goals.current_value` and `updated_at` on every call — opening
 * the reports desk moved every goal's "last edited" time. The stored column is
 * now refreshed by the hourly insight sweep alone, and that refresh leaves
 * `updated_at` to the people who edit goals.
 */

const RESTAURANT = "r-1";

type Op = { table: string; op: string; payload?: unknown; filters: string[] };

function recordingDb(tables: Record<string, any[]>) {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      const rec: Op = { table, op: "select", filters: [] };
      ops.push(rec);
      const rows = () => tables[table] ?? [];
      const b: any = {
        select: () => b,
        eq: (col: string, v: unknown) => {
          rec.filters.push(`${col}=${v}`);
          return b;
        },
        in: (col: string, v: unknown[]) => {
          rec.filters.push(`${col} in ${v.join(",")}`);
          return b;
        },
        order: () => b,
        limit: () => b,
        update: (payload: unknown) => {
          rec.op = "update";
          rec.payload = payload;
          return b;
        },
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: any, rej: any) =>
          Promise.resolve({
            data: rec.op === "update" ? null : rows(),
            error: null,
          }).then(res, rej),
      };
      return b;
    },
  };
  return { ops, db: { getClient: () => client } as any };
}

const GOAL = {
  id: "g-1",
  restaurant_id: RESTAURANT,
  name: "Bottles",
  metric_key: "bottles_sold",
  target_value: 100,
  current_value: 4,
  direction: "at_least",
  status: "active",
  period: "monthly",
  created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
  deadline: null,
};

function goalsOver(tables: Record<string, any[]>) {
  const { ops, db } = recordingDb(tables);
  const goals = new GoalsService(
    db,
    { getStored: async () => [] } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(goals as any, "computeMetricWithSeries").mockResolvedValue({
    current: 42,
    dailySeries: [42],
    dailyDates: ["2026-10-01"],
    rowCount: 1,
    units: undefined,
  });
  return { goals, ops };
}

const TABLES = {
  analytics_goals: [GOAL],
  restaurants: [{ id: RESTAURANT, timezone: "UTC", country: null }],
};

describe("goal progress reads write nothing (F-264)", () => {
  it("R1: one goal's progress issues no UPDATE and still returns the live value", async () => {
    const { goals, ops } = goalsOver(TABLES);
    const out: any = await goals.getGoalProgress(RESTAURANT, "g-1");
    expect(out.current).toBe(42);
    expect(out.goal.current_value).toBe(42);
    expect(ops.filter((o) => o.op === "update")).toEqual([]);
  });

  it("R2: GET /analytics/goals/:restaurantId/progress issues no UPDATE", async () => {
    const { goals, ops } = goalsOver(TABLES);
    const out: any = await goals.listGoalsWithProgress(RESTAURANT, "active");
    expect(out.goals[0].current).toBe(42);
    expect(ops.filter((o) => o.op === "update")).toEqual([]);
  });

  it("R3: the sweep's refresh writes current_value alone, scoped to the house", async () => {
    const { goals, ops } = goalsOver(TABLES);
    const out = await goals.refreshStoredCurrentValues(RESTAURANT);
    expect(out).toEqual({ refreshed: 1, failed: 0, closed: 0 });
    const updates = ops.filter((o) => o.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ current_value: 42 });
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([`restaurant_id=${RESTAURANT}`, "id=g-1"]),
    );
  });

  it("R4: a goal that cannot be measured keeps its stored value", async () => {
    const { goals, ops } = goalsOver(TABLES);
    (goals as any).computeMetricWithSeries.mockRejectedValue(
      new Error("window not read whole"),
    );
    const out = await goals.refreshStoredCurrentValues(RESTAURANT);
    expect(out).toEqual({ refreshed: 0, failed: 1, closed: 0 });
    expect(ops.filter((o) => o.op === "update")).toEqual([]);
  });

  it("R5: the hourly insight sweep refreshes each house's stored goal values", async () => {
    const { db } = recordingDb({
      restaurants: [{ id: RESTAURANT }],
      analytics_insight_prefs: [],
    });
    const generator = {
      staleVersionCategories: async () => new Map(),
      generate: jest.fn(async () => ({})),
    };
    const goals = {
      refreshStoredCurrentValues: jest.fn(async () => ({
        refreshed: 1,
        failed: 0,
      })),
    };
    const scheduler = new InsightSchedulerService(
      db,
      generator as any,
      goals as any,
    );
    // 03:00 is not the default 06:00 hour, so no insight category is due:
    // the stored values are refreshed regardless of insight cadence.
    await scheduler.runSweep(new Date(2026, 9, 8, 3, 0, 0));
    expect(goals.refreshStoredCurrentValues).toHaveBeenCalledWith(RESTAURANT);
    expect(generator.generate).not.toHaveBeenCalled();
  });
});

/**
 * F-1291 (F-628 residual): a goal never reached achieved or missed, so a
 * goal past its deadline stayed active forever. The hourly sweep closes it
 * from its final window's value; progress reads still write nothing.
 */
describe("a goal closes at its deadline (F-1291)", () => {
  const past = { ...GOAL, deadline: "2026-01-31", period: "custom" };

  it("C1: a past-deadline goal short of its target closes as missed, once", async () => {
    const { goals, ops } = goalsOver({ ...TABLES, analytics_goals: [past] });
    const out = await goals.refreshStoredCurrentValues(RESTAURANT);
    expect(out).toEqual({ refreshed: 1, failed: 0, closed: 1 });
    const [u] = ops.filter((o) => o.op === "update");
    expect(u.payload).toEqual({ current_value: 42, status: "missed" });
    // Only an active goal is closed: a second sweep, or an archive in
    // between, changes nothing.
    expect(u.filters).toEqual(
      expect.arrayContaining([
        `restaurant_id=${RESTAURANT}`,
        "id=g-1",
        "status=active",
      ]),
    );
  });

  it("C2: at or past its target it closes as achieved; at most turns it round", () => {
    expect(
      GoalsService.closedOutcome(
        { ...past, target_value: 40 },
        42,
        "2026-10-11",
      ),
    ).toBe("achieved");
    expect(
      GoalsService.closedOutcome(
        { ...past, target_value: 42 },
        42,
        "2026-10-11",
      ),
    ).toBe("achieved");
    expect(
      GoalsService.closedOutcome(
        { ...past, direction: "at_most", target_value: 40 },
        42,
        "2026-10-11",
      ),
    ).toBe("missed");
    expect(
      GoalsService.closedOutcome(
        { ...past, direction: "at_most", target_value: "50" },
        42,
        "2026-10-11",
      ),
    ).toBe("achieved");
  });

  it("C3: it stays open through its deadline day, with no deadline, unread, or with no house zone", () => {
    expect(
      GoalsService.closedOutcome(
        { ...past, deadline: "2026-10-11" },
        42,
        "2026-10-11",
      ),
    ).toBeNull();
    expect(
      GoalsService.closedOutcome({ ...past, deadline: null }, 42, "2026-10-11"),
    ).toBeNull();
    expect(GoalsService.closedOutcome(past, null, "2026-10-11")).toBeNull();
    expect(GoalsService.closedOutcome(past, 42, null)).toBeNull();
  });

  it("C4: a goal whose deadline is still ahead is refreshed and left open", async () => {
    const ahead = { ...past, deadline: "2999-12-31" };
    const { goals, ops } = goalsOver({ ...TABLES, analytics_goals: [ahead] });
    const out = await goals.refreshStoredCurrentValues(RESTAURANT);
    expect(out.closed).toBe(0);
    expect(ops.filter((o) => o.op === "update")[0].payload).toEqual({
      current_value: 42,
    });
  });

  it("C5: the progress read carries the closed goals for their own fold, and writes nothing", async () => {
    const shut = {
      ...past,
      id: "g-2",
      status: "missed",
      current_value: "38.5",
    };
    const { goals, ops } = goalsOver({ ...TABLES, analytics_goals: [shut] });
    const out: any = await goals.listGoalsWithProgress(RESTAURANT, "active");
    const closedRead = ops.find((o) =>
      o.filters.includes("status in achieved,missed"),
    );
    expect(closedRead).toBeDefined();
    expect(out.closed[0]).toMatchObject({
      outcome: "missed",
      final: 38.5,
      target: 100,
      unit: "units",
    });
    expect(out.closedTotal).toBe(1);
    expect(ops.filter((o) => o.op === "update")).toEqual([]);
  });
});
