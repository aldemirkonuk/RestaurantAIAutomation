import { GoalsService } from "./goals.service";

/**
 * r36 reports audit, gap 2: the page's bench reads the goals list route, and
 * that route sent no `unit` (only the overview did, #1382). A money goal
 * printed "60.0K" with no currency, a percent goal "0.6" and a days goal a
 * bare "30". Every listed row now carries its metric's unit.
 */
function service(rows: Array<Record<string, unknown>>) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (ok: (v: unknown) => unknown) => ok({ data: rows, error: null }),
  };
  return new GoalsService(
    { getClient: () => ({ from: () => chain }) } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe("the goals list carries each goal's unit (r36 reports gap 2)", () => {
  it("names the unit of every supported metric, for every caller", async () => {
    const keys = Object.keys(GoalsService.SUPPORTED_METRICS);
    const rows = keys.map((k, i) => ({ id: `g${i}`, metric_key: k }));
    for (const gate of [{ withSales: true }, { withSales: false }]) {
      const out = await service(rows).listGoals("r1", "active", gate);
      expect(out.map((g: any) => g.unit)).toEqual(
        keys.map((k) => GoalsService.SUPPORTED_METRICS[k].unit),
      );
    }
  });

  it("money is currency, a share is percent, days are days", async () => {
    const out = await service([
      { id: "a", metric_key: "wine_revenue", target_value: 60000 },
      { id: "b", metric_key: "wine_attach_rate", target_value: 0.6 },
      { id: "c", metric_key: "days_of_inventory", target_value: 30 },
    ]).listGoals("r1", "active", { withSales: true });
    expect(out.map((g: any) => [g.id, g.unit, g.target_value])).toEqual([
      ["a", "currency", 60000],
      ["b", "percent", 0.6],
      ["c", "days", 30],
    ]);
  });

  it("a metric the server does not know has no unit, never a guessed one", async () => {
    const out = await service([
      { id: "x", metric_key: "retired_metric" },
    ]).listGoals("r1", "all", { withSales: true });
    expect(out[0].unit).toBeNull();
  });
});
