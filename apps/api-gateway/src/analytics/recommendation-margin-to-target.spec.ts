import { RecommendationsService } from "./recommendations.service";
import { MarginAdviceService } from "../pricing/margin-advice.service";
import { PriceLocksService } from "../pricing/price-locks.service";

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

function feed(opts: {
  house: Row | null;
  inventory: Row[];
  rollup: Row[];
  inventoryError?: string;
  locks?: Row[];
  menus?: Row[];
  menusError?: string;
  menuItems?: Row[];
  users?: Row[];
  access?: Row[];
}) {
  const client: any = {
    from: (table: string) => {
      const b: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq", "gte", "in", "is", "gt", "neq"]) b[m] = () => b;
      b.maybeSingle = async () =>
        table === "restaurants" ? { data: opts.house, error: null } : { data: null, error: null };
      b.then = (resolve: any, reject: any) => {
        let r: any = { data: [], error: null };
        if (table === "restaurant_inventory")
          r = opts.inventoryError
            ? { data: null, error: { message: opts.inventoryError } }
            : { data: opts.inventory, error: null };
        if (table === "inventory_lot_rollup") r = { data: opts.rollup, error: null };
        if (table === "house_price_locks") r = { data: opts.locks ?? [], error: null };
        if (table === "restaurant_menus")
          r = opts.menusError ? { data: null, error: { message: opts.menusError } } : { data: opts.menus ?? [], error: null };
        if (table === "menu_items") r = { data: opts.menuItems ?? [], error: null };
        if (table === "users") r = { data: opts.users ?? [], error: null };
        if (table === "user_restaurant_access") r = { data: opts.access ?? [], error: null };
        return Promise.resolve(r).then(resolve, reject);
      };
      return b;
    },
  };
  const advice = new MarginAdviceService({ client } as any);
  const locks = new PriceLocksService({ client } as any, advice);
  const svc = new RecommendationsService(
    { getFinancialSummary: async () => null, getRiskProfile: async () => null, getInventoryScience: async () => null } as any,
    { getMenuEngineering: async () => null, getSeasonality: async () => null, getCashflow: async () => null } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals: async () => [] } as any,
    { readDispositions: async () => ({ map: new Map(), readable: true, problem: null }) } as any,
    { supabase: client, getClient: () => client } as any,
    advice,
    locks,
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
  target_margin_band_pct: "2",
  target_margin_set_by: "u",
  target_margin_set_at: "2026-09-21T09:00:00Z",
  default_pour_ml: 150,
  pour_size_confirmed_by: null,
  pour_size_confirmed_at: null,
};
const UNSET = {
  target_margin_bottle_pct: null,
  target_margin_glass_pct: null,
  target_margin_band_pct: null,
  target_margin_set_by: null,
  target_margin_set_at: null,
  default_pour_ml: 150,
  pour_size_confirmed_by: null,
  pour_size_confirmed_at: null,
};

describe("the recommendations feed advises toward the house's target margin (ADR 0193)", () => {
  it("names the wine and the exact price: 'raise to 57.14', with the numbers attached", async () => {
    const out = await feed({ house: SET, inventory: [WINE, NO_COST_WINE], rollup: ROLLUP }).getRecommendations("r-1");
    expect(out.sourcesUnread).not.toContain("price advice");
    const card = out.recommendations.find((r) => r.ruleKey === "margin_to_target");
    expect(card).toBeDefined();
    expect(card!.category).toBe("pricing");
    expect(card!.observation).toMatch(/^1 price sits outside your target margin: 1 below it, 0 above it\. 1 more cannot be judged/);
    expect(card!.recommendation).toMatch(/Barolo: Raise the bottle to 57\.14 \(now 50\.00, 12\.5% below it\)/);
    expect(card!.recommendation).toMatch(/Nothing changes until you do\./);
    expect(card!.priceAdvice).toEqual([
      expect.objectContaining({ inventoryId: "inv-a", kind: "bottle", state: "raise", price: 50, advisedPrice: 57.14, targetPct: 65, gapPct: expect.closeTo(-12.5, 6) }),
    ]);
    expect(out.priceAdviceReadable).toBe(true);
  });

  it("says the cost gap out loud rather than implying those wines are fine", async () => {
    const out = await feed({ house: SET, inventory: [WINE, NO_COST_WINE], rollup: ROLLUP }).getRecommendations("r-1");
    const blind = out.recommendations.find((r) => r.ruleKey === "margin_advice_blind");
    expect(blind?.observation).toMatch(/^1 price cannot be judged against your target margin/);
  });

  it("a glass target with no confirmed pour: one entry asking for the pour, and no glass advice", async () => {
    const out = await feed({
      house: { ...SET, target_margin_glass_pct: "75" },
      inventory: [{ ...WINE, sale_type: "both", menu_price_glass: "10.00" }],
      rollup: ROLLUP,
    }).getRecommendations("r-1");
    const pour = out.recommendations.find((r) => r.ruleKey === "pour_size_unconfirmed");
    expect(pour?.observation).toMatch(/^1 glass price cannot be advised yet: this house has not confirmed the pour it serves\./);
    const card = out.recommendations.find((r) => r.ruleKey === "margin_to_target");
    expect(card!.priceAdvice!.map((p) => p.kind)).toEqual(["bottle"]);
  });

  it("the pour confirmed: no pour entry, and the glass is advised", async () => {
    const out = await feed({
      house: { ...SET, target_margin_glass_pct: "75", pour_size_confirmed_by: "u", pour_size_confirmed_at: "2026-09-21T09:05:00Z" },
      inventory: [{ ...WINE, sale_type: "both", menu_price_glass: "10.00" }],
      rollup: ROLLUP,
    }).getRecommendations("r-1");
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain("pour_size_unconfirmed");
    const card = out.recommendations.find((r) => r.ruleKey === "margin_to_target");
    expect(card!.priceAdvice!.map((p) => p.kind).sort()).toEqual(["bottle", "glass"]);
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
    // And the digest's "could not read" note names it (merge with main's
    // sourcesUnread, 2026-09-21): a missing price source is never silent.
    expect(out.sourcesUnread).toContain("price advice");
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain("margin_to_target");
  });
});

