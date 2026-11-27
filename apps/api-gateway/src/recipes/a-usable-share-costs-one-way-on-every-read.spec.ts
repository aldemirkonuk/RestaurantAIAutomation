/**
 * r110 drinks-7 (closes the #2368 loop): a line's usable share is costed one
 * way on every read. Gimlet: 50 ml gin (0.50) and 25 ml lime juice, which is
 * 0.10 at its whole amount. At a 45 % usable share the lime is bought over
 * (25 / 0.45 ml), 0.10 / 0.45 = 0.2222, so the serve moves from 0.60 to 0.7222.
 * The sheet (what a /dishes recipe view and the drawer's card both read), the
 * drinks list's figures, the drawer's used-in card and a copied drink must say
 * the same cost before and after a save changes the share.
 *
 * It also pins (DD-r108-80, against #2119, until #922 puts item_nutrition and
 * item_allergens in the chain) that a database without those tables says the
 * serve "could not be read" and still costs the share.
 */
import { DishesService } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { HOUSE_A, fakeDb, twoHouses, line, type Row } from "./dishes.testing";

const GIN = "f0000000-0000-4000-8000-0000000000d1";
const LIME = "f0000000-0000-4000-8000-0000000000d2";
const GIMLET = "c0000000-0000-4000-8000-0000000000d1";
const V = "e0000000-0000-4000-8000-0000000000d1";

function gimlet(share: number | string | null): Record<string, Row[]> {
  const rows = twoHouses();
  rows.restaurant_inventory.push(
    { id: GIN, restaurant_id: HOUSE_A, display_name: "Gin", kind: "spirit", uom: "bottle", bottle_size_ml: 700, last_purchase_price: 7, is_active: true, deleted_at: null },
    { id: LIME, restaurant_id: HOUSE_A, display_name: "Lime juice", kind: "mixer", uom: "bottle", bottle_size_ml: 1000, last_purchase_price: 4, is_active: true, deleted_at: null },
  );
  rows.cocktails = [{ id: GIMLET, restaurant_id: HOUSE_A, name: "Gimlet", display_name: null, menu_section: null, price: 12, deleted_at: null }];
  rows.recipe_current = [{ cocktail_id: GIMLET, version_id: V, restaurant_id: HOUSE_A }];
  rows.recipe_versions.push({ id: V, restaurant_id: HOUSE_A, cocktail_id: GIMLET, owner_kind: "cocktail", version: 1, yield_serves: 1, created_at: "2026-11-02" });
  rows.recipe_lines.push(
    line("d1", V, HOUSE_A, 1, "Gin", GIN, { qty_entered: 50, unit_code: "ml", qty_base: 500, base_unit: "ml10", usable_pct: null }),
    line("d2", V, HOUSE_A, 2, "Lime juice", LIME, { qty_entered: 25, unit_code: "ml", qty_base: 250, base_unit: "ml10", usable_pct: share }),
  );
  rows.cocktail_ingredients = [];
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

/** The same drink read every way the page and the drawer read it. */
async function reads(rows: Record<string, Row[]>, role = "owner") {
  const { db } = fakeDb(rows);
  const dishes = new DishesService(db, new RecipesService(db));
  const sheet = (await new RecipesService(db).getRecipe(HOUSE_A, GIMLET, role)) as any;
  const list = (await dishes.drinkFigures(HOUSE_A, role)).drinks.find((d) => d.cocktailId === GIMLET)!;
  const used = (await dishes.drinksUsingItem(HOUSE_A, LIME, role)).drinks.find((d) => d.cocktailId === GIMLET)!;
  return { sheet, list, used };
}

describe("a usable share is costed one way on the sheet, the list and the drawer", () => {
  it("no share: the lime is 0.10 and the serve 0.60 on all three", async () => {
    const { sheet, list, used } = await reads(gimlet(null));
    expect(sheet.current.lines[1]).toMatchObject({ usablePct: null, costPerServe: 0.1 });
    for (const c of [sheet.cost, list.cost, (used as any).cost]) expect(c).toMatchObject({ perServeExact: 0.6, complete: true });
  });

  it("a 45 % lime is 0.22 and the serve 0.7222 on all three, and the sheet says the share", async () => {
    const { sheet, list, used } = await reads(gimlet(45));
    expect(sheet.current.lines[1]).toMatchObject({ usablePct: 45, costPerServe: 0.22 });
    expect(sheet.cost.perServeExact).toBeCloseTo(0.5 + 0.1 / 0.45, 6);
    for (const c of [list.cost, (used as any).cost]) {
      expect(c).toMatchObject({ perServe: sheet.cost.perServe, priced: 2, of: 2, complete: true });
      expect(c!.perServeExact).toBeCloseTo(sheet.cost.perServeExact, 9);
    }
    expect(sheet.cost.perServe).toBe(0.72);
  });

  it("a save that sets the share moves all three together, from 0.60 to 0.72", async () => {
    const rows = gimlet(null);
    const before = await reads(rows);
    for (const l of rows.recipe_lines) if (l.id === "d2") l.usable_pct = "45.00"; // the database's text form
    const after = await reads(rows);
    expect([before.sheet.cost.perServe, before.list.cost!.perServe, (before.used as any).cost.perServe]).toEqual([0.6, 0.6, 0.6]);
    expect([after.sheet.cost.perServe, after.list.cost!.perServe, (after.used as any).cost.perServe]).toEqual([0.72, 0.72, 0.72]);
  });

  it("an unreadable share leaves the serve unpriced on all three, never the whole-amount cost", async () => {
    const { sheet, list, used } = await reads(gimlet(0.5));
    for (const c of [sheet.cost, list.cost, (used as any).cost]) expect(c).toMatchObject({ perServe: null, complete: false });
  });

  it("staff see no cost on any of them", async () => {
    const { sheet, list } = await reads(gimlet(45), "staff");
    expect(sheet.cost).toBeNull();
    expect(list.cost).toBeNull();
  });
});

describe("a database built without the nutrition tables (#2119, until #922)", () => {
  const MISSING = { code: "42P01", message: 'relation "public.item_nutrition" does not exist' };

  it("says the serve could not be read, shows no figure, and still costs the 45 % share", async () => {
    const { db } = fakeDb(gimlet(45));
    const client = db.getClient() as any;
    const from = client.from.bind(client);
    client.from = (table: string) => {
      if (table !== "item_nutrition" && table !== "item_allergens") return from(table);
      const dead: any = { select: () => dead, eq: () => dead, in: () => dead, then: (ok: (v: unknown) => unknown) => ok({ data: null, error: MISSING }) };
      return dead;
    };
    const out = (await new RecipesService(db).getRecipe(HOUSE_A, GIMLET, "owner")) as any;
    expect(out.whatIsIn).toMatchObject({ readable: false });
    expect(String(out.whatIsIn.sentence)).toMatch(/could not be read/i);
    expect(out.whatIsIn).not.toHaveProperty("energyKcal");
    expect(out.cost.perServe).toBe(0.72);
  });
});
