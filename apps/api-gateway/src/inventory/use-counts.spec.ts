import { FakeDb } from "../notifications/producers/testing/fake-db";
import { ItemUseCountsService, USE_COUNTS_UNREAD } from "./item-use-counts.service";
import { ItemUsedInService } from "./item-used-in.service";

const A = "house-a";
const B = "house-b";

function seed() {
  const db = new FakeDb();
  db.tables.recipe_lines = [
    // gin: two lines of one live drink, one line of a live dish, one line of an old version, one of a deleted drink
    { id: "l1", restaurant_id: A, version_id: "v-sour", inventory_id: "gin" },
    { id: "l2", restaurant_id: A, version_id: "v-sour", inventory_id: "gin" },
    { id: "l3", restaurant_id: A, version_id: "v-plate", inventory_id: "gin" },
    { id: "l4", restaurant_id: A, version_id: "v-sour-old", inventory_id: "gin" },
    { id: "l5", restaurant_id: A, version_id: "v-gone", inventory_id: "gin" },
    // lime: only in a deleted (archived) drink
    { id: "l6", restaurant_id: A, version_id: "v-gone", inventory_id: "lime" },
    // an untracked line carries no good
    { id: "l7", restaurant_id: A, version_id: "v-sour", inventory_id: null },
    // house B's line on house B's drink: never counted for house A
    { id: "l8", restaurant_id: B, version_id: "v-b", inventory_id: "gin" },
    { id: "l9", restaurant_id: B, version_id: "v-b", inventory_id: "vodka" },
  ];
  db.tables.recipe_current = [
    { cocktail_id: "c-sour", version_id: "v-sour", restaurant_id: A },
    { cocktail_id: "c-gone", version_id: "v-gone", restaurant_id: A },
    { cocktail_id: "c-b", version_id: "v-b", restaurant_id: B },
  ];
  db.tables.recipe_current_dish = [{ dish_id: "d-plate", version_id: "v-plate", restaurant_id: A }];
  db.tables.cocktails = [
    { id: "c-sour", restaurant_id: A, deleted_at: null },
    { id: "c-old", restaurant_id: A, deleted_at: null }, // live, no current version yet: its old rows still count
    { id: "c-gone", restaurant_id: A, deleted_at: "2026-11-01T00:00:00Z" },
    { id: "c-b", restaurant_id: B, deleted_at: null },
  ];
  db.tables.dishes = [{ id: "d-plate", restaurant_id: A, deleted_at: null }];
  // Legacy: Campari is used only by an older cocktail_ingredients row of a live house drink.
  db.tables.restaurant_inventory = [
    { id: "campari", restaurant_id: A, beverage_id: "bev-campari", master_wine_id: null },
    { id: "gin", restaurant_id: A, beverage_id: "bev-gin", master_wine_id: null },
    { id: "b-campari", restaurant_id: B, beverage_id: "bev-campari", master_wine_id: null },
  ];
  db.tables.cocktail_ingredients = [
    { id: "i1", cocktail_id: "c-old", beverage_id: "bev-campari", wine_id: null },
    { id: "i2", cocktail_id: "c-sour", beverage_id: "bev-gin", wine_id: null }, // also a current line: counts once
    { id: "i3", cocktail_id: "c-gone", beverage_id: "bev-campari", wine_id: null }, // deleted drink
    { id: "i4", cocktail_id: "c-b", beverage_id: "bev-campari", wine_id: null }, // another house
  ];
  return { db, svc: new ItemUseCountsService({ supabase: db } as any) };
}

