import { ServiceUnavailableException } from "@nestjs/common";
import { DishesService, MENU_PRICES_UNREAD } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { menuIndex, menuPriceFor } from "./menu-price-match";
import { HOUSE_A, HOUSE_B, SOUP, TART, fakeDb, twoHouses, type Row } from "./dishes.testing";

/**
 * r28 recipes audit, gap 2 (slice 1): each dish and drink row is shown the
 * price the house's CURRENT menu gives a line of the same name. Through the
 * real service over two houses' rows that the fake filters and caps at 1,000.
 */

const MARG_DISH = "d0000000-0000-4000-8000-0000000000c1";
const KOFTE = "d0000000-0000-4000-8000-0000000000c2";
const GT = "c0000000-0000-4000-8000-0000000000a1";
const SOUR = "c0000000-0000-4000-8000-0000000000a2";
const MARG_DRINK = "c0000000-0000-4000-8000-0000000000a3";
const MENU_NOW = "a0000000-0000-4000-8000-000000000001";
const MENU_ALSO_NOW = "a0000000-0000-4000-8000-000000000002";
const MENU_OLD = "a0000000-0000-4000-8000-000000000003";
const MENU_DRAFT = "a0000000-0000-4000-8000-000000000004";
const MENU_B = "a0000000-0000-4000-8000-000000000009";

