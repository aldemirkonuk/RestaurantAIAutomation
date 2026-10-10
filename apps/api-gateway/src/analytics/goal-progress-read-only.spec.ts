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
  jest
    .spyOn(goals as any, "computeMetricWithSeries")
    .mockResolvedValue({
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
    expect(out).toEqual({ refreshed: 1, failed: 0 });
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
    expect(out).toEqual({ refreshed: 0, failed: 1 });
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
