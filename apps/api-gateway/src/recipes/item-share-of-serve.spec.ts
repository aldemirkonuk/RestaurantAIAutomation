import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { itemShareOfServe } from "./item-share-of-serve";
import { FLOUR, HOUSE_A, V_TART_2, fakeDb, twoHouses, type Row } from "./dishes.testing";

/**
 * This good's share of a serve's cost (r108 inventory g17), sent to owners
 * and managers only. Through the real services over the fake that filters by
 * house; the rule itself on the pure helper.
 */

const G = "good";
describe("item share of serve: the rule", () => {
  it("divides the unrounded figures first and rounds once", () => {
    // 0.004 and 0.006 each round to a cent of 0.00 and 0.01; the share is 40 %, not 0 %.
    expect(itemShareOfServe([{ inventoryId: G, exact: 0.004 }, { inventoryId: "x", exact: 0.006 }], G)).toMatchObject({ pct: 40, ofPricedPart: false });
  });

  it("adds every line of the good", () => {
    const r = itemShareOfServe([{ inventoryId: G, exact: 1 }, { inventoryId: "x", exact: 2 }, { inventoryId: G, exact: 1 }], G);
    expect(r).toMatchObject({ pct: 50, costPerServe: 2, priced: 3, of: 3 });
  });

  it("an incomplete serve is a share of the priced part, and says how many lines", () => {
    const r = itemShareOfServe([{ inventoryId: G, exact: 1 }, { inventoryId: "x", exact: 1 }, { inventoryId: "y", exact: null }], G);
    expect(r).toEqual({ costPerServe: 1, pct: 50, ofPricedPart: true, priced: 2, of: 3, unpriced: false });
  });

  it("an unpriced line of this good is Not priced, never 0 %", () => {
    const r = itemShareOfServe([{ inventoryId: G, exact: null }, { inventoryId: "x", exact: 3 }], G);
    expect(r).toMatchObject({ pct: null, costPerServe: null, unpriced: true });
  });

  it("a serve that costs nothing has no share, and a recipe without the good has none", () => {
    expect(itemShareOfServe([{ inventoryId: G, exact: 0 }], G)?.pct).toBeNull();
    expect(itemShareOfServe([{ inventoryId: "x", exact: 1 }], G)).toBeNull();
  });
});

describe("item share of serve: through the service", () => {
  const SUGAR = "f0000000-0000-4000-8000-0000000000a7";
  const svc = (rows: Record<string, Row[]>) => {
    const fake = fakeDb(rows);
    return new DishesService(fake.db, new RecipesService(fake.db));
  };

  it("staff are sent null, and no line cost anywhere", async () => {
    const out = await svc(twoHouses()).dishesUsingItem(HOUSE_A, FLOUR, "staff");
    expect(out.dishes[0].goodShare).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/pricedLines|costPerServe/);
  });

  it("an owner reads the share of the priced part when a line is not linked", async () => {
    // The tart's lemons are not linked: 2 of 3 lines priced, both of them flour.
    const out = await svc(twoHouses()).dishesUsingItem(HOUSE_A, FLOUR, "manager");
    expect(out.dishes[0].goodShare).toEqual({ costPerServe: 0.075, pct: 100, ofPricedPart: true, priced: 2, of: 3, unpriced: false });
  });

  it("a complete serve: flour 300 g at 2/kg against sugar 3 each, over 8", async () => {
    const rows = twoHouses();
    rows.restaurant_inventory.push({ id: SUGAR, restaurant_id: HOUSE_A, display_name: "Lemon", kind: "food", uom: "each", bottle_size_ml: null, last_purchase_price: 0.3, is_active: true, deleted_at: null });
    rows.recipe_lines = rows.recipe_lines.map((l) => (l.version_id === V_TART_2 && l.label === "Lemons" ? { ...l, inventory_id: SUGAR } : l));
    const out = await svc(rows).dishesUsingItem(HOUSE_A, FLOUR, "owner");
    // Flour 0.6 / 8 = 0.075; lemons 3 x 0.3 / 8 = 0.1125; 0.075 / 0.1875 = 40 %.
    expect(out.dishes[0].goodShare).toMatchObject({ pct: 40, ofPricedPart: false, priced: 3, of: 3 });
  });
});
