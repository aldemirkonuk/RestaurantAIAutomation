import { HttpException } from "@nestjs/common";
import { RecipesService, STALE_SAVE } from "./recipes.service";

type Res = { data?: unknown; error?: unknown; count?: number };
/** A Supabase-shaped fake: `from(t)` records every method; awaiting yields `list[t]`, maybeSingle yields `single[t]`. */
function fakeDb(list: Record<string, Res>, single: Record<string, Res>, rpc?: Res) {
  const calls: string[] = [];
  const chain = (t: string): any =>
    new Proxy(
      {},
      {
        get: (_o, p: string) =>
          p === "then"
            ? (ok: (v: unknown) => unknown) => ok({ data: [], error: null, ...list[t] })
            : p === "maybeSingle"
              ? () => Promise.resolve({ data: null, error: null, ...single[t] })
              : (..._a: unknown[]) => (calls.push(`${t}.${p}`), chain(t)),
      },
    );
  const client = {
    from: (t: string) => (calls.push(`from:${t}`), chain(t)),
    rpc: jest.fn(async (name: string, _args?: unknown) => (calls.push(`rpc:${name}`), { data: null, error: null, ...rpc })),
  };
  return { db: { getClient: () => client } as any, calls, client };
}

const HOUSE = "8f2b6a52-7c1e-4d0b-9a8e-2b9d7c1e4a10";
const DRINK = "1c0ffee0-0000-4000-8000-000000000001";
const dto = {
  expectedVersionId: null,
  yieldServes: 1,
  lines: [{ role: "stocked" as const, inventoryId: null, label: "Gin", qty: 30, unit: "ml" }],
};

describe("RecipesService.saveRecipe: one rpc, the whole save", () => {
  it("makes exactly one rpc('save_recipe_version') and no table write", async () => {
    const { db, calls, client } = fakeDb({}, {}, { data: { version_id: "v1", version: 1, lines: [] } });
    const out = await new RecipesService(db).saveRecipe(HOUSE, DRINK, "u1", dto);
    expect(out).toEqual({ versionId: "v1", version: 1, lines: [] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls[0][0]).toBe("save_recipe_version");
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_restaurant: HOUSE, p_cocktail: DRINK, p_expected_version: null, p_author: "u1" });
    expect(calls.filter((c) => /from:|\.(insert|update|delete|upsert)$/.test(c))).toEqual([]);
  });

  const status = async (rpc: Res) => {
    const { db } = fakeDb({}, {}, rpc);
    try {
      await new RecipesService(db).saveRecipe(HOUSE, DRINK, "u1", dto);
      return { status: 200, message: "" };
    } catch (e) {
      const h = e as HttpException;
      return { status: h.getStatus(), message: (h.getResponse() as any).message };
    }
  };

  it("maps a stale refusal to 409 with the sentence", async () => {
    expect(await status({ error: { code: "RCP09", message: "x" } })).toEqual({ status: 409, message: STALE_SAVE });
  });

  it("maps any other refusal to 400 with the database's sentence", async () => {
    const s = await status({ error: { code: "RCP00", message: "Ingredient 1 (Gin) has a unit we do not know: shot." } });
    expect(s).toEqual({ status: 400, message: "Ingredient 1 (Gin) has a unit we do not know: shot." });
  });

  it("never answers 2xx for a failed or empty rpc", async () => {
    expect((await status({ error: { code: "57014", message: "timeout" } })).status).toBe(500);
    expect((await status({ data: null })).status).toBe(500);
  });
});

