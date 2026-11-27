import { NotFoundException } from "@nestjs/common";
import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { recipeCost } from "./recipe-cost";
import { servesFromStock, type StockItem } from "./serves-from-stock";
import { B_FLOUR, FLOUR, HOUSE_A, HOUSE_B, V_TART_2, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

/**
 * How many serves the stock on hand makes (r108 inventory g11): the drawer's
 * Used in says it beside each dish and drink. A quantity, not money, so every
 * role reads it; unknown is null with the reason, never 0.
 */

const bottle = (over: Partial<StockItem> = {}): StockItem =>
  ({ id: "g", uom: "bottle", bottle_size_ml: 750, stock_live: 3, ...over }) as StockItem;
const pour = (ml: number) => ({ qtyBase: ml * 10, baseUnit: "ml10" as const });

describe("serves from stock: the pure count", () => {
  it("three 750 ml bottles with a 30 ml serve make 75", () => {
    expect(servesFromStock(bottle(), [pour(30)], 1)).toEqual({ servesFromStock: 75, servesWhy: null });
  });

  it("divides by the yield: a batch of 10 that takes 300 ml makes 75 serves of 3 bottles", () => {
    expect(servesFromStock(bottle(), [pour(300)], 10)).toEqual({ servesFromStock: 75, servesWhy: null });
  });

  it("adds two lines of the good, and floors to whole serves", () => {
    // 2,250 ml / (30 + 20 ml) = 45; a serve a hair over 2,250 / 46 ml makes 45.9, which stays 45.
    expect(servesFromStock(bottle(), [pour(30), pour(20)], 1).servesFromStock).toBe(45);
    expect(servesFromStock(bottle({ stock_live: 3 }), [pour(2251 / 46)], 1).servesFromStock).toBe(45);
  });

  it("grosses a line up to what is bought, as its cost does (45 % usable)", () => {
    // 1 kg on hand; 180 g on the plate is 400 g bought: 2 plates.
    const flour = { id: "f", uom: "kg", stock_live: 1 } as StockItem;
    expect(servesFromStock(flour, [{ qtyBase: 180_000, baseUnit: "mg", usablePct: 45 }], 1).servesFromStock).toBe(2);
  });

  it("a case says its pack size is not known, never 0", () => {
    expect(servesFromStock(bottle({ uom: "case" }), [pour(30)], 1)).toEqual({ servesFromStock: null, servesWhy: "pack_size_not_known" });
  });

  it("a bottle of no recorded size says so", () => {
    expect(servesFromStock(bottle({ bottle_size_ml: null }), [pour(30)], 1)).toEqual({ servesFromStock: null, servesWhy: "size_not_known" });
  });

  it("a piece against a weighed good with no stated weight is a unit mismatch; a stated weight bridges it", () => {
    const lemons = { id: "l", uom: "kg", stock_live: 2 } as StockItem;
    const twoLemons = [{ qtyBase: 2000, baseUnit: "each_milli" as const }];
    expect(servesFromStock(lemons, twoLemons, 1)).toEqual({ servesFromStock: null, servesWhy: "unit_mismatch" });
    // 2 kg of 100 g lemons is 20 lemons: 10 serves of two.
    expect(servesFromStock({ ...lemons, piece_grams: 100 }, twoLemons, 1).servesFromStock).toBe(10);
  });

  it("a yield of 0 is no_yield", () => {
    expect(servesFromStock(bottle(), [pour(30)], 0)).toEqual({ servesFromStock: null, servesWhy: "no_yield" });
  });

  it("stock below zero makes 0 serves, with no reason", () => {
    expect(servesFromStock(bottle({ stock_live: -2 }), [pour(30)], 1)).toEqual({ servesFromStock: 0, servesWhy: null });
  });

  it("a stock that was not read says so", () => {
    expect(servesFromStock(bottle({ stock_live: null }), [pour(30)], 1)).toEqual({ servesFromStock: null, servesWhy: "stock_unread" });
    expect(servesFromStock(null, [pour(30)], 1).servesWhy).toBe("stock_unread");
  });

  it("the factors are the ones a line's cost divides by: a 30 ml pour of a 750 ml bottle costs 1/25 of it", () => {
    const item = { ...bottle(), last_purchase_price: 25, is_active: true, deleted_at: null } as any;
    const cost = recipeCost([{ role: "stocked", inventoryId: "g", qtyBase: 300, baseUnit: "ml10", item, lot: null }], 1);
    expect(cost.perServeExact).toBe(1);
  });
});

describe("serves from stock: a 0 that nobody counted", () => {
  it("never counted and no lot is unknown, not 'not enough'; counted empty, or a lot once received, is still 0", () => {
    const g = (over: Record<string, unknown>) => bottle({ stock_live: 0, ...over });
    expect(servesFromStock(g({ last_counted_at: null, has_lots: false }), [pour(30)], 1)).toEqual({ servesFromStock: null, servesWhy: "never_counted" });
    expect(servesFromStock(g({ last_counted_at: "2026-11-01T10:00:00Z", has_lots: false }), [pour(30)], 1)).toEqual({ servesFromStock: 0, servesWhy: null });
    expect(servesFromStock(g({ last_counted_at: null, has_lots: true }), [pour(30)], 1)).toEqual({ servesFromStock: 0, servesWhy: null });
  });
});

describe("serves from stock: through the service", () => {
  // Flour is kept in kg; the tart's current version takes 250 g + 50 g for a batch of 8.
  const rows = (stock: unknown): Record<string, Row[]> => {
    const r = twoHouses();
    r.restaurant_inventory = r.restaurant_inventory.map((i) => (i.id === FLOUR ? { ...i, stock_live: stock } : i));
    return r;
  };
  const svc = (r: Record<string, Row[]>) => {
    const fake = fakeDb(r);
    return new DishesService(fake.db, new RecipesService(fake.db));
  };

  it("a dish says how many plates the flour on hand makes, for staff too", async () => {
    // 3 kg / (300 g / 8) = 80 plates.
    for (const role of ["owner", "staff"]) {
      const out = await svc(rows(3)).dishesUsingItem(HOUSE_A, FLOUR, role);
      expect(out.dishes[0]).toMatchObject({ name: "Lemon tart", servesFromStock: 80, servesWhy: null });
    }
  });

  it("a flour never counted and never received says never counted, not 'not enough'", async () => {
    const r = rows(0);
    r.restaurant_inventory = r.restaurant_inventory.map((i) => (i.id === FLOUR ? { ...i, last_counted_at: null } : i));
    const out = await svc(r).dishesUsingItem(HOUSE_A, FLOUR, "owner");
    expect(out.dishes[0]).toMatchObject({ servesFromStock: null, servesWhy: "never_counted" });
    // Once counted (even to 0) or received, a 0 is the shelf.
    const counted = rows(0);
    counted.restaurant_inventory = counted.restaurant_inventory.map((i) => (i.id === FLOUR ? { ...i, last_counted_at: "2026-11-01T10:00:00Z" } : i));
    expect((await svc(counted).dishesUsingItem(HOUSE_A, FLOUR, "owner")).dishes[0]).toMatchObject({ servesFromStock: 0 });
    const received = rows(0);
    received.restaurant_inventory = received.restaurant_inventory.map((i) => (i.id === FLOUR ? { ...i, last_counted_at: null } : i));
    received.inventory_lots = [{ id: "lot1", restaurant_id: HOUSE_A, inventory_id: FLOUR }];
    expect((await svc(received).dishesUsingItem(HOUSE_A, FLOUR, "owner")).dishes[0]).toMatchObject({ servesFromStock: 0 });
  });

  it("another house's item is not read: a 404, never its stock", async () => {
    const r = rows(3);
    r.restaurant_inventory.push({ id: "f0000000-0000-4000-8000-0000000000b7", restaurant_id: HOUSE_B, uom: "kg", stock_live: 999 });
    await expect(svc(r).dishesUsingItem(HOUSE_A, B_FLOUR, "owner")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc(r).dishesUsingItem(HOUSE_A, "f0000000-0000-4000-8000-0000000000b7", "owner")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("only the current version's lines count, never an old version's", async () => {
    const r = rows(3);
    // The old version's 999 g line would make 3 plates if it were read.
    expect(r.recipe_lines.some((l) => l.version_id !== V_TART_2 && l.inventory_id === FLOUR)).toBe(true);
    const out = await svc(r).dishesUsingItem(HOUSE_A, FLOUR, "owner");
    expect(out.dishes[0].servesFromStock).toBe(80);
  });

  it("a drink says it too, from its own yield", async () => {
    const GIN = "f0000000-0000-4000-8000-0000000000c1";
    const GT = "c0000000-0000-4000-8000-0000000000a1";
    const V = "e0000000-0000-4000-8000-0000000000c2";
    const r: Record<string, Row[]> = {
      ...twoHouses(),
      cocktails: [{ id: GT, restaurant_id: HOUSE_A, name: "G&T", display_name: null, menu_section: null, price: 12, deleted_at: null }],
      recipe_current: [{ cocktail_id: GT, version_id: V, restaurant_id: HOUSE_A }],
      recipe_versions: [{ id: V, restaurant_id: HOUSE_A, cocktail_id: GT, yield_serves: 1 }],
      recipe_lines: [line("g1", V, HOUSE_A, 1, "Gin", GIN, { qty_entered: 50, unit_code: "ml", qty_base: 500, base_unit: "ml10" })],
      restaurant_inventory: [{ id: GIN, restaurant_id: HOUSE_A, uom: "bottle", bottle_size_ml: 700, stock_live: 2, is_active: true, deleted_at: null }],
    };
    const out = await svc(r).drinksUsingItem(HOUSE_A, GIN, "staff");
    expect(out.drinks[0]).toMatchObject({ name: "G&T", servesFromStock: 28, servesWhy: null });
  });
});
