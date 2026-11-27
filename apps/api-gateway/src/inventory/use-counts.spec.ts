import { FakeDb } from "../notifications/producers/testing/fake-db";
import { ItemUseCountsService, USE_COUNTS_UNREAD } from "./item-use-counts.service";

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
    { id: "c-gone", restaurant_id: A, deleted_at: "2026-11-01T00:00:00Z" },
    { id: "c-b", restaurant_id: B, deleted_at: null },
  ];
  db.tables.dishes = [{ id: "d-plate", restaurant_id: A, deleted_at: null }];
  return { db, svc: new ItemUseCountsService({ supabase: db } as any) };
}

describe("ItemUseCountsService (r105 g5)", () => {
  it("counts each current recipe once, and leaves out old versions and deleted drinks", async () => {
    const { svc } = seed();
    expect(await svc.counts(A)).toEqual({ counts: { gin: 2 } });
  });

  it("never counts another house's lines", async () => {
    const { svc } = seed();
    const a = await svc.counts(A);
    const b = await svc.counts(B);
    expect(a.counts.vodka).toBeUndefined();
    expect(b.counts).toEqual({ gin: 1, vodka: 1 });
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
      { id: "c-old", restaurant_id: A, deleted_at: "2026-11-01T00:00:00Z" },
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
      { id: "i5", cocktail_id: "c-old", beverage_id: "bev-campari", wine_id: null },
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
    expect((await svc.counts(A)).counts).toEqual({ campari: 1, vermouth: 1, gin: 1 });
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