describe("RecipesService.getRecipe: money only for roles that see it", () => {
  const tables = () =>
    fakeDb(
      {
        recipe_versions: { data: null, count: 1 },
        cocktail_ingredients: { data: [] },
        recipe_lines: {
          data: [
            { id: "l1", position: 1, role: "stocked", inventory_id: "g", label: "Gin", qty_entered: 30, unit_code: "ml", qty_base: 300, base_unit: "ml10" },
          ],
        },
        restaurant_inventory: { data: [{ id: "g", display_name: "Gin", kind: "spirit", uom: "bottle", bottle_size_ml: 700 }] },
        inventory_lot_rollup: { data: [{ inventory_id: "g", has_invoice_cost: true, wac: 700, wac_qty: 1, live_qty: 1 }] },
      },
      {
        cocktails: { data: { id: DRINK, name: "Negroni", price: 450 } },
        recipe_current: { data: { version_id: "v1" } },
        recipe_versions: { data: { id: "v1", version: 1, yield_serves: 1, created_at: "2026-11-07" } },
      },
    );

  it("gives an owner the price and the cost per serve", async () => {
    const r: any = await new RecipesService(tables().db).getRecipe(HOUSE, DRINK, "owner");
    expect(r.cocktail.price).toBe(450);
    expect(r.cost).toEqual({ perServe: 30, perServeExact: 30, priced: 1, of: 1, complete: true, partial: 0 });
    expect(r.current.lines[0]).toMatchObject({ status: "linked", itemName: "Gin", costPerServe: 30 });
  });

  it("gives staff price:null and cost:null, and never reads lot cost for them", async () => {
    const t = tables();
    const r: any = await new RecipesService(t.db).getRecipe(HOUSE, DRINK, "staff");
    expect(r.cocktail.price).toBeNull();
    expect(r.cost).toBeNull();
    expect(r.current.lines[0]).toMatchObject({ status: "linked", costPerServe: null, costBasis: null });
    expect(t.calls).not.toContain("from:inventory_lot_rollup");
    expect(JSON.stringify(r)).not.toMatch(/confidence|restaurant_inventory|inventory_lot_rollup|recipe_lines/);
  });

  const withFigures = (more: Record<string, Res>) =>
    fakeDb(
      {
        recipe_versions: { data: null, count: 1 },
        cocktail_ingredients: { data: [] },
        recipe_lines: {
          data: [
            { id: "l1", position: 1, role: "stocked", inventory_id: "g", label: "Gin", qty_entered: 30, unit_code: "ml", qty_base: 300, base_unit: "ml10" },
            { id: "l2", position: 2, role: "stocked", inventory_id: null, label: "Campari", qty_entered: 30, unit_code: "ml", qty_base: 300, base_unit: "ml10" },
          ],
        },
        restaurant_inventory: { data: [{ id: "g", display_name: "Gin", kind: "spirit", uom: "bottle", bottle_size_ml: 700 }] },
        inventory_lot_rollup: { data: [{ inventory_id: "g", has_invoice_cost: true, wac: 700, wac_qty: 1, live_qty: 1 }] },
        item_nutrition: { data: [{ inventory_id: "g", basis: "100ml", energy_kcal: "222.0", fat_g: null, saturates_g: null, carbohydrate_g: "0.00", sugars_g: null, protein_g: null, salt_g: null, abv_pct: "40.0", energy_from_abv: false }] },
        item_allergens: { data: [{ inventory_id: "g", allergen: "milk", status: "free" }] },
        ...more,
      },
      {
        cocktails: { data: { id: DRINK, name: "Negroni", price: 450 } },
        recipe_current: { data: { version_id: "v1" } },
        recipe_versions: { data: { id: "v1", version: 1, yield_serves: 1, created_at: "2026-11-07" } },
      },
    );

  it("carries what is in a serve from the linked item's figures, for every role", async () => {
    const t = withFigures({});
    const r: any = await new RecipesService(t.db).getRecipe(HOUSE, DRINK, "staff");
    expect(r.whatIsIn.readable).toBe(true);
    expect(r.whatIsIn.figures.energyKcal).toEqual({ value: 66.6, atLeast: true, missing: ["Campari"] });
    expect(r.whatIsIn.figures.saltG).toEqual({ value: null, atLeast: false, missing: ["Campari", "Gin"] });
    expect(r.whatIsIn.notCounted).toEqual([{ label: "Campari", why: "it is not linked to anything on the shelf" }]);
    // 30 ml at a stated 40% is 12 ml of pure alcohol; Campari states nothing, so at least.
    expect(r.whatIsIn.figures.alcoholMl).toEqual({ value: 12, atLeast: true, missing: ["Campari"] });
    expect(r.whatIsIn.allergens.milk).toBe("not_stated");
    expect(t.calls).toContain("item_nutrition.eq");
    expect(t.calls).toContain("item_allergens.eq");
  });

  it("says a failed read of the figures failed, and still shows the recipe and its cost", async () => {
    const t = withFigures({ item_nutrition: { error: { message: 'relation "item_nutrition" does not exist' } } });
    const r: any = await new RecipesService(t.db).getRecipe(HOUSE, DRINK, "owner");
    expect(r.whatIsIn).toEqual({ readable: false, sentence: expect.stringContaining("could not be read") });
    expect(JSON.stringify(r.whatIsIn)).not.toContain("does not exist");
    expect(r.cost).toEqual({ perServe: null, perServeExact: null, priced: 1, of: 2, complete: false, partial: 0 });
    expect(r.current.lines).toHaveLength(2);
  });

  it("says a failed read failed instead of showing no recipe (ADR 0020)", async () => {
    const t = fakeDb({}, { cocktails: { data: { id: DRINK, name: "N" } }, recipe_current: { error: { message: "down" } } });
    await expect(new RecipesService(t.db).getRecipe(HOUSE, DRINK, "owner")).rejects.toMatchObject({ status: 503 });
  });

  it("refuses a drink that is not this house's", async () => {
    const t = fakeDb({}, { cocktails: { data: null } });
    await expect(new RecipesService(t.db).getRecipe(HOUSE, DRINK, "owner")).rejects.toMatchObject({ status: 404 });
  });
});
