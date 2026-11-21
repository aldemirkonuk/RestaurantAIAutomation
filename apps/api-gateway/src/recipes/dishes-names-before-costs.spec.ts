import "reflect-metadata";
import { ServiceUnavailableException } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { DISH_FIGURES_UNREAD, DishesService } from "./dishes.service";
import { DishesController } from "./dishes.controller";
import { RecipesService } from "./recipes.service";
import { FLOUR, HOUSE_A, SOUP, TART, fakeDb, line, twoHouses, type Row } from "./dishes.testing";

/**
 * r41 recipes audit, gaps 2 and 3. /dishes showed no dish name until every
 * line of every dish was priced (about 6 database round trips one after
 * another for 120 dishes), and one failed pricing read took the names and the
 * allergens away with the costs. The names are now one read; the figures are
 * `dishFigures`, read beside them, and a failed pricing read leaves the costs
 * unread and keeps everything else.
 */

/** `n` dishes, each with its own current version and one flour line. */
function many(n: number): Record<string, Row[]> {
  const rows = twoHouses();
  const id = (p: string, i: number) => `${p}0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  for (let i = 0; i < n; i++) {
    rows.dishes.push({ id: id("7", i), restaurant_id: HOUSE_A, name: `Plate ${i}`, menu_section: null, price: 10, deleted_at: null });
    rows.recipe_current_dish.push({ dish_id: id("7", i), version_id: id("8", i), restaurant_id: HOUSE_A });
    rows.recipe_versions.push({ id: id("8", i), restaurant_id: HOUSE_A, dish_id: id("7", i), owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
    rows.recipe_lines.push(line(id("9", i), id("8", i), HOUSE_A, 1, "Flour", FLOUR));
  }
  return rows;
}

/**
 * The real services over the fake, with each database read held for a tick.
 * `depth` is how many reads ran one after another before the answer: a read
 * that starts after another has finished is one deeper than it.
 */
function measured(rows: Record<string, Row[]>, failTable?: string) {
  const fake = fakeDb(rows);
  const client: any = fake.db.getClient();
  const base = client.from;
  const st = { depth: 0, reads: 0, tables: [] as string[] };
  const hold = async <T>(read: () => T): Promise<T> => {
    const d = st.depth + 1;
    st.reads++;
    await new Promise((r) => setTimeout(r, 0));
    st.depth = Math.max(st.depth, d);
    return read();
  };
  client.from = (t: string) => {
    const q = base(t);
    const then = q.then;
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      st.tables.push(t);
      return hold(() => (t === failTable ? ok({ data: null, error: { message: `${t} down` } }) : then(ok, bad)));
    };
    return q;
  };
  const rpc = client.rpc;
  client.rpc = (...a: unknown[]) => hold(() => rpc(...a));
  return { dishes: new DishesService(fake.db, new RecipesService(fake.db)), st };
}

describe("/dishes: the names come in one read, before any cost", () => {
  it.each([120, 300])("%i dishes: the names are one read of `dishes`, nothing priced", async (n) => {
    const { dishes, st } = measured(many(n));
    const out = await dishes.listDishes(HOUSE_A, "owner");
    expect(out).toHaveLength(n + 2);
    expect(st.tables).toEqual(["dishes"]);
    expect(st.depth).toBe(1);
  });

  it("the figures of 120 dishes still take their own waves, beside the names", async () => {
    const { dishes, st } = measured(many(120));
    const out = await dishes.dishFigures(HOUSE_A, "owner");
    expect(out.dishes).toHaveLength(122);
    expect(st.depth).toBeGreaterThanOrEqual(4);
  });

  it("a name row carries its name, section and price, and no figure", async () => {
    const { dishes } = measured(twoHouses());
    const out = await dishes.listDishes(HOUSE_A, "owner");
    expect(out).toEqual([
      { id: SOUP, name: "Bread soup", section: null, price: null },
      { id: TART, name: "Lemon tart", section: "Desserts", price: 9 },
    ]);
  });

  it("staff read the names with no price", async () => {
    const { dishes } = measured(twoHouses());
    expect((await dishes.listDishes(HOUSE_A, "staff")).map((d) => d.price)).toEqual([null, null]);
  });
});

describe("/dishes figures: a failed pricing read leaves only the costs unread", () => {
  it("every cost is null and said unread; the recipes and allergens still show", async () => {
    const rows = twoHouses();
    rows.item_allergens = [{ id: "a1", restaurant_id: HOUSE_A, inventory_id: FLOUR, allergen: "gluten", status: "contains" }];
    const { dishes } = measured(rows, "restaurant_inventory");
    const out = await dishes.dishFigures(HOUSE_A, "owner");
    expect(out.costsUnread).toBe(true);
    const tart = out.dishes.find((d) => d.dishId === TART)!;
    expect(tart).toMatchObject({ hasRecipe: true, yieldServes: 8, lineCount: 3, cost: null, price: 9 });
    expect(tart.allergens).toMatchObject({ readable: true, status: { gluten: "contains" } });
    expect(out.dishes.every((d) => d.cost === null)).toBe(true);
  });

  it("a read that prices says its costs are read", async () => {
    const { dishes } = measured(twoHouses());
    const out = await dishes.dishFigures(HOUSE_A, "owner");
    expect(out.costsUnread).toBe(false);
    expect(out.dishes.find((d) => d.dishId === TART)!.cost).toMatchObject({ priced: 2, of: 3 });
  });

  it("staff never price, so never read costs as unread", async () => {
    const { dishes, st } = measured(twoHouses(), "restaurant_inventory");
    const out = await dishes.dishFigures(HOUSE_A, "staff");
    expect(out.costsUnread).toBe(false);
    expect(st.tables).not.toContain("restaurant_inventory");
    expect(out.dishes.every((d) => d.cost === null && d.price === null)).toBe(true);
  });

  it("a failed recipe read is a 503 that says so; the names are read apart and still answer", async () => {
    const { dishes } = measured(twoHouses(), "recipe_current_dish");
    await expect(dishes.dishFigures(HOUSE_A, "owner")).rejects.toThrow(new ServiceUnavailableException(DISH_FIGURES_UNREAD));
    expect((await dishes.listDishes(HOUSE_A, "owner")).map((d) => d.name)).toEqual(["Bread soup", "Lemon tart"]);
  });

  it("a caller that does not ask to keep going (the drawer, /cocktails) still fails whole", async () => {
    const { dishes } = measured(twoHouses(), "restaurant_inventory");
    await expect(dishes.figures(HOUSE_A, [TART], true, "said")).rejects.toThrow("said");
  });
});

describe("/dishes figures route", () => {
  it("is declared before `dishes/:dishId`, which would take `figures` for a dish id", () => {
    const proto = DishesController.prototype as unknown as Record<string, object>;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== "constructor" && Reflect.hasMetadata(PATH_METADATA, proto[n]))
      .map((n) => Reflect.getMetadata(PATH_METADATA, proto[n]) as string);
    const figures = paths.indexOf(":restaurantId/dishes/figures");
    expect(figures).toBeGreaterThan(-1);
    expect(figures).toBeLessThan(paths.indexOf(":restaurantId/dishes/:dishId"));
  });
});
