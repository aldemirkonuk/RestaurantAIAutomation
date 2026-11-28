import "reflect-metadata";
import { INestApplication, NotFoundException, ServiceUnavailableException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DishesController } from "./dishes.controller";
import { DishesService, TAKE_PRICES_UNREAD } from "./dishes.service";
import { RecipesService, DISH_NOT_THIS_HOUSE } from "./recipes.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { B_DISH, HOUSE_A, HOUSE_B, SOUP, TART, fakeDb, twoHouses, type Row } from "./dishes.testing";

/**
 * g1 menu gap: a re-uploaded menu never moved a dish's price, and each dish
 * needed its own confirm. POST dishes/take-menu-prices sets the named dishes
 * to the current menu's one price, in one request, and says why it left any.
 */

const MENU = "a0000000-0000-4000-8000-000000000001";
const MENU_B = "a0000000-0000-4000-8000-000000000009";
const PIE = "d0000000-0000-4000-8000-0000000000d1"; // two lines that disagree
const STEW = "d0000000-0000-4000-8000-0000000000d2"; // no line on the menu
const BREAD = "d0000000-0000-4000-8000-0000000000d3"; // a line with no price
const DUO = "d0000000-0000-4000-8000-0000000000d4"; // a line with two prices
const SAME = "d0000000-0000-4000-8000-0000000000d5"; // already the menu's price

