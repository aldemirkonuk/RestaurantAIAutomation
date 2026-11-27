import { planLineMargin, landsBelowTarget, type MarginInputs } from "./plan-margin";
import type { InventoryPriceRow } from "../pricing/margin-advice.service";

/**
 * r109 menu-g4: the plan's margin is /inventory's advice rule, on the same
 * inputs, at two prices. Cost 20, house 50, this menu 60, target 65 %:
 * 60.0 % now, 66.7 % at this menu.
 */

const row = (over: Partial<InventoryPriceRow> = {}): InventoryPriceRow => ({
  id: "inv-1",
  wine_name: "Chianti",
  sale_type: "both",
  menu_price_current: 50,
  menu_price_glass: 12,
  last_purchase_price: 20,
  bottle_size_ml: 750,
  master_wine_library: null,
  ...over,
});
const inputs = (over: Partial<MarginInputs["terms"]> = {}, r: InventoryPriceRow = row()): MarginInputs => ({
  terms: { bottlePct: 65, glassPct: 70, bandPct: 2, pourMl: 150, ...over },
  rows: new Map([[r.id, r]]),
  lots: new Map(),
});
const prices = { houseBottle: 50, houseGlass: 12, menuBottle: 60, menuGlass: 14 };

describe("planLineMargin", () => {
  it("cost 20, house 50, menu 60, target 65: 60.0% now and 66.7% at this menu", () => {
    const m = planLineMargin(inputs(), "inv-1", prices).bottle!;
    expect(m.targetPct).toBe(65);
    expect(m.atHouseNow.marginPct).toBeCloseTo(60.0, 5);
    expect(m.atHouseNow.state).toBe("raise");
    expect(m.atThisMenu.marginPct).toBeCloseTo(66.667, 2);
    // 60 is 5 % above the 57.14 target price: outside a 2 % band ("lower"), inside a 6 % one.
    expect(m.atThisMenu.state).toBe("lower");
    expect(planLineMargin(inputs({ bandPct: 6 }), "inv-1", prices).bottle!.atThisMenu.state).toBe("on_target");
    expect(landsBelowTarget(m)).toBe(false);
  });

  it("each price is advised on its own: the menu price is not used for the house's", () => {
    const m = planLineMargin(inputs(), "inv-1", { ...prices, menuBottle: 40 }).bottle!;
    expect(m.atHouseNow.marginPct).toBeCloseTo(60.0, 5);
    expect(m.atThisMenu.marginPct).toBeCloseTo(50.0, 5);
    expect(landsBelowTarget(m)).toBe(true);
  });

  it("a glass is costed by the confirmed pour (20 x 150/750 = 4); with no pour confirmed it is pour_unconfirmed, no margin", () => {
    const g = planLineMargin(inputs(), "inv-1", prices).glass!;
    expect(g.atHouseNow.marginPct).toBeCloseTo(((12 - 4) / 12) * 100, 5);
    const none = planLineMargin(inputs({ pourMl: null }), "inv-1", prices).glass!;
    expect(none.atHouseNow).toEqual({ marginPct: null, state: "pour_unconfirmed" });
    expect(none.atThisMenu).toEqual({ marginPct: null, state: "pour_unconfirmed" });
  });

  it("no recorded cost is no_cost, never a margin", () => {
    const m = planLineMargin(inputs({}, row({ last_purchase_price: null })), "inv-1", prices).bottle!;
    expect(m.atHouseNow).toEqual({ marginPct: null, state: "no_cost" });
    expect(m.atThisMenu).toEqual({ marginPct: null, state: "no_cost" });
  });

  it("no target set is no_target; a blank menu price is no_price", () => {
    const m = planLineMargin(inputs({ bottlePct: null }), "inv-1", { ...prices, menuBottle: null }).bottle!;
    expect(m.atHouseNow.state).toBe("no_target");
    expect(m.targetPct).toBeNull();
    const blank = planLineMargin(inputs(), "inv-1", { ...prices, menuBottle: null }).bottle!;
    expect(blank.atThisMenu.state).toBe("no_price");
  });

  it("a wine the house has no row for (new, not linked) has no margin", () => {
    expect(planLineMargin(inputs(), null, prices)).toEqual({ bottle: null, glass: null });
    expect(planLineMargin(inputs(), "inv-x", prices)).toEqual({ bottle: null, glass: null });
  });
});
