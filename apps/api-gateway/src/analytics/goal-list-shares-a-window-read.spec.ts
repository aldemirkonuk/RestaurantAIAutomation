import { GoalsService } from "./goals.service";

/**
 * Goals on one metric whose windows open on the same house day are scored from
 * one read of that figure, not one each (r41 reports gap 6, part 3).
 */

const verdicts = { record: () => {}, recordForEvent: () => {} } as any;

const goal = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  restaurant_id: "r1",
  name: `Goal ${id}`,
  metric_key: "days_of_inventory",
  direction: "at_most",
  target_value: 30,
  baseline_value: 45,
  current_value: 31,
  current_read_at: "2026-11-01T10:00:00Z",
  current_unread: null,
  deadline: null,
  created_at: "2026-10-01T15:00:00Z",
  ...extra,
});

function harness(rows: Record<string, unknown>[], summary: () => Promise<unknown>) {
  const counts = { summaries: 0 };
  const from = (table: string) => {
    let isUpdate = false;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      update: () => {
        isUpdate = true;
        return chain;
      },
      single: async () => ({ data: rows[0], error: null }),
      maybeSingle: async () => ({ data: { timezone: "America/Detroit", country: "US" }, error: null }),
      then: (resolve: any, reject: any) =>
        Promise.resolve(isUpdate ? { error: null } : { data: rows, error: null }).then(resolve, reject),
    };
    return chain;
  };
  const service = new GoalsService(
    { getClient: () => ({ from }) } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    verdicts,
    {
      getFinancialSummary: async () => {
        counts.summaries += 1;
        return summary();
      },
    } as any,
  );
  return { service, counts };
}

const ok = async () => ({ daysInventoryOutstanding: 28, inventoryValue: 900 });

describe("the goals list shares a window read", () => {
  it("two goals on one metric opened the same day are scored from one read", async () => {
    const { service, counts } = harness([goal("g1"), goal("g2")], ok);
    const out: any = await service.listGoalsWithProgress("r1", "active", { withSales: true });
    expect(out.goals.map((p: any) => p.current)).toEqual([28, 28]);
    expect(counts.summaries).toBe(1);
  });

  it("a goal opened on another day keeps its own read", async () => {
    const { service, counts } = harness(
      [goal("g1"), goal("g2", { created_at: "2026-10-09T15:00:00Z" })],
      ok,
    );
    const out: any = await service.listGoalsWithProgress("r1", "active", { withSales: true });
    expect(out.goals.map((p: any) => p.current)).toEqual([28, 28]);
    expect(counts.summaries).toBe(2);
  });

  it("a goal on another metric keeps its own read", async () => {
    const { service } = harness([goal("g1"), goal("g2", { metric_key: "wine_revenue" })], ok);
    const spy = jest
      .spyOn(service as any, "computeMetricWithSeries")
      .mockResolvedValue({ current: 5, dailySeries: [], dailyDates: [], rowCount: 1 });
    await service.listGoalsWithProgress("r1", "active", { withSales: true });
    expect(spy.mock.calls.map((c) => c[1]).sort()).toEqual(["days_of_inventory", "wine_revenue"]);
  });

  it("a read that fails is shared, and every goal on it is said unreadable", async () => {
    const { service, counts } = harness([goal("g1"), goal("g2")], async () => {
      throw new Error("db down");
    });
    const out: any = await service.listGoalsWithProgress("r1", "active", { withSales: true });
    expect(out.goals.map((p: any) => p.unreadable)).toEqual([true, true]);
    expect(counts.summaries).toBe(1);
  });

  it("two separate single-goal reads share nothing", async () => {
    const { service, counts } = harness([goal("g1")], ok);
    await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(counts.summaries).toBe(2);
  });
});