let n = 0;
const mline = (menu: string, house: string, name: string, bottle: number | null, glass: number | null = null): Row => ({
  id: `b0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  menu_id: menu, restaurant_id: house, name, category: "Food", bottle_price: bottle, by_glass_price: glass, status: "approved",
});

function rows(): Record<string, Row[]> {
  n = 0;
  const r = twoHouses();
  // The tart is 9 here and 11 on the menu; the soup has no price of its own.
  r.dishes.push(
    { id: PIE, restaurant_id: HOUSE_A, name: "Apple pie", menu_section: null, price: 8, deleted_at: null },
    { id: STEW, restaurant_id: HOUSE_A, name: "Lamb stew", menu_section: null, price: 15, deleted_at: null },
    { id: BREAD, restaurant_id: HOUSE_A, name: "Plain bread", menu_section: null, price: 2, deleted_at: null },
    { id: DUO, restaurant_id: HOUSE_A, name: "Pasta", menu_section: null, price: 10, deleted_at: null },
    { id: SAME, restaurant_id: HOUSE_A, name: "Garden salad", menu_section: null, price: 7, deleted_at: null },
  );
  r.restaurant_menus = [
    { id: MENU, restaurant_id: HOUSE_A, status: "active" },
    { id: MENU_B, restaurant_id: HOUSE_B, status: "active" },
  ];
  r.menu_items = [
    mline(MENU, HOUSE_A, "Lemon tart", 11),
    mline(MENU, HOUSE_A, "Bread soup", 6.5),
    mline(MENU, HOUSE_A, "Apple pie", 9),
    mline(MENU, HOUSE_A, "apple  PIE", 10),
    mline(MENU, HOUSE_A, "Plain bread", null),
    mline(MENU, HOUSE_A, "Pasta", 12, 9),
    mline(MENU, HOUSE_A, "Garden salad", 7),
    mline(MENU_B, HOUSE_B, "Lemon tart", 99),
  ];
  return r;
}

const price = (r: Record<string, Row[]>, id: string) => r.dishes.find((d) => d.id === id)!.price;
function service(r = rows()) {
  const fake = fakeDb(r);
  return { svc: new DishesService(fake.db, new RecipesService(fake.db)), r, fake };
}

describe("take the menu's prices onto the dishes (g1 menu gap)", () => {
  it("a dish with one differing menu price is updated, and an unpriced dish takes the menu's", async () => {
    const { svc, r } = service();
    const out = await svc.takeMenuPrices(HOUSE_A, [TART, SOUP]);
    expect(out.changed).toEqual([
      { id: TART, name: "Lemon tart", from: 9, to: 11 },
      { id: SOUP, name: "Bread soup", from: null, to: 6.5 },
    ]);
    expect(out.skipped).toEqual([]);
    expect(price(r, TART)).toBe(11);
    expect(price(r, SOUP)).toBe(6.5);
  });

  it("a dish already at the menu's price is left, and says so", async () => {
    const { svc, r } = service();
    const out = await svc.takeMenuPrices(HOUSE_A, [SAME]);
    expect(out.changed).toEqual([]);
    expect(out.skipped).toEqual([{ id: SAME, name: "Garden salad", why: "Its price is already the menu's." }]);
    expect(price(r, SAME)).toBe(7);
  });

  it("every dish left is named with its reason, and none of them is written", async () => {
    const { svc, r } = service();
    const out = await svc.takeMenuPrices(HOUSE_A, [PIE, STEW, BREAD, DUO]);
    expect(out.changed).toEqual([]);
    expect(out.skipped.map((s) => [s.id, s.why])).toEqual([
      [PIE, "Lines of that name on the current menu state different prices."],
      [STEW, "No line of that name is on the current menu."],
      [BREAD, "The menu line of that name states no price."],
      [DUO, "The menu line of that name states more than one price; open the dish to choose one."],
    ]);
    expect([PIE, STEW, BREAD, DUO].map((id) => price(r, id))).toEqual([8, 15, 2, 10]);
  });

  it("changes some and leaves others in one answer", async () => {
    const { svc, r } = service();
    const out = await svc.takeMenuPrices(HOUSE_A, [TART, PIE, SAME]);
    expect(out.changed.map((c) => c.id)).toEqual([TART]);
    expect(out.skipped.map((s) => s.id)).toEqual([PIE, SAME]);
    expect(price(r, TART)).toBe(11);
    expect(price(r, PIE)).toBe(8);
  });

  it("another house's dish is a 404 and nothing is written, not even the house's own dishes", async () => {
    const { svc, r } = service();
    await expect(svc.takeMenuPrices(HOUSE_A, [TART, B_DISH])).rejects.toEqual(new NotFoundException(DISH_NOT_THIS_HOUSE));
    expect(price(r, TART)).toBe(9);
  });

  it("a house with no current menu changes nothing and says why", async () => {
    const r = rows();
    r.restaurant_menus = [];
    const out = await service(r).svc.takeMenuPrices(HOUSE_A, [TART]);
    expect(out.changed).toEqual([]);
    expect(out.skipped[0].why).toBe("The house has no current menu.");
  });

  it("a failed menu read is a 503 with its sentence, and nothing is written", async () => {
    const { svc, fake, r } = service();
    const client = fake.db.getClient() as any;
    const from = client.from;
    client.from = (t: string) => {
      if (t === "menu_items" || t === "restaurant_menus") throw new Error("down");
      return from(t);
    };
    await expect(svc.takeMenuPrices(HOUSE_A, [TART])).rejects.toEqual(new ServiceUnavailableException(TAKE_PRICES_UNREAD));
    expect(price(r, TART)).toBe(9);
  });
});

describe("POST recipes/:house/dishes/take-menu-prices (real guards on the route)", () => {
  let app: INestApplication;
  let base: string;
  const calls: string[][] = [];
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DishesController],
      providers: [
        { provide: RecipesService, useValue: {} },
        { provide: DishesService, useValue: { takeMenuPrices: async (_h: string, ids: string[]) => (calls.push(ids), { changed: [], skipped: [] }) } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = { userId: `u-${role}`, restaurantId: HOUSE_A, role };
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(() => app.close());
  const post = (role: string, body: unknown) =>
    fetch(`${base}/recipes/${HOUSE_A}/dishes/take-menu-prices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": role },
      body: JSON.stringify(body),
    });

  it("refuses staff with 403 and never reaches the service", async () => {
    calls.length = 0;
    expect((await post("staff", { ids: [TART] })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("lets an owner and a manager through, and refuses an empty or malformed list with 400", async () => {
    calls.length = 0;
    expect((await post("owner", { ids: [TART] })).status).toBe(201);
    expect((await post("manager", { ids: [TART, SOUP] })).status).toBe(201);
    expect((await post("owner", { ids: [] })).status).toBe(400);
    expect((await post("owner", { ids: ["not-an-id"] })).status).toBe(400);
    expect(calls).toEqual([[TART], [TART, SOUP]]);
  });
});
