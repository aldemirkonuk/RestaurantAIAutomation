import { RecommendationsService } from "./recommendations.service";
import { MarginAdviceService } from "../pricing/margin-advice.service";

/**
 * ADR 0193 -- the live recommendations feed carries price advice toward the
 * house's target margin. The feed runs for real with the real
 * MarginAdviceService over a fake client answering by table; every other
 * input to the feed is empty so only the pricing rules can fire.
 *
 * The founder, 2026-09-21: "make sure that endpoint exists that we will ask or
 * recommend or advise the manager or owner to increase decrease the prices so
 * that the profit margin is where it's needed."
 */

type Row = Record<string, any>;

function feed(opts: { house: Row | null; inventory: Row[]; rollup: Row[]; inventoryError?: string }) {
  const client: any = {
    from: (table: string) => {
      const b: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq", "gte", "in"]) b[m] = () => b;
      b.maybeSingle = async () =>
        table === "restaurants" ? { data: opts.house, error: null } : { data: null, error: null };
      b.then = (resolve: any, reject: any) => {
        let r: any = { data: [], error: null };
        if (table === "restaurant_inventory")
          r = opts.inventoryError
            ? { data: null, error: { message: opts.inventoryError } }
            : { data: opts.inventory, error: null };
        if (table === "inventory_lot_rollup") r = { data: opts.rollup, error: null };
        return Promise.resolve(r).then(resolve, reject);
      };
      return b;
    },
  };
  const advice = new MarginAdviceService({ client } as any);
  const svc = new RecommendationsService(
    { getFinancialSummary: async () => null, getRiskProfile: async () => null, getInventoryScience: async () => null } as any,
    { getMenuEngineering: async () => null, getSeasonality: async () => null, getCashflow: async () => null } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals: async () => [] } as any,
    { readDispositions: async () => ({ map: new Map(), readable: true, problem: null }) } as any,
    { supabase: client, getClient: () => client } as any,
    advice,
  );
  return svc;
}

const WINE = {
  id: "inv-a",
  wine_name: "Barolo",
  sale_type: "bottle",
  menu_price_current: "50.00",
  menu_price_glass: null,
  last_purchase_price: null,
  bottle_size_ml: 750,
  pour_size_ml: 150,
  master_wine_library: { name: "Barolo", bottle_size_ml: 750 },
  restaurants: { default_pour_ml: 150 },
};
const NO_COST_WINE = { ...WINE, id: "inv-b", wine_name: "Mystery" };
const ROLLUP = [{ inventory_id: "inv-a", live_qty: 6, wac: "20", has_invoice_cost: true, wac_qty: 6 }];
const SET = {
  target_margin_bottle_pct: "65",
  target_margin_glass_pct: null,
  target_margin_band_pts: "2",
  target_margin_set_by: "u",
  target_margin_set_at: "2026-09-21T09:00:00Z",
};
const UNSET = {
  target_margin_bottle_pct: null,
  target_margin_glass_pct: null,
  target_margin_band_pts: null,
  target_margin_set_by: null,
  target_margin_set_at: null,
};

describe("the recommendations feed advises toward the house's target margin (ADR 0193)", () => {
  it("names the wine and the exact price: 'raise to 57.14', with the numbers attached", async () => {
    const out = await feed({ house: SET, inventory: [WINE, NO_COST_WINE], rollup: ROLLUP }).getRecommendations("r-1");
    const card = out.recommendations.find((r) => r.ruleKey === "margin_to_target");
    expect(card).toBeDefined();
    expect(card!.category).toBe("pricing");
    expect(card!.observation).toMatch(/^1 price sits outside your target margin: 1 below it, 0 above it\. 1 more cannot be judged/);
    expect(card!.recommendation).toMatch(/Barolo: Raise the bottle to 57\.14 \(now 50\.00\)/);
    expect(card!.recommendation).toMatch(/Nothing changes until you do\./);
    expect(card!.priceAdvice).toEqual([
      expect.objectContaining({ inventoryId: "inv-a", kind: "bottle", state: "raise", price: 50, advisedPrice: 57.14, targetPct: 65 }),
    ]);
    expect(out.priceAdviceReadable).toBe(true);
  });

  it("says the cost gap out loud rather than implying those wines are fine", async () => {
    const out = await feed({ house: SET, inventory: [WINE, NO_COST_WINE], rollup: ROLLUP }).getRecommendations("r-1");
    const blind = out.recommendations.find((r) => r.ruleKey === "margin_advice_blind");
    expect(blind?.observation).toMatch(/^1 price cannot be judged against your target margin/);
  });

  it("no target set: one entry asking for it, and no price advice", async () => {
    const out = await feed({ house: UNSET, inventory: [WINE], rollup: ROLLUP }).getRecommendations("r-1");
    const keys = out.recommendations.map((r) => r.ruleKey);
    expect(keys).toContain("margin_target_unset");
    expect(keys).not.toContain("margin_to_target");
    expect(keys).not.toContain("margin_advice_blind");
  });

  it("a wine already on target produces no advice entry", async () => {
    const out = await feed({
      house: SET,
      inventory: [{ ...WINE, menu_price_current: "57.14" }],
      rollup: ROLLUP,
    }).getRecommendations("r-1");
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain("margin_to_target");
  });

  it("advice that could not be computed is SAID (priceAdviceReadable: false + reason), never read as all-on-target", async () => {
    const out = await feed({ house: SET, inventory: [], rollup: [], inventoryError: "timeout" }).getRecommendations("r-1");
    expect(out.priceAdviceReadable).toBe(false);
    expect(out.priceAdviceReason).toMatch(/could not be read/);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain("margin_to_target");
  });
});
