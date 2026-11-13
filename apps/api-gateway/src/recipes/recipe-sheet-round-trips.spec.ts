import { NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { RecipesService } from "./recipes.service";
import { B_DISH, HOUSE_A, TART, fakeDb, twoHouses, type Row } from "./dishes.testing";

/**
 * r28 recipes audit, gap 17: opening a recipe sheet made 5 round trips one
 * after another (house check, pointer, version, prices, then what is in a
 * serve), and the cost preview read prices only after every unit conversion
 * came back. Reads that need nothing from each other now go at once.
 *
 * The fake below answers each read one macrotask later and counts "waves":
 * a read started after an answer came back is one wave deeper. The depth of
 * the deepest read is the number of round trips a reader waits through.
 */
function wavesOf(rows: Record<string, Row[]>) {
  const fake = fakeDb(rows);
  const inner = fake.db.getClient() as any;
  let done = 0; // waves answered so far
  let deepest = 0;
  const started: Array<{ table: string; wave: number }> = [];
  const later = <T>(wave: number, v: () => T) =>
    new Promise<T>((ok) =>
      setTimeout(() => {
        done = Math.max(done, wave + 1);
        deepest = Math.max(deepest, wave + 1);
        ok(v());
      }, 0),
    );
  const wrap = (q: any, table: string): any =>
    new Proxy(q, {
      get(target, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
            const wave = done;
            started.push({ table, wave });
            return later(wave, () => new Promise((r) => target.then(r))).then(ok, bad);
          };
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => {
            const wave = done;
            started.push({ table, wave });
            return later(wave, () => target[prop]()).then((x) => x);
          };
        }
        const v = target[prop];
        return typeof v === "function" ? (...a: unknown[]) => wrap(v.apply(target, a), table) : v;
      },
    });
  const client = {
    from: (t: string) => wrap(inner.from(t), t),
    rpc: (name: string, args: Row) => {
      const wave = done;
      started.push({ table: `rpc:${name}`, wave });
      return later(wave, () => inner.rpc(name, args)).then((x) => x);
    },
  };
  const svc = new RecipesService({ getClient: () => client } as unknown as DatabaseService);
  return { svc, depth: () => deepest, started };
}

const waveOf = (started: Array<{ table: string; wave: number }>, table: string) =>
  Math.min(...started.filter((s) => s.table === table).map((s) => s.wave));

describe("a recipe sheet reads what it can at once (r28 gap 17)", () => {
  it("a dish's sheet opens in 3 round trips, not 5", async () => {
    const { svc, depth, started } = wavesOf(twoHouses());
    const out = await svc.getDishRecipe(HOUSE_A, TART, "owner");
    expect(out.current).not.toBeNull();
    expect(depth()).toBe(3);
    // The house check and the pointer go together; prices and what is in a serve go together.
    expect(waveOf(started, "dishes")).toBe(waveOf(started, "recipe_current_dish"));
    expect(waveOf(started, "restaurant_inventory")).toBe(waveOf(started, "item_nutrition"));
  });

  it("a drink's sheet opens in 3 round trips, not 5", async () => {
    const rows = twoHouses();
    const DRINK = "c0000000-0000-4000-8000-0000000000a1";
    rows.cocktails = [{ id: DRINK, restaurant_id: HOUSE_A, name: "Tart fizz", display_name: null, price: 10, deleted_at: null }];
    rows.recipe_current = [{ cocktail_id: DRINK, version_id: rows.recipe_versions[1].id, restaurant_id: HOUSE_A }];
    rows.recipe_versions[1].cocktail_id = DRINK;
    rows.cocktail_ingredients = [];
    const { svc, depth, started } = wavesOf(rows);
    const out = await svc.getRecipe(HOUSE_A, DRINK, "owner");
    expect(out.current).not.toBeNull();
    expect(depth()).toBe(3);
    expect(waveOf(started, "cocktails")).toBe(waveOf(started, "recipe_current"));
    expect(waveOf(started, "restaurant_inventory")).toBe(waveOf(started, "item_nutrition"));
  });

  it("another house's dish is still a 404, and its figures are never answered", async () => {
    const { svc } = wavesOf(twoHouses());
    await expect(svc.getDishRecipe(HOUSE_A, B_DISH, "owner")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("the cost preview reads prices with the unit conversions, not after them", async () => {
    const rows = twoHouses();
    const { svc, started } = wavesOf(rows);
    await svc.previewDishCost(HOUSE_A, TART, {
      lines: [{ role: "stocked", label: "Flour", inventoryId: "f0000000-0000-4000-8000-0000000000a1", qtyEntered: 250, unitCode: "g" }],
    } as any);
    expect(waveOf(started, "restaurant_inventory")).toBe(waveOf(started, "rpc:recipe_qty_base"));
  });
});
