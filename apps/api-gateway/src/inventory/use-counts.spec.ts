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
