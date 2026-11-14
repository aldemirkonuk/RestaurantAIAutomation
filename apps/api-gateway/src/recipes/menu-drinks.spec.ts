import { ServiceUnavailableException } from "@nestjs/common";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DishesController } from "./dishes.controller";
import { DishesService, MENU_DRINKS_NOT_ADDED, MENU_DRINKS_UNREAD } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { isCocktailLine, menuDrinksNotListed } from "./menu-drinks";
import { menuDishesNotListed } from "./menu-dishes";
import { HOUSE_A, HOUSE_B, fakeDb, twoHouses, type Row } from "./dishes.testing";

/**
 * r36 recipes audit, gap 3: a bar's menu cocktails come onto /cocktails
 * without being typed again. The rule alone, then the real service over two
 * houses' rows that the fake filters and caps at 1,000.
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
const l = (name: unknown, category: string | null, bottle: unknown, glass: unknown = null) => mline(MENU_NOW, HOUSE_A, name, category, bottle, glass) as any;

describe("isCocktailLine: a section that names cocktails", () => {
  it.each(["cocktail", "Cocktails", "Signature  Cocktails", "Cocktails & Mocktails", "Kokteyller", "KOKTEYL MENÜSÜ", "İmza kokteylleri"])(
    "%s is a cocktail section",
    (c) => expect(isCocktailLine(c)).toBe(true),
  );
  it.each(["Mocktails", "Whisky", "Sours", "Red", "Signature", "Desserts", "", null, 42])("%s is not", (c) => expect(isCocktailLine(c)).toBe(false));
});

describe("menuDrinksNotListed: which menu lines become cocktails (gap 3)", () => {
  it("offers only cocktail lines, with the menu's section and the glass price", () => {
    const out = menuDrinksNotListed(
      [l("Negroni", "Signature Cocktails", 40, 12), l("Chianti", "Red", 48, 9), l("Adana kebap", "Starters", 420), l("Virgin mojito", "Mocktails", null, 6)],
      [],
    );
    expect(out).toEqual([{ name: "Negroni", section: "Signature Cocktails", price: 12, pricesDiffer: false }]);
  });

  it("reads the bottle price when a line states no glass price", () => {
    expect(menuDrinksNotListed([l("Espresso martini", "cocktail", 14)], [])[0].price).toBe(14);
  });

  it("never offers a drink already listed, by its name or its shown name, folded", () => {
    const out = menuDrinksNotListed(
      [l("RAKI  SOUR", "Kokteyller", null, 280), l("Penicillin", "Cocktails", null, 15), l("Gimlet", "Cocktails", null, 11)],
      ["rakı sour", null, "PENİCİLLİN"],
    );
    expect(out.map((d) => d.name)).toEqual(["Gimlet"]);
  });

  it("makes one drink of lines that share a folded name and a price", () => {
    const out = menuDrinksNotListed([l("Mojito", "Cocktails", null, 11), l("MOJITO", "Signature cocktails", "11.00")], []);
    expect(out).toEqual([{ name: "Mojito", section: null, price: 11, pricesDiffer: false }]);
  });

  it("offers no price, and says so, when lines of one name disagree", () => {
    expect(menuDrinksNotListed([l("Mojito", "Cocktails", null, 11), l("mojito", "Cocktails", null, 13)], [])).toEqual([
      { name: "Mojito", section: null, price: null, pricesDiffer: true },
    ]);
  });

  it("does not take a line with no price for a disagreement", () => {
    expect(menuDrinksNotListed([l("Mojito", "Cocktails", null, null), l("Mojito", "Cocktails", null, 11)], [])[0]).toMatchObject({
      price: 11,
      pricesDiffer: false,
    });
  });

  it("keeps a named section and drops one that only says cocktail", () => {
    const out = menuDrinksNotListed(
      [l("A", "cocktail", 1), l("B", " Cocktails ", 1), l("C", "Kokteyller", 1), l("D", "Aperitivo cocktails", 1), l("E", "Cocktails & Mocktails", 1)],
      [],
    );
    expect(out.map((d) => d.section)).toEqual([null, null, null, "Aperitivo cocktails", "Cocktails & Mocktails"]);
  });

  it("sends nothing the list refuses: long names cut, an impossible price is none, a nameless line skipped", () => {
    const [d] = menuDrinksNotListed([l(`Sour ${"x".repeat(300)}`, `Cocktails ${"y".repeat(300)}`, null, 12_345_678_901)], []);
    expect(d.name).toHaveLength(200);
    expect(d.section).toHaveLength(200);
    expect(d.price).toBeNull();
    expect(menuDrinksNotListed([l("Sour", "Cocktails", null, -3)], [])[0].price).toBeNull();
    expect(menuDrinksNotListed([l(null, "Cocktails", 3), l("  ", "Cocktails", 3)], [])).toEqual([]);
  });

  it("is a drink, not a dish, when a cocktail section also holds a kitchen word", () => {
    const lines = [l("Chocolate martini", "Dessert cocktails", null, 14), l("Lemon tart", "Desserts", 9)];
    expect(menuDrinksNotListed(lines, []).map((d) => d.name)).toEqual(["Chocolate martini"]);
    expect(menuDishesNotListed(lines, []).map((d) => d.name)).toEqual(["Lemon tart"]);
  });
});

const NEGRONI = "c0000000-0000-4000-8000-0000000000a1";

/** Two current menus, one old, one draft, house B's; a list with one live, one retired and one of B's. */
function rows(): Record<string, Row[]> {
  n = 0;
  const r = twoHouses();
  r.cocktails = [
    { id: NEGRONI, restaurant_id: HOUSE_A, name: "Negroni", display_name: null, deleted_at: null },
    { id: "c0000000-0000-4000-8000-0000000000a2", restaurant_id: HOUSE_A, name: "House G&T", display_name: "Gin tonik", deleted_at: null },
    { id: "c0000000-0000-4000-8000-0000000000a3", restaurant_id: HOUSE_A, name: "Retired sour", display_name: null, deleted_at: "2026-10-01" },
    { id: "c0000000-0000-4000-8000-0000000000b1", restaurant_id: HOUSE_B, name: "B-only spritz", display_name: null, deleted_at: null },
  ];
  r.restaurant_menus = [
    { id: MENU_NOW, restaurant_id: HOUSE_A, status: "active" },
    { id: MENU_ALSO_NOW, restaurant_id: HOUSE_A, status: "active" },
    { id: MENU_OLD, restaurant_id: HOUSE_A, status: "archived" },
    { id: MENU_DRAFT, restaurant_id: HOUSE_A, status: "draft" },
    { id: MENU_B, restaurant_id: HOUSE_B, status: "active" },
  ];
  r.menu_items = [
    mline(MENU_NOW, HOUSE_A, "Margarita", "Cocktails", null, 12),
    mline(MENU_NOW, HOUSE_A, "NEGRONI", "Cocktails", null, 11), // listed as "Negroni"
    mline(MENU_NOW, HOUSE_A, "Gin Tonik", "Kokteyller", null, 9), // listed by its shown name
    mline(MENU_NOW, HOUSE_A, "Chianti", "Red", 48, 9),
    mline(MENU_ALSO_NOW, HOUSE_A, "Retired sour", "Signature Cocktails", null, 10),
    mline(MENU_ALSO_NOW, HOUSE_A, "B-only spritz", "Cocktails", null, 8),
    mline(MENU_OLD, HOUSE_A, "Old fashioned", "Cocktails", null, 13),
    mline(MENU_DRAFT, HOUSE_A, "Draft daiquiri", "Cocktails", null, 10),
    mline(MENU_NOW, HOUSE_A, "Gone gimlet", "Cocktails", null, 10, { status: "discarded" }),
    mline(MENU_B, HOUSE_B, "B-SECRET sazerac", "Cocktails", null, 777),
    mline(MENU_NOW, HOUSE_B, "B-STRAY mule", "Cocktails", null, 778),
  ];
  return r;
}

