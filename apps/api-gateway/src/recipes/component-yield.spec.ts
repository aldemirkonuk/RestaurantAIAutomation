/**
 * r105 drinks-3 (ADR 0397): set what one batch of a house-made component makes.
 * Owner/manager only, tenant-scoped, stored in the unit's base, a zero or
 * negative yield refused, the kind of unit never changed silently, and every
 * parent priced again from the new figure with the component chain untouched.
 */
import { INestApplication, ValidationPipe, BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DishesController } from "./dishes.controller";
import { DishesService, YIELD_NEEDS_AMOUNT, yieldUnitInUse } from "./dishes.service";
import { RecipesService } from "./recipes.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { B_DISH, FLOUR, HOUSE_A, HOUSE_B, TART, V_TART_1, V_TART_2, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

const SYRUP = "d0000000-0000-4000-8000-0000000000c1";
const BATCH = "d0000000-0000-4000-8000-0000000000c2";
const V_SYRUP = "e0000000-0000-4000-8000-0000000000c1";
const V_BATCH = "e0000000-0000-4000-8000-0000000000c2";

// recipe_qty_base as the database does it, for the units these specs use.
const FACTOR: Record<string, [number, string]> = { ml: [10, "ml10"], l: [10000, "ml10"], g: [1000, "mg"], kg: [1000000, "mg"], each: [1000, "each_milli"] };
const rpc = (name: string, a: Row) => {
  if (name !== "recipe_qty_base") return {};
  const f = FACTOR[a.p_unit];
  return { data: f ? [{ qty_base: Math.round(a.p_qty * f[0]), base_unit: f[1] }] : [] };
};

