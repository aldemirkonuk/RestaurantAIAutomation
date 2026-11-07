import { FakeDb } from "../notifications/producers/testing/fake-db";
import { ItemUsedInService } from "./item-used-in.service";

const H = "house-1";
const I = "item-1";

function seed(item: Record<string, any>) {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [{ id: I, restaurant_id: H, wine_name: null, ...item }];
  db.tables.restaurant_menus = [
    { id: "menu-now", restaurant_id: H, status: "active" },
    { id: "menu-old", restaurant_id: H, status: "archived" },
  ];
  db.tables.menu_items = [];
  db.tables.cocktail_ingredients = [];
  db.tables.cocktails = [];
  const svc = new ItemUsedInService({ supabase: db } as any);
  return { db, svc };
}

const line = (id: string, name: string, more: Record<string, any> = {}) => ({
  id,
  menu_id: "menu-now",
  restaurant_id: H,
  name,
  by_glass_price: 90,
  bottle_price: null,
  inventory_item_id: null,
  wine_library_id: null,
  status: "approved",
  ...more,
});

describe("ItemUsedInService (proposal I4/I11)", () => {
  it("(a) lists the linked menu line and the house cocktail; a same-named unlinked line is only in namedNotLinked", async () => {
    const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: "bev-1", master_wine_id: null });
    db.tables.menu_items = [
      line("l-linked", "Unx (kadeh)", { inventory_item_id: I }),
      line("l-same-name", "ÜNX"),
      line("l-wildcard", "Un_"),
      line("l-archived", "Unx", { menu_id: "menu-old", inventory_item_id: I }),
    ];
    db.tables.cocktail_ingredients = [
      { cocktail_id: "c-house", beverage_id: "bev-1", quantity: 50, unit: "ml" },
      { cocktail_id: "c-catalogue", beverage_id: "bev-1", quantity: 40, unit: "ml" },
    ];
    db.tables.cocktails = [
      { id: "c-house", restaurant_id: H, name: "Unx Sour", deleted_at: null },
      { id: "c-catalogue", restaurant_id: null, name: "Catalogue Sour", deleted_at: null },
    ];

    const out = await svc.usedIn(H, I);

    expect(out.item).toEqual({ id: I, kind: "spirit", displayName: "Unx" });
    expect(out.soldAs).toMatchObject({ readable: true });
    expect(out.soldAs.lines).toEqual([
      expect.objectContaining({ menuItemId: "l-linked", linkedBy: "inventory_item_id", byGlassPrice: 90 }),
    ]);
    expect(out.inCocktails.lines).toEqual([{ cocktailId: "c-house", name: "Unx Sour", quantity: 50, unit: "ml" }]);
    expect(out.namedNotLinked.lines!.map((l) => l.menuItemId)).toEqual(["l-same-name"]);
    expect(out.recipes.recorded).toBe(false);
  });

  it("(a) a wine is sold by its library link, and that line is not repeated as named-not-linked", async () => {
    const { db, svc } = seed({ kind: "wine", display_name: "Kavaklıdere", master_wine_id: "w-1", beverage_id: null });
    db.tables.menu_items = [
      line("l-lib", "Kavaklidere", { wine_library_id: "w-1" }),
      line("l-other-item", "Kavaklıdere", { wine_library_id: "w-1", inventory_item_id: "item-2" }),
    ];
    const out = await svc.usedIn(H, I);
    expect(out.soldAs.lines).toEqual([expect.objectContaining({ menuItemId: "l-lib", linkedBy: "wine_library_id" })]);
    expect(out.namedNotLinked.lines).toEqual([]);
  });

  it("(b) a failed menu read is null and unreadable, never []; the cocktail group still answers", async () => {
    const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: "bev-1", master_wine_id: null });
    db.failures.menu_items = "connection reset";
    const out = await svc.usedIn(H, I);
    expect(out.soldAs.readable).toBe(false);
    expect(out.soldAs.lines).toBeNull();
    expect(out.soldAs.source).toContain("could not be read");
    expect(out.namedNotLinked.lines).toBeNull();
    expect(out.inCocktails).toMatchObject({ readable: true, lines: [] });
  });

  it("an item of another house is not found", async () => {
    const { svc } = seed({ kind: "food", display_name: "Un", beverage_id: null, master_wine_id: null });
    await expect(svc.usedIn("house-2", I)).rejects.toMatchObject({ status: 404 });
  });
});
