import { FakeDb } from "../notifications/producers/testing/fake-db";
import { HouseItemService } from "./house-item.service";

const H = "house-1";

/** FakeDb plus restaurant_inventory_house_declared_uidx: (restaurant_id, lower(display_name)). */
function seed() {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [];
  const from = db.from.bind(db);
  (db as any).from = (t: string) => {
    const q: any = from(t);
    if (t !== "restaurant_inventory") return q;
    const insert = q.insert.bind(q);
    q.insert = (row: any) => {
      const clash = db.tables.restaurant_inventory.some(
        (r) =>
          r.restaurant_id === row.restaurant_id &&
          r.master_wine_id == null &&
          r.beverage_id == null &&
          String(r.display_name).toLowerCase() === String(row.display_name).toLowerCase(),
      );
      if (!clash) return insert(row);
      const err = { data: null, error: { code: "23505", message: "restaurant_inventory_house_declared_uidx" } };
      return { select: () => ({ single: async () => err }) };
    };
    return q;
  };
  return { db, svc: new HouseItemService({ supabase: db } as any) };
}

describe("HouseItemService: carry this (proposal S2)", () => {
  it("(f) carries a food with no library row, named by wine_name, par 0", async () => {
    const { db, svc } = seed();
    const out = await svc.carry(H, { kind: "food", uom: "g", displayName: "  Un " });
    expect(out).toMatchObject({ kind: "food", uom: "g", displayName: "Un", thresholdMin: 0 });
    expect(db.tables.restaurant_inventory[0]).toMatchObject({
      restaurant_id: H,
      kind: "food",
      master_wine_id: null,
      beverage_id: null,
      wine_name: "Un",
      identity_provenance: "house_declared",
      threshold_min: 0,
    });
    expect(db.tables.restaurant_inventory[0]).not.toHaveProperty("stock_live");
  });

  it("(f) refuses kg and l with the small unit to use", async () => {
    const { svc } = seed();
    await expect(svc.carry(H, { kind: "food", uom: "kg", displayName: "Un" })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("store it in g"),
    });
    await expect(svc.carry(H, { kind: "food", uom: "l", displayName: "Süt" })).rejects.toMatchObject({
      message: expect.stringContaining("store it in ml"),
    });
  });

  it("(f) refuses wine, an unknown kind and an empty name", async () => {
    const { db, svc } = seed();
    await expect(svc.carry(H, { kind: "wine", uom: "bottle", displayName: "X" })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("add a wine from the library"),
    });
    await expect(svc.carry(H, { kind: "flour", uom: "g", displayName: "X" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.carry(H, { kind: "food", uom: "g", displayName: "   " })).rejects.toMatchObject({ status: 400 });
    expect(db.tables.restaurant_inventory).toHaveLength(0);
  });

  it("(f) a second 'un' is a 409 naming the row already carried", async () => {
    const { db, svc } = seed();
    const first = await svc.carry(H, { kind: "food", uom: "g", displayName: "Un", thresholdMin: 500 });
    expect(db.tables.restaurant_inventory[0].threshold_min).toBe(500);
    const dup = await svc.carry(H, { kind: "food", uom: "g", displayName: "UN" }).catch((e) => e);
    expect(dup.status).toBe(409);
    expect(dup.getResponse()).toMatchObject({ message: "This house already carries UN", existingId: first.id });
  });

  describe("r21 D2: the paper's size travels with the good", () => {
    it("a 200 ml tonic kept by the bottle is stored with bottle_size_ml 200", async () => {
      const { db, svc } = seed();
      const out = await svc.carry(H, { kind: "other", uom: "bottle", displayName: "Tonik", bottleSizeMl: 200 });
      expect(db.tables.restaurant_inventory[0].bottle_size_ml).toBe(200);
      expect(out.bottleSizeMl).toBe(200);
    });

    it("no size given is stored as NULL, never 750", async () => {
      const { db, svc } = seed();
      const out = await svc.carry(H, { kind: "other", uom: "bottle", displayName: "Tonik" });
      expect(db.tables.restaurant_inventory[0].bottle_size_ml).toBeNull();
      expect(out.bottleSizeMl).toBeNull();
    });

    it("a 30 l keg is carried; a keg's bounds are not a bottle's", async () => {
      const { db, svc } = seed();
      await svc.carry(H, { kind: "beer", uom: "keg", displayName: "Efes fıçı", bottleSizeMl: 30000 });
      expect(db.tables.restaurant_inventory[0].bottle_size_ml).toBe(30000);
    });

    it("refuses a size on a good kept in ml, g or by the piece, and adds nothing", async () => {
      const { db, svc } = seed();
      for (const uom of ["ml", "g", "each"]) {
        await expect(
          svc.carry(H, { kind: "food", uom, displayName: "Zeytinyağı", bottleSizeMl: 1000 }),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("has none") });
      }
      expect(db.tables.restaurant_inventory).toHaveLength(0);
    });

    it("refuses a bottle outside 50-18000 ml and a fractional size", async () => {
      const { db, svc } = seed();
      for (const ml of [49, 18001, 187.5]) {
        await expect(
          svc.carry(H, { kind: "other", uom: "bottle", displayName: "Tonik", bottleSizeMl: ml }),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("from 50 to 18000") });
      }
      await expect(
        svc.carry(H, { kind: "beer", uom: "keg", displayName: "Fıçı", bottleSizeMl: 500 }),
      ).rejects.toMatchObject({ status: 400 });
      expect(db.tables.restaurant_inventory).toHaveLength(0);
    });
  });
});

