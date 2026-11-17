import { GoalsService } from "./goals.service";

/**
 * The goals list reads each goal's row once: the row it lists is the row it
 * scores, so no goal costs a second read by key (r41 reports gap 6).
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
  created_at: "2026-10-01T10:00:00Z",
  ...extra,
});

function harness(rows: Record<string, unknown>[]) {
  const counts = { byKey: 0, lists: 0 };
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
      single: async () => {
        counts.byKey += 1;
        return { data: rows[0], error: null };
      },
      maybeSingle: async () => ({ data: { timezone: "America/Detroit", country: "US" }, error: null }),
      then: (resolve: any, reject: any) => {
        if (!isUpdate && table === "analytics_goals") counts.lists += 1;
        return Promise.resolve(isUpdate ? { error: null } : { data: rows, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  const service = new GoalsService(
    { getClient: () => ({ from }) } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    verdicts,
    { getFinancialSummary: async () => ({ daysInventoryOutstanding: 28, inventoryValue: 900 }) } as any,
  );
  return { service, counts };
}

describe("the goals list reads each goal once", () => {
  it("scores every listed goal from the row it listed, with one list read and no read by key", async () => {
    const { service, counts } = harness([goal("g1"), goal("g2"), goal("g3")]);
    const out: any = await service.listGoalsWithProgress("r1", "active", { withSales: true });
    expect(out.goals).toHaveLength(3);
    expect(out.goals.map((p: any) => p.goal.id)).toEqual(["g1", "g2", "g3"]);
    expect(out.goals.every((p: any) => p.current === 28)).toBe(true);
    expect(counts.lists).toBe(1);
    expect(counts.byKey).toBe(0);
  });

  it("one goal read on its own is still read by key", async () => {
    const { service, counts } = harness([goal("g1")]);
    const out: any = await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(out.current).toBe(28);
    expect(counts.byKey).toBe(1);
  });

  it("a listed goal's reading withheld from the caller is still withheld, scored from the stored row", async () => {
    const { service } = harness([goal("g1", { metric_key: "wine_revenue" })]);
    const out: any = await service.listGoalsWithProgress("r1", "active", {});
    expect(out.goals[0].withheldForRole).toEqual(expect.arrayContaining(["sales"]));
    expect(out.goals[0].goal.current_value).toBeNull();
  });
});