describe("ItemUseCountsService (r105 g5)", () => {
  it("counts each current recipe once, and leaves out old versions and deleted drinks", async () => {
    const { svc } = seed();
    expect(await svc.counts(A)).toEqual({ counts: { gin: 2, campari: 1 } });
  });

  it("a legacy row of a cocktail that has a current version is superseded, not counted (recipe sheet rule)", async () => {
    const { db, svc } = seed();
    // The Negroni (c-sour) was rebuilt in the versioned editor; its old row naming Campari is history.
    db.tables.cocktail_ingredients.push({ id: "i9", cocktail_id: "c-sour", beverage_id: "bev-campari", wine_id: null });
    // c-old keeps its only Campari row (no version): Campari still counts exactly once.
    expect((await svc.counts(A)).counts.campari).toBe(1);
    db.tables.recipe_current.push({ cocktail_id: "c-old", version_id: "v-old-new", restaurant_id: A });
    expect((await svc.counts(A)).counts.campari).toBeUndefined();
  });

  it("never counts another house's lines", async () => {
    const { svc } = seed();
    const a = await svc.counts(A);
    const b = await svc.counts(B);
    expect(a.counts.vodka).toBeUndefined();
    expect(b.counts).toEqual({ gin: 1, vodka: 1 }); // c-b has a current version: its old Campari row is superseded
  });

  it("a failed read is unread, never an empty map that reads as nothing is used", async () => {
    const { db, svc } = seed();
    const real = db.from.bind(db);
    (db as any).from = (t: string) => {
      if (t === "recipe_current_dish") throw new Error("boom");
      return real(t);
    };
    await expect(svc.counts(A)).rejects.toThrow(USE_COUNTS_UNREAD);
  });

  it("a good used only by a legacy drink counts at least 1 (the drawer says used, so the list must)", async () => {
    const { svc } = seed();
    const { counts } = await svc.counts(A);
    expect(counts.campari).toBeGreaterThanOrEqual(1);
  });

  it("reads only the house's own cocktails' ingredient rows, never the catalogue's or another house's", async () => {
    const { db, svc } = seed();
    db.tables.cocktails.push(...Array.from({ length: 1200 }, (_, k) => ({ id: `cat-${k}`, restaurant_id: null, deleted_at: null })));
    db.tables.cocktail_ingredients.push(
      ...Array.from({ length: 1200 }, (_, k) => ({ id: `z${String(k).padStart(4, "0")}`, cocktail_id: `cat-${k}`, beverage_id: "bev-campari", wine_id: null })),
    );
    let read = 0;
    const real = db.from.bind(db);
    (db as any).from = (t: string) => {
      const q: any = real(t);
      if (t !== "cocktail_ingredients") return q;
      const then = q.then.bind(q);
      q.then = (res: any, rej: any) => then((r: any) => { read += Array.isArray(r.data) ? r.data.length : 0; return res(r); }, rej);
      return q;
    };
    expect(await svc.counts(A)).toEqual({ counts: { gin: 2, campari: 1 } });
    // house A's live cocktail c-sour has two rows (i1, i2); nothing of the 1,200 catalogue rows is read.
    expect(read).toBe(2);
  });

  it("a failed legacy read is unread, not 0", async () => {
    const { db, svc } = seed();
    const real = db.from.bind(db);
    (db as any).from = (t: string) => {
      if (t === "cocktail_ingredients") throw new Error("boom");
      return real(t);
    };
    await expect(svc.counts(A)).rejects.toThrow(USE_COUNTS_UNREAD);
  });
});

