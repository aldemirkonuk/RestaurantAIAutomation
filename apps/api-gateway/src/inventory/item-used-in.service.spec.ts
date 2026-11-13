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
  db.tables.recipe_lines = [];
  db.tables.recipe_current = [];
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

  it("a house whose only menu is a draft says it has no current menu, and never reads its lines", async () => {
    const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: null, master_wine_id: null });
    db.tables.restaurant_menus = [{ id: "menu-draft", restaurant_id: H, status: "draft" }];
    db.tables.menu_items = [line("l-draft", "Unx", { menu_id: "menu-draft", inventory_item_id: I })];
    db.failures.menu_items = "a draft menu's lines must not be read";
    const out = await svc.usedIn(H, I);
    for (const group of [out.soldAs, out.namedNotLinked]) {
      expect(group).toMatchObject({ readable: true, lines: [] });
      expect(group.source).toMatch(/has no current menu/);
    }
  });

  it("an item of another house is not found", async () => {
    const { svc } = seed({ kind: "food", display_name: "Un", beverage_id: null, master_wine_id: null });
    await expect(svc.usedIn("house-2", I)).rejects.toMatchObject({ status: 404 });
  });

  describe("in drink recipes (ADR 0360, reverse of the line picker)", () => {
    const rl = (id: string, version: string, more: Record<string, any> = {}) => ({
      id, version_id: version, restaurant_id: H, inventory_id: I, position: 1,
      label: "Rakı", qty_entered: 40, unit_code: "ml", ...more,
    });
    const drinks = (db: FakeDb, n: number) => {
      db.tables.cocktails = Array.from({ length: n }, (_, k) => ({
        id: `c${k}`, restaurant_id: H, name: `Cocktail ${k}`, display_name: null, deleted_at: null,
      }));
    };

    it("(a) lists current-version lines of house cocktails only", async () => {
      const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: null, master_wine_id: null });
      db.tables.cocktails = [
        { id: "c-sour", restaurant_id: H, name: "sour", display_name: "Unx Sour", deleted_at: null },
        { id: "c-gone", restaurant_id: H, name: "Gone", display_name: null, deleted_at: "2027-01-01" },
        { id: "c-other", restaurant_id: "house-2", name: "Other", display_name: null, deleted_at: null },
      ];
      db.tables.recipe_current = [
        { restaurant_id: H, cocktail_id: "c-sour", version_id: "v-new" },
        { restaurant_id: H, cocktail_id: "c-gone", version_id: "v-gone" },
        { restaurant_id: "house-2", cocktail_id: "c-other", version_id: "v-other" },
      ];
      db.tables.recipe_lines = [
        rl("l1", "v-new", { label: "Unx 40", qty_entered: "40", unit_code: "ml" }),
        rl("l2", "v-old"),
        rl("l3", "v-gone"),
        rl("l4", "v-other", { restaurant_id: "house-2" }),
        rl("l5", "v-new", { inventory_id: "item-2" }),
      ];
      const out = await svc.usedIn(H, I);
      expect(out.inDrinkRecipes).toEqual({
        readable: true,
        source: "Drinks whose current recipe has a line linked to this item.",
        lines: [{ cocktailId: "c-sour", name: "Unx Sour", label: "Unx 40", qtyEntered: 40, unitCode: "ml" }],
      });
    });

    it("(b) a failed recipe_lines read is unreadable, never []", async () => {
      const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: null, master_wine_id: null });
      db.failures.recipe_lines = "relation recipe_lines does not exist";
      const out = await svc.usedIn(H, I);
      expect(out.inDrinkRecipes).toMatchObject({ readable: false, lines: null });
      expect(out.inDrinkRecipes.source).toContain("could not be read");
    });

    it("(b) a failed recipe_current read is unreadable, never []", async () => {
      const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: null, master_wine_id: null });
      db.tables.recipe_lines = [rl("l1", "v1")];
      db.failures.recipe_current = "boom";
      const out = await svc.usedIn(H, I);
      expect(out.inDrinkRecipes).toMatchObject({ readable: false, lines: null });
    });

    it("(c) 1,001 lines across 1,001 current cocktails all come back (paging and chunking)", async () => {
      const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: null, master_wine_id: null });
      drinks(db, 1001);
      db.tables.recipe_current = Array.from({ length: 1001 }, (_, k) => ({
        restaurant_id: H, cocktail_id: `c${k}`, version_id: `v${k}`,
      }));
      db.tables.recipe_lines = Array.from({ length: 1001 }, (_, k) => rl(`l${String(k).padStart(5, "0")}`, `v${k}`));
      const out = await svc.usedIn(H, I);
      expect(out.inDrinkRecipes.lines).toHaveLength(1001);
    });

    it("(d) says nothing about dish recipes: those are read from the dish route (ADR 0366)", async () => {
      const { svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: null, master_wine_id: null });
      const out = await svc.usedIn(H, I);
      // The old "Dish recipes are not recorded yet" note was false once dishes kept recipes.
      expect(out).not.toHaveProperty("recipes");
      expect(JSON.stringify(out)).not.toMatch(/not recorded yet/);
    });
  });
});

describe("ItemUsedInService reads its groups at once (the drawer waits for the slowest, not the sum)", () => {
  it("starts the drink reads while the menu read is still out, and still answers every group", async () => {
    const { db, svc } = seed({ kind: "spirit", display_name: "Unx", beverage_id: "bev-1", master_wine_id: null });
    db.tables.menu_items = [line("l-linked", "Unx (kadeh)", { inventory_item_id: I })];
    const started: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const real = db.from.bind(db);
    (db as any).from = (t: string) => {
      started.push(t);
      const q: any = real(t);
      if (t === "restaurant_menus") {
        const then = q.then.bind(q);
        q.then = (ok: any, no: any) => gate.then(() => then(ok, no));
      }
      return q;
    };
    const pending = svc.usedIn(H, I);
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    // The menu read is held; the cocktail card and recipe reads have already gone out.
    expect(started).toContain("restaurant_menus");
    expect(started).toContain("cocktail_ingredients");
    expect(started).toContain("recipe_lines");
    expect(started).not.toContain("menu_items");
    open();
    const out = await pending;
    expect(out.soldAs.lines!.map((l) => l.menuItemId)).toEqual(["l-linked"]);
    expect(out.inDrinkRecipes).toMatchObject({ readable: true, lines: [] });
  });
});
