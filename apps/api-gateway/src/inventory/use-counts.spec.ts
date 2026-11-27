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
  // Legacy: Campari is used only by an older cocktail_ingredients row of a live house drink.
  db.tables.restaurant_inventory = [
    { id: "campari", restaurant_id: A, beverage_id: "bev-campari", master_wine_id: null },
    { id: "gin", restaurant_id: A, beverage_id: "bev-gin", master_wine_id: null },
    { id: "b-campari", restaurant_id: B, beverage_id: "bev-campari", master_wine_id: null },
  ];
  db.tables.cocktail_ingredients = [
    { id: "i1", cocktail_id: "c-sour", beverage_id: "bev-campari", wine_id: null },
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

  it("never counts another house's lines", async () => {
    const { svc } = seed();
    const a = await svc.counts(A);
    const b = await svc.counts(B);
    expect(a.counts.vodka).toBeUndefined();
    expect(b.counts).toEqual({ gin: 1, vodka: 1, "b-campari": 1 });
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
