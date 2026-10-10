import { RULES_THAT_PRINT_MONEY } from "./money-for-role";
import { RecommendationsService } from "./recommendations.service";

/**
 * F-341: two recommendation cards printed `$` in front of the house's money
 * whatever `restaurants.currency` held — "$12,400 is locked in inventory" to
 * a house in Istanbul. They now print the house's own currency, and no
 * symbol when none is recorded.
 */
function serviceFor(
  currency: string | null,
  house: { country?: string | null; timezone?: string | null } = {},
  risk: any = null,
) {
  const supabase = {
    from: (table: string) => {
      const b: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq"])
        b[m] = () => b;
      b.then = (resolve: any, reject: any) =>
        Promise.resolve({
          data: table === "restaurants" ? [{ currency, ...house }] : [],
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
      getRiskProfile: async () => risk,
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

/**
 * F-866: in a house whose country groups with ".", the figure is grouped so;
 * F-863: an entry that prints the house's money says so (`amounts: true`),
 * which is what keeps it from staff when the words carry no sign.
 */
describe("recommendation cards in the house's formats, tagged as money", () => {
  it("a Turkish house reads its own sign and grouping", async () => {
    const out = await serviceFor("TRY", { country: "TR" }).getRecommendations(
      "r-1",
    );
    const dead = out.recommendations.find(
      (r) => r.ruleKey === "dead_stock_capital",
    );
    expect(dead?.observation).toBe(
      "₺12.400 is locked in inventory that has not moved in 90 days (top: Old Rioja).",
    );
  });

  it.each([["TRY"], [null]])(
    "currency %s: the cards that print an amount are tagged",
    async (code) => {
      const out = await serviceFor(code).getRecommendations("r-1");
      const tagged = out.recommendations
        .filter((r) => r.amounts === true)
        .map((r) => r.ruleKey);
      expect(tagged.sort()).toEqual([
        "dead_stock_capital",
        "spend_acceleration",
      ]);
      // The stored acts of the same cards are cut by rule; the two lists agree.
      for (const key of tagged)
        expect(RULES_THAT_PRINT_MONEY.has(key)).toBe(true);
    },
  );
});

/**
 * F-1040: the concentration cards printed their figures with `toFixed`, so a
 * Türkiye house read "2.4 vendors", which is 24 by its own decimal mark.
 */
describe("concentration cards in the house's number marks (F-1040)", () => {
  const risk = {
    vendorConcentration: { hhi: 0.5234, effectiveVendors: 2.4 },
    revenueConcentration: { gini: 0.7123 },
  };
  const of = async (country: string | null) => {
    const out = await serviceFor("TRY", { country }, risk).getRecommendations(
      "r-1",
    );
    const obs = (key: string) =>
      out.recommendations.find((r) => r.ruleKey === key)?.observation;
    return {
      vendor: obs("vendor_concentration"),
      revenue: obs("revenue_concentration"),
    };
  };

  it("a Turkish house reads its own decimal and group marks", async () => {
    const o = await of("TR");
    expect(o.vendor).toBe(
      "Purchasing is highly concentrated (HHI 5.234 — effectively 2,4 vendors).",
    );
    expect(o.revenue).toBe("Revenue rides on very few drinks (Gini 0,71).");
  });

  it("a house with no known formats keeps the en-US marks", async () => {
    const o = await of(null);
    expect(o.vendor).toBe(
      "Purchasing is highly concentrated (HHI 5,234 — effectively 2.4 vendors).",
    );
    expect(o.revenue).toBe("Revenue rides on very few drinks (Gini 0.71).");
  });
});
