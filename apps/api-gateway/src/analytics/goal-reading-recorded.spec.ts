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
      or: () => chain,
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
    // This harness's store answers no rows, so it cannot say the row holds it.
    expect(out.readingStored).toBe("unstored");
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

/**
 * Newest reading wins, not last writer (reports lane r3). The store below
 * applies the write's own condition, as Postgres does inside one UPDATE.
 */
describe("a slower, older reading never overwrites a newer one", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function store(initial: Record<string, unknown>) {
    const row: Record<string, unknown> = { ...initial };
    const conditions: string[] = [];
    const from = () => {
      let patch: Record<string, unknown> | null = null;
      const eqs: Array<[string, unknown]> = [];
      let or: string | null = null;
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => (eqs.push([k, v]), chain),
        or: (f: string) => ((or = f), conditions.push(f), chain),
        update: (p: Record<string, unknown>) => ((patch = p), chain),
        single: async () => ({ data: { ...row }, error: null }),
        maybeSingle: async () => ({ data: { timezone: "America/Detroit", country: "US" }, error: null }),
        then: (resolve: any, reject: any) => {
          // `.select("id")` after an update answers the rows it changed, as
          // PostgREST does: none when the condition kept the newer reading.
          let changed: Array<{ id: unknown }> = [];
          if (patch) {
            const m = /^current_read_at\.is\.null,current_read_at\.lt\."([^"]+)"$/.exec(or ?? "");
            const held = row.current_read_at as string | null;
            const newer = !m || held == null || Date.parse(held) < Date.parse(m[1]);
            if (eqs.every(([k, v]) => row[k] === v) && newer) {
              Object.assign(row, patch);
              changed = [{ id: row.id }];
            }
          }
          return Promise.resolve(patch ? { data: changed, error: null } : { data: [row], error: null }).then(resolve, reject);
        },
      };
      return chain;
    };
    return { row, conditions, from };
  }

  function service(from: () => unknown, readings: Array<{ after: number; dio: number | null }>) {
    let call = 0;
    return new GoalsService(
      { getClient: () => ({ from }) } as any,
      { getStored: async () => [] } as any,
      { get: () => undefined } as any,
      {} as any,
      verdicts,
      {
        getFinancialSummary: async () => {
          const r = readings[call++];
          await sleep(r.after);
          return { daysInventoryOutstanding: r.dio, inventoryValue: r.dio == null ? null : 900 };
        },
      } as any,
    );
  }

  it("a refusal that began first and ended last leaves the success that began after it", async () => {
    const s = store({ ...GOAL });
    const svc = service(s.from, [
      { after: 60, dio: null },
      { after: 0, dio: 28 },
    ]);
    const slow = svc.getGoalProgress("r1", "g1", undefined, { withSales: true });
    await sleep(15);
    const quick = await svc.getGoalProgress("r1", "g1", undefined, { withSales: true });
    await expect(slow).rejects.toThrow(/Days of stock cannot be read/);
    expect(quick.current).toBe(28);
    expect(s.row).toMatchObject({ current_value: 28, current_unread: null, current_read_at: quick.goal.current_read_at });
    expect(s.conditions).toHaveLength(2);
  });

  it("a success that began first and ended last leaves the refusal that began after it", async () => {
    const s = store({ ...GOAL });
    const svc = service(s.from, [
      { after: 60, dio: 28 },
      { after: 0, dio: null },
    ]);
    const slow = svc.getGoalProgress("r1", "g1", undefined, { withSales: true });
    await sleep(15);
    await expect(svc.getGoalProgress("r1", "g1", undefined, { withSales: true })).rejects.toThrow();
    await slow;
    expect(s.row.current_unread).toMatch(/Days of stock cannot be read/);
    expect(s.row.current_value).toBe(312.07);
  });

  it("says when its own reading was not stored because a newer one already was", async () => {
    const s = store({ ...GOAL });
    const svc = service(s.from, [
      { after: 60, dio: 25 },
      { after: 0, dio: 28 },
    ]);
    const slow = svc.getGoalProgress("r1", "g1", undefined, { withSales: true });
    await sleep(15);
    const quick = await svc.getGoalProgress("r1", "g1", undefined, { withSales: true });
    const late = await slow;
    expect(quick.readingStored).toBe("stored");
    // The late answer is still its own live reading, and says the row is not it.
    expect(late.current).toBe(25);
    expect(late.readingStored).toBe("superseded");
    expect(s.row).toMatchObject({ current_value: 28, current_read_at: quick.goal.current_read_at });
  });

  it("stamps the reading with when it began, and writes only over no reading or an older one", async () => {
    const s = store({ ...GOAL, current_read_at: null });
    const before = Date.now();
    const out = await service(s.from, [{ after: 40, dio: 28 }]).getGoalProgress("r1", "g1", undefined, { withSales: true });
    const stamped = Date.parse(out.goal.current_read_at);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThan(before + 30);
    expect(s.row.current_value).toBe(28);
    expect(s.conditions[0]).toBe(`current_read_at.is.null,current_read_at.lt."${out.goal.current_read_at}"`);
  });
});