let n = 0;
const mline = (menu: string, house: string, name: string, category: string | null, bottle: number | null, glass: number | null = null, extra: Row = {}): Row => ({
  id: `b0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  menu_id: menu, restaurant_id: house, name, category, bottle_price: bottle, by_glass_price: glass, status: "approved", ...extra,
});

function rows(): Record<string, Row[]> {
  n = 0;
  const r = twoHouses();
  r.dishes.push(
    { id: MARG_DISH, restaurant_id: HOUSE_A, name: "Margarita", menu_section: "Pizza", price: 14, deleted_at: null },
    { id: KOFTE, restaurant_id: HOUSE_A, name: "Çiğ köfte", menu_section: null, price: 6.5, deleted_at: null },
  );
  r.cocktails = [
    { id: GT, restaurant_id: HOUSE_A, name: "gt", display_name: "House G&T", price: 12, deleted_at: null },
    { id: SOUR, restaurant_id: HOUSE_A, name: "Gin Sour", display_name: null, price: 10, deleted_at: null },
    { id: MARG_DRINK, restaurant_id: HOUSE_A, name: "Margarita", display_name: null, price: 12, deleted_at: null },
  ];
  r.restaurant_menus = [
    { id: MENU_NOW, restaurant_id: HOUSE_A, status: "active" },
    { id: MENU_ALSO_NOW, restaurant_id: HOUSE_A, status: "active" },
    { id: MENU_OLD, restaurant_id: HOUSE_A, status: "archived" },
    { id: MENU_DRAFT, restaurant_id: HOUSE_A, status: "draft" },
    { id: MENU_B, restaurant_id: HOUSE_B, status: "active" },
  ];
  r.menu_items = [
    mline(MENU_NOW, HOUSE_A, "LEMON  TART", "Desserts", 9),
    mline(MENU_NOW, HOUSE_A, "Bread soup", "Food", 6),
    mline(MENU_NOW, HOUSE_A, "Margarita", "Food", 14),
    mline(MENU_NOW, HOUSE_A, "Margarita", "Cocktails", null, 11),
    mline(MENU_NOW, HOUSE_A, "CIG KOFTE", "Food", 6.5),
    mline(MENU_NOW, HOUSE_A, "House G&T", "Cocktails", 12, 9),
    mline(MENU_NOW, HOUSE_A, "Gin Sour", "Cocktails", null, 10),
    // The same menu kept current twice states the sour the same way: one answer.
    mline(MENU_ALSO_NOW, HOUSE_A, "gin sour", "Cocktails", null, 10),
    // Not current, discarded, or another house's: never read as the menu.
    mline(MENU_OLD, HOUSE_A, "Lemon tart", "Desserts", 7),
    mline(MENU_DRAFT, HOUSE_A, "Lemon tart", "Desserts", 8),
    mline(MENU_NOW, HOUSE_A, "Lemon tart", "Desserts", 99, null, { status: "discarded" }),
    mline(MENU_B, HOUSE_B, "Lemon tart", "Desserts", 777),
    mline(MENU_NOW, HOUSE_B, "Lemon tart", "Desserts", 778),
  ];
  return r;
}

function service(r = rows()) {
  const fake = fakeDb(r);
  return { svc: new DishesService(fake.db, new RecipesService(fake.db)), reads: fake.reads };
}

const byDish = (out: any) => new Map(out.dishes.map((d: any) => [d.dishId, d.menu]));
const byDrink = (out: any) => new Map(out.drinks.map((d: any) => [d.cocktailId, d.menu]));

describe("menu prices: the current menu's price beside each dish and drink (r28 gap 2)", () => {
  it("reads only this house's current menu, and says whether each row's price agrees", async () => {
    const out = await service().svc.menuPrices(HOUSE_A, "owner");
    expect(out).toMatchObject({ amountsWithheld: false, currentMenus: 2 });
    const d = byDish(out);
    expect(d.get(TART)).toEqual({ found: "one", prices: [9], agrees: true });
    // The soup has no price of its own: the menu's is shown, agreement unknown.
    expect(d.get(SOUP)).toEqual({ found: "one", prices: [6], agrees: null });
    expect(d.get(KOFTE)).toEqual({ found: "one", prices: [6.5], agrees: true });
    expect(out.dishes.map((x: any) => x.dishId)).not.toContain("d0000000-0000-4000-8000-0000000000b1");
  });

  it("a dish finds the kitchen's line and a drink the bar's, when both share a name", async () => {
    const out = await service().svc.menuPrices(HOUSE_A, "manager");
    expect(byDish(out).get(MARG_DISH)).toEqual({ found: "one", prices: [14], agrees: true });
    expect(byDrink(out).get(MARG_DRINK)).toEqual({ found: "one", prices: [11], agrees: false });
  });

  it("a drink is found by the name it shows, a line with two prices agrees with either", async () => {
    const out = await service().svc.menuPrices(HOUSE_A, "owner");
    expect(byDrink(out).get(GT)).toEqual({ found: "one", prices: [9, 12], agrees: true });
    expect(byDrink(out).get(SOUR)).toEqual({ found: "one", prices: [10], agrees: true });
  });

  it("two current lines of one name that disagree are 'several', never a guess", async () => {
    const r = rows();
    r.menu_items.push(mline(MENU_ALSO_NOW, HOUSE_A, "Lemon tart", "Desserts", 10));
    const out = await service(r).svc.menuPrices(HOUSE_A, "owner");
    expect(byDish(out).get(TART)).toEqual({ found: "several", lines: 2 });
  });

  it("a row the menu does not name is 'none'", async () => {
    const r = rows();
    r.menu_items = r.menu_items.filter((l) => !/sour/i.test(l.name));
    const out = await service(r).svc.menuPrices(HOUSE_A, "owner");
    expect(byDrink(out).get(SOUR)).toEqual({ found: "none" });
  });

  it("a menu past the 1,000-row cap is read whole", async () => {
    const r = rows();
    const filler = Array.from({ length: 1500 }, (_, i) => mline(MENU_NOW, HOUSE_A, `Filler ${i}`, "Food", 1));
    const late = mline(MENU_NOW, HOUSE_A, "Lemon tart", "Desserts", 10);
    // The tart's second line sorts after every filler line, past the first page.
    r.menu_items.push(...filler, late);
    const out = await service(r).svc.menuPrices(HOUSE_A, "owner");
    expect(byDish(out).get(TART)).toEqual({ found: "several", lines: 2 });
  });

  it("a role that does not see money reads nothing at all", async () => {
    const { svc, reads } = service();
    expect(await svc.menuPrices(HOUSE_A, "staff")).toEqual({ amountsWithheld: true, currentMenus: null, dishes: [], drinks: [] });
    expect(reads).toEqual([]);
  });

  it("no current menu is said as such, with no rows", async () => {
    const r = rows();
    r.restaurant_menus = r.restaurant_menus.map((m) => ({ ...m, status: m.restaurant_id === HOUSE_A ? "archived" : m.status }));
    expect(await service(r).svc.menuPrices(HOUSE_A, "owner")).toEqual({ amountsWithheld: false, currentMenus: 0, dishes: [], drinks: [] });
  });

  it("a failed menu read is a 503 with its sentence, never an empty answer", async () => {
    const fake = fakeDb(rows());
    const client = fake.db.getClient() as any;
    const from = client.from;
    client.from = (t: string) => {
      if (t !== "restaurant_menus") return from(t);
      const q: any = { select: () => q, eq: () => q, then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: "boom" } }) };
      return q;
    };
    const svc = new DishesService({ getClient: () => client } as any, new RecipesService(fake.db));
    await expect(svc.menuPrices(HOUSE_A, "owner")).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(svc.menuPrices(HOUSE_A, "owner")).rejects.toMatchObject({ message: MENU_PRICES_UNREAD });
  });
});

describe("menuPriceFor", () => {
  const index = menuIndex([
    { name: "Negroni", category: "Cocktails", bottle_price: "12.004", by_glass_price: null },
    { name: "Plain", category: null, bottle_price: null, by_glass_price: null },
  ]);
  it("compares to the cent", () => {
    expect(menuPriceFor(["NEGRONI"], "drink", 12, index)).toEqual({ found: "one", prices: [12], agrees: true });
    expect(menuPriceFor(["Negroni"], "drink", 12.01, index)).toEqual({ found: "one", prices: [12], agrees: false });
  });
  it("a line with no price is found, with agreement unknown", () => {
    expect(menuPriceFor(["Plain"], "dish", 5, index)).toEqual({ found: "one", prices: [], agrees: null });
  });
  it("falls back to the next name, and skips blanks", () => {
    expect(menuPriceFor([null, "  ", "Unknown", "negroni"], "drink", null, index)).toEqual({ found: "one", prices: [12], agrees: null });
  });
});
