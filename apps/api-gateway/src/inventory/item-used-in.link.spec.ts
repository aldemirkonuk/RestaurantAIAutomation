import { ForbiddenException } from "@nestjs/common";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import { ItemUsedInService } from "./item-used-in.service";
import { ItemDetailController } from "./item-detail.controller";

const H = "house-1";
const I = "item-1";
const TWIN = "item-2";

function seed() {
  const db = new FakeDb();
  db.tables.restaurant_inventory = [
    { id: I, restaurant_id: H, kind: "spirit", display_name: "Rakı Yeni", wine_name: null, master_wine_id: null, beverage_id: null },
    { id: TWIN, restaurant_id: H, kind: "spirit", display_name: "Raki yeni", wine_name: null, master_wine_id: null, beverage_id: null },
    { id: "other-item", restaurant_id: "house-2", kind: "spirit", display_name: "Rakı Yeni" },
  ];
  db.tables.restaurant_menus = [
    { id: "menu-now", restaurant_id: H, status: "active", name: "Bar list" },
    { id: "menu-old", restaurant_id: H, status: "archived" },
  ];
  const line = (id: string, more: Record<string, any> = {}) => ({
    id, menu_id: "menu-now", restaurant_id: H, name: "RAKI YENİ", by_glass_price: 90, bottle_price: null,
    inventory_item_id: null, wine_library_id: null, status: "approved", ...more,
  });
  db.tables.menu_items = [
    line("l-1"),
    line("l-old", { menu_id: "menu-old" }),
    line("l-gone", { status: "discarded" }),
    line("l-other", { name: "Efe Rakı" }),
    line("l-held", { inventory_item_id: TWIN }),
  ];
  db.tables.cocktail_ingredients = [];
  db.tables.cocktails = [];
  db.tables.recipe_lines = [];
  db.tables.recipe_current = [];
  return { db, svc: new ItemUsedInService({ supabase: db } as any) };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e.getStatus?.() ?? 500;
  }
};
const body = async (p: Promise<unknown>) => p.then(() => null, (e: any) => e.getResponse?.());

describe("ItemUsedInService.link (r109 g2)", () => {
  it("links a same-named current-menu line and answers the fresh Used in, with the line moved", async () => {
    const { db, svc } = seed();
    const r = await svc.link(H, I, "l-1");
    expect(db.tables.menu_items!.find((l) => l.id === "l-1")!.inventory_item_id).toBe(I);
    expect(r.soldAs.lines!.map((l) => l.menuItemId)).toEqual(["l-1"]);
    // The line names its menu, so the person linking it knows which.
    expect(r.soldAs.lines![0].menuName).toBe("Bar list");
    expect(r.namedNotLinked.lines!.map((l) => l.menuItemId)).not.toContain("l-1");
  });

  it("refuses a good of another house with 404, and writes nothing", async () => {
    const { db, svc } = seed();
    expect(await status(svc.link(H, "other-item", "l-1"))).toBe(404);
    expect(db.tables.menu_items!.find((l) => l.id === "l-1")!.inventory_item_id).toBeNull();
  });

  it("refuses a line of another house with 404", async () => {
    const { db, svc } = seed();
    db.tables.menu_items!.push({ id: "l-x", menu_id: "menu-x", restaurant_id: "house-2", name: "Rakı Yeni", inventory_item_id: null, status: "approved" });
    expect(await status(svc.link(H, I, "l-x"))).toBe(404);
  });

  it("refuses a line whose name is not this good's with 409", async () => {
    const { db, svc } = seed();
    expect(await body(svc.link(H, I, "l-other"))).toMatchObject({ reason: "name_mismatch" });
    expect(db.tables.menu_items!.find((l) => l.id === "l-other")!.inventory_item_id).toBeNull();
  });

  it("refuses a line already linked with 409, naming the good that holds it", async () => {
    const { svc } = seed();
    expect(await body(svc.link(H, I, "l-held"))).toMatchObject({ reason: "already_linked", heldBy: { id: TWIN, displayName: "Raki yeni" } });
  });

  it("twins stay apart: once one twin holds the line, the other is answered 409", async () => {
    const { svc } = seed();
    await svc.link(H, TWIN, "l-1");
    expect(await body(svc.link(H, I, "l-1"))).toMatchObject({ reason: "already_linked", heldBy: { id: TWIN } });
  });

  it("refuses a line on an archived menu, or a discarded line, with 409", async () => {
    const { db, svc } = seed();
    expect(await body(svc.link(H, I, "l-old"))).toMatchObject({ reason: "not_current" });
    expect(await body(svc.link(H, I, "l-gone"))).toMatchObject({ reason: "not_current" });
    expect(db.tables.menu_items!.filter((l) => l.inventory_item_id === I)).toEqual([]);
  });

  it("answers 409 when the write matched nothing (linked between the read and the write)", async () => {
    const { db, svc } = seed();
    const realFrom = db.from.bind(db);
    let reads = 0;
    (db as any).from = (t: string) => {
      const q = realFrom(t);
      if (t === "menu_items" && ++reads === 1) {
        // The first read sees the line unlinked; then another good takes it.
        const ms = q.maybeSingle.bind(q);
        (q as any).maybeSingle = async () => {
          const r = await ms();
          db.tables.menu_items!.find((l) => l.id === "l-1")!.inventory_item_id = TWIN;
          return { ...r, data: { ...r.data, inventory_item_id: null } };
        };
      }
      return q;
    };
    expect(await body(svc.link(H, I, "l-1"))).toMatchObject({ reason: "already_linked", heldBy: { id: TWIN } });
    expect(db.tables.menu_items!.find((l) => l.id === "l-1")!.inventory_item_id).toBe(TWIN);
  });
});

describe("POST used-in/link (r109 g2)", () => {
  it("a staff member is refused 403 and nothing is linked", async () => {
    const link = jest.fn();
    const organizations = {
      assertCanManageRestaurant: jest.fn(async () => {
        throw new ForbiddenException("Only an owner or a manager can link a menu line to a good.");
      }),
    };
    const ctrl = new ItemDetailController({ link } as any, {} as any, {} as any, organizations as any, {} as any);
    expect(await status(ctrl.linkUsedIn(H, I, { menuItemId: "l-1" }, { userId: "u-staff" }))).toBe(403);
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith("u-staff", H, expect.any(String));
    expect(link).not.toHaveBeenCalled();
  });

  it("a manager links through the service", async () => {
    const link = jest.fn(async () => ({ ok: true }));
    const organizations = { assertCanManageRestaurant: jest.fn(async () => undefined) };
    const ctrl = new ItemDetailController({ link } as any, {} as any, {} as any, organizations as any, {} as any);
    await ctrl.linkUsedIn(H, I, { menuItemId: "l-1" }, { userId: "u-mgr" });
    expect(link).toHaveBeenCalledWith(H, I, "l-1");
  });
});