/** The tart takes 40 ml of syrup; the syrup is 500 g flour (1.00) to 700 ml. */
function house(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.dishes.push({ id: SYRUP, restaurant_id: HOUSE_A, name: "Simple syrup", yield_qty_base: 7000, yield_base_unit: "ml10", deleted_at: null });
  rows.recipe_current_dish.push({ dish_id: SYRUP, version_id: V_SYRUP, restaurant_id: HOUSE_A });
  rows.recipe_versions.push({ id: V_SYRUP, restaurant_id: HOUSE_A, dish_id: SYRUP, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
  rows.recipe_lines = [
    line("s1", V_SYRUP, HOUSE_A, 1, "Sugar", FLOUR, { qty_entered: 500, qty_base: 500_000 }),
    line("s2", V_SYRUP, HOUSE_A, 2, "Water", null, { role: "untracked", qty_entered: 500, unit_code: "ml", qty_base: 5000, base_unit: "ml10" }),
    line("t1", V_TART_2, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }),
  ];
  for (const v of rows.recipe_versions) if (v.id === V_TART_2) v.yield_serves = 1;
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

const services = (rows: Record<string, Row[]>) => {
  const { db } = fakeDb(rows, { rpc });
  const recipes = new RecipesService(db);
  return { dishes: new DishesService(db, recipes), recipes };
};
const yieldOf = (rows: Record<string, Row[]>, id = SYRUP) => rows.dishes.find((d) => d.id === id)!;
const tartCost = async (rows: Record<string, Row[]>) => ((await services(rows).recipes.getDishRecipe(HOUSE_A, TART, "owner")) as any).current.lines[0];

describe("who may set a yield", () => {
  let app: INestApplication;
  let base: string;
  const calls: Array<{ house: string; dish: string; dto: unknown }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DishesController],
      providers: [
        { provide: RecipesService, useValue: {} },
        { provide: DishesService, useValue: { setYield: async (house: string, dish: string, dto: unknown) => (calls.push({ house, dish, dto }), { id: dish }) } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = { userId: `user-${role}`, restaurantId: HOUSE_A, role };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  const patch = (role: string, body: unknown = { amount: 700, unit: "ml" }) =>
    fetch(`${base}/recipes/${HOUSE_A}/dishes/${SYRUP}/yield`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-role": role },
      body: JSON.stringify(body),
    });

  it("refuses staff with 403 and never reaches the service", async () => {
    calls.length = 0;
    for (const role of ["staff", "waiter", "bartender"]) expect((await patch(role)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("lets an owner and a manager through, and refuses a body that is not an amount and a known unit", async () => {
    calls.length = 0;
    for (const role of ["owner", "manager"]) expect((await patch(role)).status).toBe(200);
    expect(calls.map((c) => c.dto)).toEqual([{ amount: 700, unit: "ml" }, { amount: 700, unit: "ml" }]);
    expect((await patch("owner", { amount: "lots", unit: "ml" })).status).toBe(400);
    expect((await patch("owner", { amount: 5, unit: "bucket" })).status).toBe(400);
    expect(calls).toHaveLength(2);
  });
});

describe("setting a yield", () => {
  it("stores it in the unit's base: 700 ml is 7000 ml10, 1.5 l is 15000", async () => {
    const rows = house();
    const { dishes } = services(rows);
    const out = await dishes.setYield(HOUSE_A, SYRUP, { amount: 350, unit: "ml" });
    expect(out).toMatchObject({ id: SYRUP, name: "Simple syrup", yield: { amount: 350, unit: "ml", qtyBase: 3500, baseUnit: "ml10" } });
    expect(yieldOf(rows)).toMatchObject({ yield_qty_base: 3500, yield_base_unit: "ml10" });
    await dishes.setYield(HOUSE_A, SYRUP, { amount: 1.5, unit: "l" });
    expect(yieldOf(rows)).toMatchObject({ yield_qty_base: 15000, yield_base_unit: "ml10" });
  });

  it("gives a dish with no yield its first one, so a drink may draw it", async () => {
    const rows = house();
    const { dishes } = services(rows);
    await dishes.setYield(HOUSE_A, TART, { amount: 2, unit: "kg" });
    expect(yieldOf(rows, TART)).toMatchObject({ yield_qty_base: 2_000_000, yield_base_unit: "mg" });
  });

  it("is a 404 for another house's dish, a gone dish and a missing one, and writes nothing", async () => {
    const rows = house();
    rows.dishes.push({ id: "d0000000-0000-4000-8000-0000000000c9", restaurant_id: HOUSE_A, name: "Old", yield_qty_base: 100, yield_base_unit: "ml10", deleted_at: "2026-10-01" });
    const { dishes } = services(rows);
    for (const id of [B_DISH, "d0000000-0000-4000-8000-0000000000c9", "d0000000-0000-4000-8000-0000000000ff"]) {
      await expect(dishes.setYield(HOUSE_A, id, { amount: 700, unit: "ml" })).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(yieldOf(rows, B_DISH).yield_qty_base).toBeUndefined();
    expect(yieldOf(rows, "d0000000-0000-4000-8000-0000000000c9").yield_qty_base).toBe(100);
    // And the other house cannot reach this house's dish by naming its own.
    await expect(dishes.setYield(HOUSE_B, SYRUP, { amount: 1, unit: "l" })).rejects.toBeInstanceOf(NotFoundException);
    expect(yieldOf(rows).yield_qty_base).toBe(7000);
  });

  it("refuses a yield of zero or less, or not a number, in words, and leaves the yield as it was", async () => {
    const rows = house();
    const { dishes } = services(rows);
    for (const amount of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(dishes.setYield(HOUSE_A, SYRUP, { amount, unit: "ml" })).rejects.toThrow(new BadRequestException(YIELD_NEEDS_AMOUNT));
    }
    await expect(dishes.setYield(HOUSE_A, SYRUP, { amount: 0.01, unit: "ml" })).rejects.toThrow("too small");
    await expect(dishes.setYield(HOUSE_A, SYRUP, { amount: 5, unit: "bucket" })).rejects.toThrow("not one we know");
    await expect(dishes.setYield(HOUSE_A, SYRUP, { amount: 100_001, unit: "ml" })).rejects.toThrow("at most 100,000 ml");
    expect(yieldOf(rows)).toMatchObject({ yield_qty_base: 7000, yield_base_unit: "ml10" });
  });
});

describe("a yield edit prices every parent again", () => {
  it("the tart's 40 ml of syrup costs 0.06 at 700 ml, 0.11 at 350 ml and 0.03 at 1.4 l, with no other write", async () => {
    const rows = house();
    expect(await tartCost(rows)).toMatchObject({ costPerServe: 0.06, costPerServeExact: 0.057143, costBasis: "component" });
    const { dishes } = services(rows);
    await dishes.setYield(HOUSE_A, SYRUP, { amount: 350, unit: "ml" });
    expect(await tartCost(rows)).toMatchObject({ costPerServe: 0.11, costPerServeExact: 0.114286, costBasis: "component" });
    await dishes.setYield(HOUSE_A, SYRUP, { amount: 1.4, unit: "l" });
    expect(await tartCost(rows)).toMatchObject({ costPerServe: 0.03, costPerServeExact: 0.028571, costBasis: "component" });
  });

  it("a chain of components keeps its cycle and depth rules: the lines are not touched, a three-level chain is still priced from the new figure", async () => {
    const rows = house();
    rows.dishes.push({ id: BATCH, restaurant_id: HOUSE_A, name: "Sour batch", yield_qty_base: 10_000, yield_base_unit: "ml10", deleted_at: null });
    rows.recipe_current_dish.push({ dish_id: BATCH, version_id: V_BATCH, restaurant_id: HOUSE_A });
    rows.recipe_versions.push({ id: V_BATCH, restaurant_id: HOUSE_A, dish_id: BATCH, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
    rows.recipe_lines.push(
      line("b1", V_BATCH, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 350, unit_code: "ml", qty_base: 3500, base_unit: "ml10" }),
      line("b2", V_BATCH, HOUSE_A, 2, "Flour", FLOUR, { qty_entered: 200, qty_base: 200_000 }),
    );
    for (const l of rows.recipe_lines) if (l.id === "t1") Object.assign(l, { component_dish_id: BATCH, label: "Sour batch", qty_entered: 100, qty_base: 1000 });
    expect(await tartCost(rows)).toMatchObject({ costPerServe: 0.09, costBasis: "component" });
    const before = JSON.stringify([rows.recipe_lines, rows.recipe_versions, rows.recipe_current_dish]);
    await services(rows).dishes.setYield(HOUSE_A, SYRUP, { amount: 350, unit: "ml" });
    // The syrup's yield halves, so its 350 ml in the batch costs 1.00 and not 0.50: the batch is 1.00 + 0.40, 100 ml of it 0.14.
    expect(await tartCost(rows)).toMatchObject({ costPerServe: 0.14, costBasis: "component" });
    expect(JSON.stringify([rows.recipe_lines, rows.recipe_versions, rows.recipe_current_dish])).toBe(before);
  });
});

describe("the kind of unit is not changed silently", () => {
  it("refuses grams for a component a current drink draws in millilitres, and keeps the yield", async () => {
    const rows = house();
    const { dishes } = services(rows);
    await expect(dishes.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" })).rejects.toThrow(new BadRequestException(yieldUnitInUse("millilitres")));
    expect(yieldOf(rows)).toMatchObject({ yield_qty_base: 7000, yield_base_unit: "ml10" });
  });

  it("allows another unit of the same kind (ml to l), which is a rescale and not a change of kind", async () => {
    const rows = house();
    await services(rows).dishes.setYield(HOUSE_A, SYRUP, { amount: 0.7, unit: "l" });
    expect(yieldOf(rows)).toMatchObject({ yield_qty_base: 7000, yield_base_unit: "ml10" });
  });

  it("allows the change of kind when nothing draws it now, an old version alone does not count", async () => {
    const rows = house();
    // The tart's current version stops drawing the syrup; its first version still does.
    rows.recipe_lines = rows.recipe_lines.filter((l) => l.id !== "t1");
    rows.recipe_lines.push(line("t0", V_TART_1, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }));
    await services(rows).dishes.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" });
    expect(yieldOf(rows)).toMatchObject({ yield_qty_base: 500_000, yield_base_unit: "mg" });
  });

  it("says a failed read: the dish or its users unreadable changes nothing", async () => {
    const rows = house();
    const { db } = fakeDb(rows, { rpc });
    const real = db.getClient() as any;
    const broken = { ...real, from: (t: string) => (t === "recipe_lines" ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }) } : real.from(t)) };
    const svc = new DishesService({ getClient: () => broken } as any, new RecipesService(db));
    await expect(svc.setYield(HOUSE_A, SYRUP, { amount: 500, unit: "g" })).rejects.toThrow("Nothing was changed");
    expect(yieldOf(rows)).toMatchObject({ yield_qty_base: 7000, yield_base_unit: "ml10" });
  });
});
