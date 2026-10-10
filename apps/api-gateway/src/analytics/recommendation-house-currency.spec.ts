import { RecommendationsService } from "./recommendations.service";

/**
 * F-341: two recommendation cards printed `$` in front of the house's money
 * whatever `restaurants.currency` held — "$12,400 is locked in inventory" to
 * a house in Istanbul. They now print the house's own currency, and no
 * symbol when none is recorded.
 */
function serviceFor(currency: string | null) {
  const supabase = {
    from: (table: string) => {
      const b: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq"])
        b[m] = () => b;
      b.then = (resolve: any, reject: any) =>
        Promise.resolve({
          data: table === "restaurants" ? [{ currency }] : [],
          error: null,
        }).then(resolve, reject);
      return b;
    },
  };
  return new RecommendationsService(
    {
      getFinancialSummary: async () => ({
        deadStockCapital: 12400.4,
        deadStockTop: [{ name: "Old Rioja" }],
      }),
      getRiskProfile: async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => ({ paceDeltaPct: 0.5, spendLast30d: 8300 }),
    } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals: async () => [] } as any,
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

async function observations(currency: string | null) {
  const out = await serviceFor(currency).getRecommendations("r-1");
  const of = (key: string) =>
    out.recommendations.find((r) => r.ruleKey === key)?.observation;
  return {
    deadStock: of("dead_stock_capital"),
    spend: of("spend_acceleration"),
  };
}

describe("recommendation cards print the house's own money (F-341)", () => {
  it("a lira house reads lira", async () => {
    const o = await observations("TRY");
    expect(o.deadStock).toBe(
      "TRY 12,400 is locked in inventory that has not moved in 90 days (top: Old Rioja).",
    );
    expect(o.spend).toBe(
      "Purchasing spend is up 50% vs the prior 30 days (TRY 8,300).",
    );
  });

  it("a pound house reads pounds", async () => {
    const o = await observations("GBP");
    expect(o.deadStock).toMatch(/^£12,400 is locked/);
    expect(o.spend).toContain("(£8,300)");
  });

  it("a house with no recorded currency reads no symbol, never a dollar", async () => {
    const o = await observations(null);
    expect(o.deadStock).toMatch(/^12,400 is locked/);
    expect(o.spend).toContain("(8,300)");
    expect(`${o.deadStock}${o.spend}`).not.toContain("$");
  });
});
