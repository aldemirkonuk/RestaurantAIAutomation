/**
 * r31 walk w3, F1: a wine attach goal typed as "50" was kept as 50 against a
 * 0-1 share and read "5000.0%". The form now sends 0.5; the writer refuses a
 * percent target above the whole, on create and on edit, before any write.
 */
import { GoalsService } from "./goals.service";

function service(kept: { metric_key: string } | null, writes: string[]) {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      insert: () => {
        writes.push(`insert ${table}`);
        return chain;
      },
      update: () => {
        writes.push(`update ${table}`);
        return chain;
      },
      maybeSingle: async () => ({ data: writes.length ? { id: "g1" } : kept, error: null }),
      single: async () => ({ data: { id: "g1" }, error: null }),
    };
    return chain;
  };
  return new GoalsService(
    { getClient: () => ({ from }) } as any,
    {} as any,
    { get: () => undefined } as any,
    {} as any,
    { record: () => {}, recordForEvent: () => {} } as any,
    { getFinancialSummary: async () => ({}) } as any,
  );
}

describe("a percent goal's target is a share (r31 w3 F1)", () => {
  it("names the refusal for a percent measure above 1, and none for 0.5 or for money", () => {
    expect(GoalsService.percentTargetRefusal("wine_attach_rate", 50)).toMatch(/share of the whole.*50% is 0\.5/);
    expect(GoalsService.percentTargetRefusal("wine_attach_rate", 0.5)).toBeNull();
    expect(GoalsService.percentTargetRefusal("wine_attach_rate", 1)).toBeNull();
    expect(GoalsService.percentTargetRefusal("wine_revenue", 60000)).toBeNull();
  });

  it("create: a wine attach target of 50 is refused before anything is written", async () => {
    const writes: string[] = [];
    await expect(
      service(null, writes).createGoal("r1", { name: "More wine", metricKey: "wine_attach_rate", targetValue: 50 }),
    ).rejects.toThrow(/share of the whole/);
    expect(writes).toEqual([]);
  });

  it("edit: 50 on a kept wine attach goal is refused before the update", async () => {
    const writes: string[] = [];
    await expect(
      service({ metric_key: "wine_attach_rate" }, writes).updateGoal("r1", "g1", { targetValue: 50 }),
    ).rejects.toThrow(/share of the whole/);
    expect(writes).toEqual([]);
  });

  it("edit: 60000 on a money goal is written", async () => {
    const writes: string[] = [];
    await service({ metric_key: "wine_revenue" }, writes).updateGoal("r1", "g1", { targetValue: 60000 });
    expect(writes).toEqual(["update analytics_goals"]);
  });
});
