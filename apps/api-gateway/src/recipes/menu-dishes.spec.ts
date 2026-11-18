import { ServiceUnavailableException } from "@nestjs/common";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DishesController } from "./dishes.controller";
import { DishesService, MENU_DISHES_UNREAD } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { menuDishesNotListed } from "./menu-dishes";
import { HOUSE_A, HOUSE_B, fakeDb, twoHouses, type Row } from "./dishes.testing";

/**
 * r28 onboarding audit, gap 1, slice 3: a food house's menu dishes come onto
 * /dishes without being typed again. The rule alone, then the real service
 * over two houses' rows that the fake filters and caps at 1,000, with a
 * dishes table that keeps the migration's one-live-name-per-house index.
 */

const MENU_NOW = "a0000000-0000-4000-8000-000000000001";
const MENU_ALSO_NOW = "a0000000-0000-4000-8000-000000000002";
const MENU_OLD = "a0000000-0000-4000-8000-000000000003";
const MENU_DRAFT = "a0000000-0000-4000-8000-000000000004";
const MENU_B = "a0000000-0000-4000-8000-000000000009";

let n = 0;
const mline = (menu: string, house: string, name: unknown, category: string | null, bottle: unknown, glass: unknown = null, extra: Row = {}): Row => ({
  id: `b0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  menu_id: menu, restaurant_id: house, name, category, bottle_price: bottle, by_glass_price: glass, status: "approved", ...extra,
});

describe("menuDishesNotListed: which menu lines become dishes (gap 1 slice 3)", () => {
  const l = (name: unknown, category: string | null, bottle: unknown, glass: unknown = null) => mline(MENU_NOW, HOUSE_A, name, category, bottle, glass) as any;

  it("offers only kitchen lines, with the menu's section and price", () => {
    const out = menuDishesNotListed([l("Adana kebap", "Starters", 420), l("Chianti", "Red", 48), l("House G&T", "Cocktails", 12, 9)], []);
    expect(out).toEqual([{ name: "Adana kebap", section: "Starters", price: 420, pricesDiffer: false }]);
  });

  it("never offers a dish already on the list, under the folded name", () => {
    const out = menuDishesNotListed([l("ÇIĞ  KÖFTE", "Food", 6.5), l("Lemon tart", "Desserts", 9)], ["cig kofte", null]);
    expect(out.map((d) => d.name)).toEqual(["Lemon tart"]);
  });

  it("makes one dish of lines that share a folded name and a price", () => {
    const out = menuDishesNotListed([l("Mercimek çorbası", "Starters", 160), l("MERCIMEK CORBASI", "Starters", "160.00")], []);
    expect(out).toEqual([{ name: "Mercimek çorbası", section: "Starters", price: 160, pricesDiffer: false }]);
  });

  it("offers no price, and says so, when lines of one name disagree", () => {
    const out = menuDishesNotListed([l("Pide", "Food", 180), l("pide", "Food", 210)], []);
    expect(out).toEqual([{ name: "Pide", section: null, price: null, pricesDiffer: true }]);
  });

  it("does not take a line with no price for a disagreement", () => {
    const out = menuDishesNotListed([l("Pide", "Starters", null), l("Pide", "Starters", 180)], []);
    expect(out).toEqual([{ name: "Pide", section: "Starters", price: 180, pricesDiffer: false }]);
  });

  it("reads the glass price when a dish states no bottle price", () => {
    expect(menuDishesNotListed([l("Soup of the day", "Starters", null, 7.5)], [])[0].price).toBe(7.5);
  });

  it("keeps a named section and drops one that only says food", () => {
    const out = menuDishesNotListed([l("A", "Food", 1), l("B", " kitchen ", 1), l("C", "Dishes", 1), l("D", "Fresh  pasta", 1)], []);
    expect(out.map((d) => d.section)).toEqual([null, null, null, "Fresh pasta"]);
  });

  it("sends nothing the dishes table refuses: long names and sections are cut, an impossible price is none", () => {
    const long = `Pasta ${"x".repeat(300)}`;
    const [d] = menuDishesNotListed([l(long, `Pasta ${"y".repeat(300)}`, 12_345_678_901)], []);
    expect(d.name).toHaveLength(200);
    expect(d.section).toHaveLength(200);
    expect(d.price).toBeNull();
    expect(menuDishesNotListed([l("Kebab", "Pasta", -3)], [])[0].price).toBeNull();
    expect(menuDishesNotListed([l("Kebab", "Pasta", "abc")], [])[0].price).toBeNull();
  });

  it("skips a line with no name", () => {
    expect(menuDishesNotListed([l(null, "Food", 3), l("   ", "Food", 3)], [])).toEqual([]);
  });
});

/** The house's rows: two current menus, one old, one draft, and house B's. */
function rows(): Record<string, Row[]> {
  n = 0;
  const r = twoHouses();
  r.restaurant_menus = [
    { id: MENU_NOW, restaurant_id: HOUSE_A, status: "active" },
    { id: MENU_ALSO_NOW, restaurant_id: HOUSE_A, status: "active" },
    { id: MENU_OLD, restaurant_id: HOUSE_A, status: "archived" },
    { id: MENU_DRAFT, restaurant_id: HOUSE_A, status: "draft" },
    { id: MENU_B, restaurant_id: HOUSE_B, status: "active" },
  ];
  r.menu_items = [
    mline(MENU_NOW, HOUSE_A, "Adana kebap", "Starters", 420),
    mline(MENU_NOW, HOUSE_A, "LEMON TART", "Desserts", 9), // on the list as "Lemon tart"
    mline(MENU_NOW, HOUSE_A, "Chianti", "Red", 48),
    mline(MENU_ALSO_NOW, HOUSE_A, "Mercimek çorbası", "Starters", 160),
    // A dish taken off the list, or house B's dish, never hides a menu dish.
    mline(MENU_ALSO_NOW, HOUSE_A, "Retired pie", "Desserts", 5),
    mline(MENU_ALSO_NOW, HOUSE_A, "B-only flan", "Desserts", 6),
    // Not current, discarded, or another house's: never offered.
    mline(MENU_OLD, HOUSE_A, "Old pasta", "Pasta", 11),
    mline(MENU_DRAFT, HOUSE_A, "Draft salad", "Salad", 8),
    mline(MENU_NOW, HOUSE_A, "Gone pasta", "Pasta", 12, null, { status: "discarded" }),
    mline(MENU_B, HOUSE_B, "B-SECRET soup", "Starters", 777),
    mline(MENU_NOW, HOUSE_B, "B-STRAY salad", "Salad", 778),
  ];
  return r;
}

const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The fake's dishes table, with the migration's index: one live dish per
 * house per lower-cased, space-folded name (a second is a 23505). `fail`
 * makes the insert of that name fail another way; `race` adds a dish of
 * that name, as another tab would, just before the first insert.
 */
function service(r = rows(), opts: { fail?: string; race?: string; readFails?: boolean } = {}) {
  const fake = fakeDb(r);
  const client: any = fake.db.getClient();
  const base = client.from;
  const inserts: Row[] = [];
  let raced = false;
  client.from = (table: string) => {
    if (opts.readFails && table === "restaurant_menus") {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: "boom" } }) }) }) };
    }
    const q = base(table);
    if (table !== "dishes") return q;
    q.insert = (row: Row) => {
      const answer = () => {
        if (opts.race && !raced) {
          raced = true;
          r.dishes.push({ id: "d0000000-0000-4000-8000-0000000race1", restaurant_id: row.restaurant_id, name: opts.race, deleted_at: null });
        }
        if (row.name === opts.fail) return { data: null, error: { code: "08006", message: "connection lost" } };
        const taken = r.dishes.some((d) => d.restaurant_id === row.restaurant_id && d.deleted_at == null && fold(d.name) === fold(row.name));
        if (taken) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const made = { id: `d0000000-0000-4000-8000-${String(inserts.length + 1).padStart(12, "0")}`, deleted_at: null, ...row };
        inserts.push(made);
        r.dishes.push(made);
        return { data: made, error: null };
      };
      return { select: () => ({ single: async () => answer() }) };
    };
    return q;
  };
  return { svc: new DishesService(fake.db, new RecipesService(fake.db)), inserts };
}

describe("DishesService.menuDishes: the offer read from the current menu", () => {
  it("offers this house's current menus' dishes that are not on its list", async () => {
    const out = await service().svc.menuDishes(HOUSE_A);
    expect(out.currentMenus).toBe(2);
    expect(out.dishes).toEqual([
      { name: "Adana kebap", section: "Starters", price: 420, pricesDiffer: false },
      { name: "Mercimek çorbası", section: "Starters", price: 160, pricesDiffer: false },
      { name: "Retired pie", section: "Desserts", price: 5, pricesDiffer: false },
      { name: "B-only flan", section: "Desserts", price: 6, pricesDiffer: false },
    ]);
  });

  it("offers nothing, and says no menu is current, when none is", async () => {
    const r = rows();
    r.restaurant_menus = r.restaurant_menus.filter((m) => m.restaurant_id !== HOUSE_A || m.status !== "active");
    expect(await service(r).svc.menuDishes(HOUSE_A)).toEqual({ currentMenus: 0, dishes: [] });
  });

  it("reads the whole list past 1,000 dishes before it offers one", async () => {
    const r = rows();
    for (let i = 0; i < 1100; i++) {
      r.dishes.push({ id: `d1000000-0000-4000-8000-${String(i).padStart(12, "0")}`, restaurant_id: HOUSE_A, name: `Plate ${i}`, deleted_at: null });
    }
    // Sorted last by id, so only a read past the first page sees it.
    r.dishes.push({ id: "dffffff0-0000-4000-8000-000000000000", restaurant_id: HOUSE_A, name: "adana  KEBAP", deleted_at: null });
    const out = await service(r).svc.menuDishes(HOUSE_A);
    expect(out.dishes.map((d) => d.name)).toEqual(["Mercimek çorbası", "Retired pie", "B-only flan"]);
  });

  it("refuses with a sentence, never an empty offer, when the menu cannot be read", async () => {
    const run = service(rows(), { readFails: true }).svc.menuDishes(HOUSE_A);
    await expect(run).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service(rows(), { readFails: true }).svc.menuDishes(HOUSE_A)).rejects.toThrow(MENU_DISHES_UNREAD);
  });
});

describe("DishesService.addMenuDishes: the offer put on the list", () => {
  it("makes each named dish in this house, with the menu's section and price", async () => {
    const { svc, inserts } = service();
    const out = await svc.addMenuDishes(HOUSE_A, ["Adana kebap", "Mercimek çorbası"]);
    expect(out.added.map((d) => d.name)).toEqual(["Adana kebap", "Mercimek çorbası"]);
    expect(out.added[0].id).toBe(inserts[0].id);
    expect(out).toMatchObject({ already: [], notAdded: [], notOffered: [] });
    expect(inserts).toEqual([
      expect.objectContaining({ restaurant_id: HOUSE_A, name: "Adana kebap", menu_section: "Starters", price: 420 }),
      expect.objectContaining({ restaurant_id: HOUSE_A, name: "Mercimek çorbası", menu_section: "Starters", price: 160 }),
    ]);
  });

  it("makes only the names asked for, matched folded", async () => {
    const { svc, inserts } = service();
    const out = await svc.addMenuDishes(HOUSE_A, ["MERCIMEK CORBASI"]);
    expect(inserts.map((d) => d.name)).toEqual(["Mercimek çorbası"]);
    expect(out.notOffered).toEqual([]);
  });

  it("says a name no longer offered, and makes nothing for it", async () => {
    const { svc, inserts } = service();
    const out = await svc.addMenuDishes(HOUSE_A, ["Lemon tart", "Chianti", "B-SECRET soup"]);
    expect(inserts).toEqual([]);
    expect(out).toEqual({ added: [], already: [], notAdded: [], notOffered: ["Lemon tart", "Chianti", "B-SECRET soup"] });
  });

  it("takes a dish another tab made meanwhile as already there, and goes on", async () => {
    const { svc, inserts } = service(rows(), { race: "Adana Kebap" });
    const out = await svc.addMenuDishes(HOUSE_A, ["Adana kebap", "Mercimek çorbası"]);
    expect(out.already).toEqual(["Adana kebap"]);
    expect(out.added.map((d) => d.name)).toEqual(["Mercimek çorbası"]);
    expect(inserts).toHaveLength(1);
  });

  it("stops at a failed write: what was made is said, the rest are not added", async () => {
    const r = rows();
    r.menu_items.push(mline(MENU_NOW, HOUSE_A, "Baklava", "Desserts", 140));
    const { svc, inserts } = service(r, { fail: "Mercimek çorbası" });
    const out = await svc.addMenuDishes(HOUSE_A, ["Adana kebap", "Mercimek çorbası", "Baklava"]);
    expect(out.added.map((d) => d.name)).toEqual(["Adana kebap"]);
    expect(out.notAdded).toEqual(["Mercimek çorbası", "Baklava"]);
    expect(inserts.map((d) => d.name)).toEqual(["Adana kebap"]);
  });
});

describe("DishesController: only an owner or a manager reads or takes the offer", () => {
  it.each(["menuDishes", "addMenuDishes"] as const)("%s is owner/manager only", (method) => {
    const roles = Reflect.getMetadata(ROLES_KEY, DishesController.prototype[method]);
    expect(roles).toEqual(["owner", "manager"]);
  });
});
