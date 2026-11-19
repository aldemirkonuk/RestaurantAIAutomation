import "reflect-metadata";
import { INestApplication, NotFoundException, ServiceUnavailableException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DishesController } from "./dishes.controller";
import { DishesService, TAKE_OFF_UNREAD } from "./dishes.service";
import { RecipesService, DISH_NOT_THIS_HOUSE } from "./recipes.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { B_DISH, HOUSE_A, HOUSE_B, SOUP, TART, fakeDb, twoHouses, type Row } from "./dishes.testing";

/**
 * g2 menu gap: a dish the new menu no longer prints stayed live on /dishes
 * with nothing saying so. POST dishes/take-off-menu takes the named dishes off
 * the list in one request, but only those with no line of that name on the
 * current menu: the menu is read again here, so a stale page can never take
 * off a dish the menu now prints. The dish is soft-removed (its recipe
 * versions are kept), exactly as the one-dish take-off is.
 */

const MENU = "a0000000-0000-4000-8000-000000000001";
const MENU_B = "a0000000-0000-4000-8000-000000000009";
const STEW = "d0000000-0000-4000-8000-0000000000d2"; // no line on the menu
const GONE = "d0000000-0000-4000-8000-0000000000d6"; // no line on the menu either
const PIE = "d0000000-0000-4000-8000-0000000000d1"; // two lines that disagree: it IS on the menu

let n = 0;
const mline = (menu: string, house: string, name: string, bottle: number | null): Row => ({
  id: `b0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  menu_id: menu, restaurant_id: house, name, category: "Food", bottle_price: bottle, by_glass_price: null, status: "approved",
});

function rows(): Record<string, Row[]> {
  n = 0;
  const r = twoHouses();
  r.dishes.push(
    { id: STEW, restaurant_id: HOUSE_A, name: "Lamb stew", menu_section: null, price: 15, deleted_at: null },
    { id: GONE, restaurant_id: HOUSE_A, name: "Fish pie", menu_section: null, price: 14, deleted_at: null },
    { id: PIE, restaurant_id: HOUSE_A, name: "Apple pie", menu_section: null, price: 8, deleted_at: null },
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
    mline(MENU_B, HOUSE_B, "Lamb stew", 30),
  ];
  return r;
}

const live = (r: Record<string, Row[]>, id: string) => r.dishes.find((d) => d.id === id)!.deleted_at === null;
function service(r = rows()) {
  const fake = fakeDb(r);
  return { svc: new DishesService(fake.db, new RecipesService(fake.db)), r, fake };
}

describe("take the dishes the menu does not print off the list (g2 menu gap)", () => {
  it("a dish with no line of its name on the current menu is taken off, and a dish the menu prints is not", async () => {
    const { svc, r } = service();
    const out = await svc.takeOffMenu(HOUSE_A, [STEW, GONE, TART, PIE]);
    expect(out.removed).toEqual([
      { id: STEW, name: "Lamb stew" },
      { id: GONE, name: "Fish pie" },
    ]);
    expect(out.skipped).toEqual([
      { id: TART, name: "Lemon tart", why: "A line of that name is on the current menu." },
      { id: PIE, name: "Apple pie", why: "A line of that name is on the current menu." },
    ]);
    expect(live(r, STEW)).toBe(false);
    expect(live(r, GONE)).toBe(false);
    expect(live(r, TART)).toBe(true);
    expect(live(r, PIE)).toBe(true);
  });

  it("the take-off is soft: the row stays, with its time", async () => {
    const { svc, r } = service();
    await svc.takeOffMenu(HOUSE_A, [STEW]);
    expect(r.dishes.find((d) => d.id === STEW)).toBeDefined();
    expect(typeof r.dishes.find((d) => d.id === STEW)!.deleted_at).toBe("string");
  });

  it("a house with no current menu takes nothing off, and says why", async () => {
    const r = rows();
    r.restaurant_menus = [];
    const { svc } = service(r);
    const out = await svc.takeOffMenu(HOUSE_A, [STEW]);
    expect(out.removed).toEqual([]);
    expect(out.skipped).toEqual([{ id: STEW, name: "Lamb stew", why: "The house has no current menu." }]);
    expect(live(r, STEW)).toBe(true);
  });

  it("another house's dish is a 404 and nothing is taken off, not even the house's own dishes", async () => {
    const { svc, r } = service();
    await expect(svc.takeOffMenu(HOUSE_A, [STEW, B_DISH])).rejects.toEqual(new NotFoundException(DISH_NOT_THIS_HOUSE));
    expect(live(r, STEW)).toBe(true);
  });

  it("a failed menu read is a 503 with its sentence, and nothing is taken off", async () => {
    const { svc, fake, r } = service();
    const client = fake.db.getClient() as any;
    const from = client.from;
    client.from = (t: string) => {
      if (t === "menu_items" || t === "restaurant_menus") throw new Error("down");
      return from(t);
    };
    await expect(svc.takeOffMenu(HOUSE_A, [STEW])).rejects.toEqual(new ServiceUnavailableException(TAKE_OFF_UNREAD));
    expect(live(r, STEW)).toBe(true);
  });

  it("the same dish named twice is taken off once", async () => {
    const { svc } = service();
    const out = await svc.takeOffMenu(HOUSE_A, [STEW, STEW]);
    expect(out.removed).toEqual([{ id: STEW, name: "Lamb stew" }]);
  });
});

describe("POST recipes/:house/dishes/take-off-menu (real guards on the route)", () => {
  let app: INestApplication;
  let base: string;
  const calls: string[][] = [];
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DishesController],
      providers: [
        { provide: RecipesService, useValue: {} },
        { provide: DishesService, useValue: { takeOffMenu: async (_h: string, ids: string[]) => (calls.push(ids), { removed: [], skipped: [] }) } },
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
    fetch(`${base}/recipes/${HOUSE_A}/dishes/take-off-menu`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": role },
      body: JSON.stringify(body),
    });

  it("refuses staff with 403 and never reaches the service", async () => {
    calls.length = 0;
    expect((await post("staff", { ids: [STEW] })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("lets an owner and a manager through, and refuses an empty or malformed list with 400", async () => {
    calls.length = 0;
    expect((await post("owner", { ids: [STEW] })).status).toBe(201);
    expect((await post("manager", { ids: [STEW, SOUP] })).status).toBe(201);
    expect((await post("owner", { ids: [] })).status).toBe(400);
    expect((await post("owner", { ids: ["not-an-id"] })).status).toBe(400);
    expect(calls).toEqual([[STEW], [STEW, SOUP]]);
  });
});