/**
 * ADR 0193 round 3 (L22, L23). The founder, 2026-09-21: "add a section to that
 * where you can lock price". A locked kind is left out of margin_to_target's
 * actions -- it cannot be accepted -- and counted instead under
 * price_locks_to_review when the lock is worth a look. Regrouped, not hidden.
 */
describe("the feed and a locked price (ADR 0193 round 3)", () => {
  const LOCK = {
    id: "lock-1",
    restaurant_id: "r-1",
    inventory_id: "inv-a",
    kind: "bottle",
    locked_price: "50.00",
    locked_by: "u",
    locked_at: "2026-09-01T09:00:00Z",
    released_at: null,
  };

  it("L22: a locked price below target is NOT offered as an action; it is counted under price_locks_to_review", async () => {
    const out = await feed({ house: SET, inventory: [WINE], rollup: ROLLUP, locks: [LOCK] }).getRecommendations("r-1");
    const keys = out.recommendations.map((r) => r.ruleKey);
    expect(keys).not.toContain("margin_to_target");
    const review = out.recommendations.find((r) => r.ruleKey === "price_locks_to_review");
    expect(review).toBeDefined();
    // Off target, and (no current menu in this fake) not on the current menu.
    expect(review!.observation).toMatch(/^1 locked price at this house needs a look: 1 outside your target margin, 1 not on the current menu/);
    expect(review!.recommendation).toMatch(/A lock never ends by itself/);
    expect(out.sourcesUnread).not.toContain("price locks");
  });

  it("L25: a lock list read only in part is said -- never taken for 'nothing to review' (last-call review)", async () => {
    // A lock that fits: on target, its wine on the current menu at its price, set by a current manager.
    const fits = {
      house: SET,
      inventory: [{ ...WINE, master_wine_id: "mw-a", menu_price_current: "57.14" }],
      rollup: ROLLUP,
      locks: [{ ...LOCK, locked_price: "57.14" }],
      menus: [{ id: "m-1", restaurant_id: "r-1", status: "active", name: "Autumn list" }],
      menuItems: [{ id: "mi-1", menu_id: "m-1", restaurant_id: "r-1", wine_library_id: "mw-a", bottle_price: "57.14", by_glass_price: null, status: "approved" }],
      users: [{ user_id: "u", name: "Aylin", role: "manager", restaurant_id: "r-1" }],
      access: [{ user_id: "u", restaurant_id: "r-1", role: "manager", is_active: true }],
    };
    // Control: every fact read, nothing to review, no entry.
    const control = await feed(fits).getRecommendations("r-1");
    expect(control.recommendations.map((r) => r.ruleKey)).not.toContain("price_locks_to_review");
    // The same house with its current menu unreadable: the entry says so.
    const out = await feed({ ...fits, menusError: "statement timeout" }).getRecommendations("r-1");
    const review = out.recommendations.find((r) => r.ruleKey === "price_locks_to_review");
    expect(review).toBeDefined();
    expect(review!.observation).toMatch(/^1 locked price at this house could not be fully checked\. /);
    expect(review!.observation).toMatch(/the current menu could not be read \(statement timeout\)/);
  });

  it("the same wine unlocked is offered as before", async () => {
    const out = await feed({ house: SET, inventory: [WINE], rollup: ROLLUP }).getRecommendations("r-1");
    const keys = out.recommendations.map((r) => r.ruleKey);
    expect(keys).toContain("margin_to_target");
    expect(keys).not.toContain("price_locks_to_review");
  });
});
