import { RecommendationsService } from "./recommendations.service";
import { CURRENCY_NOT_RECORDED_SENTENCE } from "./insights/insight-verbalizer";

/**
 * The dead-stock and spend-pace cards print their amount in the house's money.
 *
 * Both wrote a fixed "$": a lira house read "$12,345 is locked in inventory
 * that has not moved in 90 days" on /recommendations and in the digest (r8
 * browser check, 2026-11-12). The three states are the insight sentences'
 * (r8, insight-verbalizer.ts): a stated code prints its mark, none stated
 * prints the bare amount and says so once, and a failed read prints no amount,
 * keeps the advice, and names "house currency" as unread.
 */

const RID = "r-1";

type CurrencyRead = { code: string | null } | { error: string };

function makeService(currency: CurrencyRead, opts: { cards?: boolean } = {}) {
  const fires = opts.cards !== false;
  const supabase = {
    from: (table: string) => {
      const builder: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq", "in"])
        builder[m] = () => builder;
      builder.maybeSingle = () => {
        if (table !== "restaurants")
          return Promise.resolve({ data: null, error: null });
        if ("error" in currency)
          return Promise.resolve({
            data: null,
            error: { message: currency.error },
          });
        return Promise.resolve({
          data: { currency: currency.code, timezone: null, country: null },
          error: null,
        });
      };
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return builder;
    },
  };
  return new RecommendationsService(
    {
      getFinancialSummary: async () =>
        fires
          ? { deadStockCapital: 12345.4, deadStockTop: [{ name: "Idle Red" }] }
          : null,
      getRiskProfile: async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () =>
        fires ? { paceDeltaPct: 0.38, spendLast30d: 14820 } : null,
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

const card = (out: { recommendations: any[] }, key: string) =>
  out.recommendations.find((r) => r.ruleKey === key)?.observation as
    | string
    | undefined;

describe("the dead-stock and spend-pace cards print the house's money", () => {
  it("a lira house reads lira, never $", async () => {
    const out = await makeService({ code: "TRY" }).getRecommendations(RID, {
      recordImpressions: false,
    });
    expect(card(out, "dead_stock_capital")).toBe(
      "₺12,345 is locked in inventory that has not moved in 90 days (top: Idle Red).",
    );
    expect(card(out, "spend_acceleration")).toBe(
      "Purchasing spend is up 38% vs the prior 30 days (₺14,820).",
    );
    expect(JSON.stringify(out.recommendations)).not.toMatch(/\$\d/);
    expect(out.sourcesUnread).not.toContain("house currency");
  });

  it("a letter mark takes a space", async () => {
    const out = await makeService({ code: "CHF" }).getRecommendations(RID, {
      recordImpressions: false,
    });
    expect(card(out, "dead_stock_capital")).toMatch(/^CHF 12,345 is locked/);
    expect(card(out, "spend_acceleration")).toContain("(CHF 14,820)");
  });

  it("a dollar house still reads dollars", async () => {
    const out = await makeService({ code: "USD" }).getRecommendations(RID, {
      recordImpressions: false,
    });
    expect(card(out, "dead_stock_capital")).toMatch(/^\$12,345 is locked/);
  });

  it("no stated currency: the bare amount, and the card says so once", async () => {
    const out = await makeService({ code: null }).getRecommendations(RID, {
      recordImpressions: false,
    });
    const dead = card(out, "dead_stock_capital")!;
    expect(dead).toBe(
      `12,345 is locked in inventory that has not moved in 90 days (top: Idle Red). ${CURRENCY_NOT_RECORDED_SENTENCE}`,
    );
    expect(card(out, "spend_acceleration")).toBe(
      `Purchasing spend is up 38% vs the prior 30 days (14,820). ${CURRENCY_NOT_RECORDED_SENTENCE}`,
    );
    expect(out.sourcesUnread).not.toContain("house currency");
  });

  it("a failed read: no amount, the advice stays, and the currency is named unread", async () => {
    const out = await makeService({ error: "boom" }).getRecommendations(RID, {
      recordImpressions: false,
    });
    const dead = card(out, "dead_stock_capital")!;
    expect(dead).not.toMatch(/12,?345/);
    expect(dead).toBe(
      "Stock that has not moved in 90 days is holding cash (top: Idle Red). The amount is not shown: the house's currency could not be read.",
    );
    expect(card(out, "spend_acceleration")).toBe(
      "Purchasing spend is up 38% vs the prior 30 days. The amount is not shown: the house's currency could not be read.",
    );
    expect(out.sourcesUnread.filter((s) => s === "house currency")).toEqual([
      "house currency",
    ]);
  });

  it("a failed read that no card needed is not named", async () => {
    const out = await makeService({ error: "boom" }, { cards: false })
      .getRecommendations(RID, { recordImpressions: false });
    expect(card(out, "dead_stock_capital")).toBeUndefined();
    expect(out.sourcesUnread).not.toContain("house currency");
  });
});