/** The real service; the cocktails insert takes an array, as supabase-js does. */
function service(r = rows(), opts: { insertFails?: boolean; readFails?: boolean } = {}) {
  const fake = fakeDb(r);
  const client: any = fake.db.getClient();
  const base = client.from;
  const inserts: Row[][] = [];
  client.from = (table: string) => {
    if (opts.readFails && table === "restaurant_menus") {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: "boom" } }) }) }) };
    }
    const q = base(table);
    if (table !== "cocktails") return q;
    q.insert = (batch: Row[]) => ({
      select: async () => {
        inserts.push(batch);
        if (opts.insertFails) return { data: null, error: { code: "08006", message: "connection lost" } };
        const made = batch.map((row, i) => ({ id: `c1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, deleted_at: null, display_name: null, ...row }));
        r.cocktails.push(...made);
        return { data: made, error: null };
      },
    });
    return q;
  };
  return { svc: new DishesService(fake.db, new RecipesService(fake.db)), inserts };
}

describe("DishesService.menuDrinks: the offer read from the current menu", () => {
  it("offers this house's current menus' cocktails that are not on its list", async () => {
    const out = await service().svc.menuDrinks(HOUSE_A);
    expect(out.currentMenus).toBe(2);
    expect(out.drinks).toEqual([
      { name: "Margarita", section: null, price: 12, pricesDiffer: false },
      { name: "Retired sour", section: "Signature Cocktails", price: 10, pricesDiffer: false },
      { name: "B-only spritz", section: null, price: 8, pricesDiffer: false },
    ]);
  });

  it("offers nothing, and says no menu is current, when none is", async () => {
    const r = rows();
    r.restaurant_menus = r.restaurant_menus.filter((m) => m.restaurant_id !== HOUSE_A || m.status !== "active");
    expect(await service(r).svc.menuDrinks(HOUSE_A)).toEqual({ currentMenus: 0, drinks: [] });
  });

  it("reads the whole list past 1,000 cocktails before it offers one", async () => {
    const r = rows();
    for (let i = 0; i < 1100; i++) {
      r.cocktails.push({ id: `c2000000-0000-4000-8000-${String(i).padStart(12, "0")}`, restaurant_id: HOUSE_A, name: `Drink ${i}`, display_name: null, deleted_at: null });
    }
    r.cocktails.push({ id: "cffffff0-0000-4000-8000-000000000000", restaurant_id: HOUSE_A, name: "margarita", display_name: null, deleted_at: null });
    const out = await service(r).svc.menuDrinks(HOUSE_A);
    expect(out.drinks.map((d) => d.name)).toEqual(["Retired sour", "B-only spritz"]);
  });

  it("refuses with a sentence, never an empty offer, when the menu cannot be read", async () => {
    await expect(service(rows(), { readFails: true }).svc.menuDrinks(HOUSE_A)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service(rows(), { readFails: true }).svc.menuDrinks(HOUSE_A)).rejects.toThrow(MENU_DRINKS_UNREAD);
  });
});

describe("DishesService.addMenuDrinks: the offer put on the list in one write", () => {
  it("makes the named drinks in this house in one insert, with the menu's section and price, marked as from the menu", async () => {
    const { svc, inserts } = service();
    const out = await svc.addMenuDrinks(HOUSE_A, ["Margarita", "Retired sour"]);
    expect(inserts).toEqual([
      [
        { restaurant_id: HOUSE_A, name: "Margarita", menu_section: null, price: 12, source: "menu" },
        { restaurant_id: HOUSE_A, name: "Retired sour", menu_section: "Signature Cocktails", price: 10, source: "menu" },
      ],
    ]);
    expect(out).toEqual({
      added: [
        { id: "c1000000-0000-4000-8000-000000000001", name: "Margarita" },
        { id: "c1000000-0000-4000-8000-000000000002", name: "Retired sour" },
      ],
      already: [],
      notAdded: [],
      notOffered: [],
    });
  });

  it("makes only the names asked for, matched folded, and then offers them no more", async () => {
    const { svc, inserts } = service();
    await svc.addMenuDrinks(HOUSE_A, ["MARGARİTA"]);
    expect(inserts.flat().map((d) => d.name)).toEqual(["Margarita"]);
    expect((await svc.menuDrinks(HOUSE_A)).drinks.map((d) => d.name)).toEqual(["Retired sour", "B-only spritz"]);
  });

  it("says a name no longer offered, and writes nothing when none is left", async () => {
    const { svc, inserts } = service();
    const out = await svc.addMenuDrinks(HOUSE_A, ["Negroni", "Chianti", "B-SECRET sazerac", "Old fashioned"]);
    expect(inserts).toEqual([]);
    expect(out).toEqual({ added: [], already: [], notAdded: [], notOffered: ["Negroni", "Chianti", "B-SECRET sazerac", "Old fashioned"] });
  });

  it("refuses with a sentence when the write fails, and claims nothing was added", async () => {
    const { svc } = service(rows(), { insertFails: true });
    await expect(svc.addMenuDrinks(HOUSE_A, ["Margarita"])).rejects.toThrow(MENU_DRINKS_NOT_ADDED);
    await expect(service(rows(), { insertFails: true }).svc.addMenuDrinks(HOUSE_A, ["Margarita"])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe("DishesController: only an owner or a manager reads or takes the drinks offer", () => {
  it.each(["menuDrinks", "addMenuDrinks"] as const)("%s is owner/manager only", (method) => {
    expect(Reflect.getMetadata(ROLES_KEY, DishesController.prototype[method])).toEqual(["owner", "manager"]);
  });
});
