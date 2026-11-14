import { GoalsService } from "./goals.service";

/**
 * A refused reading is recorded, so no stored row shows an older number as
 * where the goal stands (reports lane r2; #1088 residual "stale stored value
 * for owners and managers").
 */

const verdicts = { record: () => {}, recordForEvent: () => {} } as any;

const GOAL = {
  id: "g1",
  restaurant_id: "r1",
  name: "Days of stock under 30",
  metric_key: "days_of_inventory",
  direction: "at_most",
  target_value: 30,
  baseline_value: 45,
  current_value: 312.07,
  current_read_at: "2026-11-01T10:00:00Z",
  current_unread: null,
  deadline: null,
  created_at: "2026-10-01T10:00:00Z",
};

function harness(dio: unknown, listed: Record<string, unknown>[] = [GOAL]) {
  const updates: Array<{ patch: Record<string, unknown>; eqs: Array<[string, unknown]> }> = [];
  const from = () => {
    const eqs: Array<[string, unknown]> = [];
    let patch: Record<string, unknown> | null = null;
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        eqs.push([k, v]);
        return chain;
      },
      order: () => chain,
      update: (p: Record<string, unknown>) => {
        patch = p;
        updates.push({ patch: p, eqs });
        return chain;
      },
      single: async () => ({ data: GOAL, error: null }),
      maybeSingle: async () => ({ data: { timezone: "America/Detroit", country: "US" }, error: null }),
      then: (resolve: any, reject: any) =>
        Promise.resolve(patch ? { error: null } : { data: listed, error: null }).then(resolve, reject),
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
      getFinancialSummary: async () => ({
        daysInventoryOutstanding: dio,
        inventoryValue: dio == null ? null : 900,
      }),
    } as any,
  );
  return { service, updates };
}

describe("a goal's reading is recorded with when, and a refusal with why", () => {
  it("a reading stores the value, the time, and clears a refusal, scoped to the house", async () => {
    const { service, updates } = harness(28);
    const out = await service.getGoalProgress("r1", "g1", undefined, { withSales: true });
    expect(out.current).toBe(28);
    expect(out.met).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({ current_value: 28, current_unread: null });
    expect(typeof updates[0].patch.current_read_at).toBe("string");
    expect(updates[0].eqs).toEqual(expect.arrayContaining([["restaurant_id", "r1"], ["id", "g1"]]));
  });

  it("a refusal about the house's data is recorded, and the older value is not rewritten", async () => {
    const { service, updates } = harness(null);
    await expect(service.getGoalProgress("r1", "g1", undefined, { withSales: true })).rejects.toThrow(
      /Days of stock cannot be read/,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.current_unread).toMatch(/Days of stock cannot be read/);
    expect(updates[0].patch).not.toHaveProperty("current_value");
  });

  it("a refusal about the caller (no sales) records nothing", async () => {
    const { service, updates } = harness(null);
    await expect(service.getGoalProgress("r1", "g1")).rejects.toThrow(/owners and managers only/);
    expect(updates).toHaveLength(0);
  });

  it("a listed row whose latest reading was refused goes out with no current value", async () => {
    const refused = { ...GOAL, metric_key: "wine_revenue", current_unread: "no time zone is set" };
    const { service } = harness(28, [refused, { ...GOAL, id: "g2", metric_key: "wine_revenue" }]);
    const rows = await service.listGoals("r1", "active", { withSales: true });
    expect(rows[0]).toMatchObject({ id: "g1", current_value: null, current_unread: "no time zone is set" });
    expect(rows[1]).toMatchObject({ id: "g2", current_value: 312.07 });
  });
});