describe("ItemUseCountsService: legacy house cocktails count, as the drawer's Used in does", () => {
  function legacySeed() {
    const { db, svc } = seed();
    db.tables.restaurant_inventory = [
      { id: "gin", restaurant_id: A, beverage_id: "bev-gin", master_wine_id: null },
      { id: "campari", restaurant_id: A, beverage_id: "bev-campari", master_wine_id: null },
      { id: "vermouth", restaurant_id: A, beverage_id: null, master_wine_id: "wine-vermouth" },
      { id: "lime", restaurant_id: A, beverage_id: null, master_wine_id: null },
      { id: "campari-b", restaurant_id: B, beverage_id: "bev-campari", master_wine_id: null },
    ];
    db.tables.cocktails.push(
      { id: "c-negroni", restaurant_id: A, deleted_at: null },
      // not "c-old": the base seed already has a LIVE c-old
      { id: "c-deleted", restaurant_id: A, deleted_at: "2026-11-01T00:00:00Z" },
      { id: "c-b-legacy", restaurant_id: B, deleted_at: null },
    );
    db.tables.cocktail_ingredients = [
      // a legacy-only drink: Campari (by beverage) and vermouth (by wine), no recipe version at all
      { id: "i1", cocktail_id: "c-negroni", beverage_id: "bev-campari", wine_id: null },
      { id: "i2", cocktail_id: "c-negroni", beverage_id: null, wine_id: "wine-vermouth" },
      { id: "i3", cocktail_id: "c-negroni", beverage_id: null, wine_id: null, free_text: "orange peel" },
      // c-sour has a current version AND a legacy list naming gin: still one drink
      { id: "i4", cocktail_id: "c-sour", beverage_id: "bev-gin", wine_id: null },
      // a deleted drink's legacy list, and another house's, count for nobody here
      { id: "i5", cocktail_id: "c-deleted", beverage_id: "bev-campari", wine_id: null },
      { id: "i6", cocktail_id: "c-b-legacy", beverage_id: "bev-campari", wine_id: null },
    ];
    return { db, svc };
  }

  it("a good only a legacy house cocktail uses counts 1, by beverage or by wine", async () => {
    const { svc } = legacySeed();
    const { counts } = await svc.counts(A);
    expect(counts.campari).toBe(1);
    expect(counts.vermouth).toBe(1);
    expect(counts.lime).toBeUndefined();
  });

  it("a drink with both a current version and a legacy list counts once", async () => {
    const { svc } = legacySeed();
    expect((await svc.counts(A)).counts.gin).toBe(2); // c-sour (both lists) + d-plate
  });

  it("a house with legacy drinks and no recipe lines at all still counts them", async () => {
    const { db, svc } = legacySeed();
    db.tables.recipe_lines = [];
    // c-sour has a current version, so its legacy gin row is superseded (ADR 0366, #2444): the
    // drawer's Used in no longer lists it, and the count agrees.
    expect((await svc.counts(A)).counts).toEqual({ campari: 1, vermouth: 1 });
  });

  it("a failed read of the legacy lists is unread, not zero", async () => {
    const { db, svc } = legacySeed();
    const real = db.from.bind(db);
    (db as any).from = (t: string) => {
      if (t === "cocktail_ingredients") throw new Error("boom");
      return real(t);
    };
    await expect(svc.counts(A)).rejects.toThrow(USE_COUNTS_UNREAD);
  });
});


describe("the list's count is the drawer's Used in (r110 inventory-6)", () => {
  // Every good of the house, read both ways on one seed: the list's count and the drawer's drinks
  // (legacy cocktail rows not superseded, plus current versions), one drink once. A good no drink
  // uses has no count and no drawer row. Dishes are not in this seed (dishes.service reads them).
  async function bothWays(db: FakeDb, svc: ItemUseCountsService) {
    const { counts } = await svc.counts(A);
    const usedIn = new ItemUsedInService({ supabase: db } as any);
    const goods = db.tables.restaurant_inventory!.filter((g) => g.restaurant_id === A).map((g) => String(g.id));
    const drawer: Record<string, number> = {};
    for (const id of goods) {
      const u = await usedIn.usedIn(A, id);
      const drinks = new Set([...(u.inCocktails.lines ?? []), ...(u.inDrinkRecipes.lines ?? [])].map((l) => l.cocktailId));
      if (drinks.size > 0) drawer[id] = drinks.size;
    }
    return { counts, drawer };
  }
  const noDishes = (db: FakeDb) => {
    db.tables.recipe_current_dish = [];
    db.tables.dishes = [];
    for (const c of db.tables.cocktails!) c.name ??= String(c.id); // the drawer names each drink
  };

  it("[REVERT-FAILS] agree on legacy rows, superseded rows, deleted drinks and another house's drinks", async () => {
    const { db, svc } = seed();
    noDishes(db);
    // c-old (live, no version) names Campari the legacy way; c-sour has a version, so its legacy
    // gin row is history; c-gone is deleted; c-b is another house's.
    const { counts, drawer } = await bothWays(db, svc);
    expect(drawer).toEqual({ gin: 1, campari: 1 });
    expect(counts).toEqual(drawer);
  });

  it("[REVERT-FAILS] agree when a superseded legacy row names a good no current line does", async () => {
    const { db, svc } = seed();
    noDishes(db);
    db.tables.restaurant_inventory!.push({ id: "tonic", restaurant_id: A, beverage_id: "bev-tonic", master_wine_id: null });
    db.tables.cocktail_ingredients!.push({ id: "i9", cocktail_id: "c-sour", beverage_id: "bev-tonic", wine_id: null });
    const { counts, drawer } = await bothWays(db, svc);
    expect(drawer.tonic).toBeUndefined();
    expect(counts).toEqual(drawer);
  });
});
