import { RecipesService } from "./recipes.service";

const HOUSE = "8f2b6a52-7c1e-4d0b-9a8e-2b9d7c1e4a10";
const DRINK = "1c0ffee0-0000-4000-8000-000000000001";
const GIN = "6e1c0000-0000-4000-8000-000000000001";
const OTHER_HOUSE_ITEM = "6e1c0000-0000-4000-8000-000000000002";

/** The database's recipe_qty_base for the units these specs use (migration 20270425100000:88). */
const FACTOR: Record<string, [number, string]> = { ml: [10, "ml10"], cl: [100, "ml10"], g: [1000, "mg"] };

type Rows = Record<string, unknown[]>;
/** A Supabase-shaped fake that records every call, including the arguments of each filter. */
function fakeDb(opts: { cocktail?: unknown; rows?: Rows }) {
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const chain = (t: string): any =>
    new Proxy(
      {},
      {
        get: (_o, p: string) =>
          p === "then"
            ? (ok: (v: unknown) => unknown) => ok({ data: opts.rows?.[t] ?? [], error: null })
            : p === "maybeSingle"
              ? () => Promise.resolve({ data: opts.cocktail ?? null, error: null })
              : (...a: unknown[]) => (calls.push(`${t}.${p}(${a.map((x) => JSON.stringify(x)).join(",")})`), chain(t)),
      },
    );
  const client = {
    from: (t: string) => (calls.push(`from:${t}`), chain(t)),
    rpc: jest.fn(async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      const f = FACTOR[args.p_unit];
      return { data: f ? { qty_base: Math.round(args.p_qty * f[0]), base_unit: f[1] } : null, error: null };
    }),
  };
  return { db: { getClient: () => client } as any, calls, rpcCalls };
}

const house = { id: DRINK, name: "Negroni", price: 450 };
const shelf = {
  restaurant_inventory: [{ id: GIN, display_name: "Gin", kind: "spirit", uom: "bottle", bottle_size_ml: 700 }],
  inventory_lot_rollup: [{ inventory_id: GIN, has_invoice_cost: true, wac: 28, wac_qty: 1, live_qty: 1 }],
  // The invoice figure a serve is costed from (r28 gap 3), one verified bottle at 28.
  inventory_lot_invoice_cost: [{ inventory_id: GIN, invoice_wac: 28, invoice_qty: 1, settled_qty: 1, stock_qty: 1 }],
};
const gin50 = { role: "stocked" as const, inventoryId: GIN, qtyEntered: 50, unitCode: "ml" };

describe("RecipesService.previewCost: an unsaved draft priced, nothing written", () => {
  it("prices 50 ml of a 700 ml bottle at WAC 28 as 2.00 a serve", async () => {
    const t = fakeDb({ cocktail: house, rows: shelf });
    const out = await new RecipesService(t.db).previewCost(HOUSE, DRINK, { yieldServes: 1, lines: [gin50] });
    expect(out).toMatchObject({ perServe: 2, perServeExact: 2, priced: 1, of: 1, complete: true, partial: 0 });
    expect(out.lines).toEqual([{ status: "linked", costPerServe: 2, costBasis: expect.any(String) }]);
  });

  it("divides by the serves the draft makes", async () => {
    const t = fakeDb({ cocktail: house, rows: shelf });
    const out = await new RecipesService(t.db).previewCost(HOUSE, DRINK, { yieldServes: 4, lines: [gin50] });
    expect(out.perServe).toBe(0.5);
  });

  it("asks the database once per distinct quantity and unit", async () => {
    const t = fakeDb({ cocktail: house, rows: shelf });
    await new RecipesService(t.db).previewCost(HOUSE, DRINK, { yieldServes: 1, lines: [gin50, gin50, { ...gin50, qtyEntered: 5, unitCode: "cl" }] });
    expect(t.rpcCalls.map((c) => c.name)).toEqual(["recipe_qty_base", "recipe_qty_base"]);
  });

  it("refuses another house's drink with the 404 a read gives", async () => {
    const t = fakeDb({ cocktail: null, rows: shelf });
    await expect(new RecipesService(t.db).previewCost(HOUSE, DRINK, { yieldServes: 1, lines: [gin50] })).rejects.toMatchObject({ status: 404 });
    expect(t.rpcCalls).toEqual([]);
  });

  it("reads items and lots scoped to the house, and leaves an item that is not its own unpriced, never 0", async () => {
    // The scoped read finds nothing for an id the house does not own.
    const t = fakeDb({ cocktail: house, rows: { restaurant_inventory: [], inventory_lot_rollup: [] } });
    const out = await new RecipesService(t.db).previewCost(HOUSE, DRINK, {
      yieldServes: 1,
      lines: [{ ...gin50, inventoryId: OTHER_HOUSE_ITEM }],
    });
    expect(out.complete).toBe(false);
    expect(out.perServe).toBeNull();
    expect(out.lines[0]).toMatchObject({ status: "not_linked", costPerServe: null });
    expect(t.calls.filter((c) => c.startsWith("restaurant_inventory.eq") || c.startsWith("inventory_lot_rollup.eq"))).toEqual(
      expect.arrayContaining([`restaurant_inventory.eq("restaurant_id","${HOUSE}")`, `inventory_lot_rollup.eq("restaurant_id","${HOUSE}")`]),
    );
    expect(t.calls).toContain(`inventory_lot_invoice_cost.eq("restaurant_id","${HOUSE}")`);
  });

  it("gives an item with no recorded cost a null line cost", async () => {
    const t = fakeDb({
      cocktail: house,
      rows: { restaurant_inventory: shelf.restaurant_inventory, inventory_lot_rollup: [] },
    });
    const out = await new RecipesService(t.db).previewCost(HOUSE, DRINK, { yieldServes: 1, lines: [gin50] });
    expect(out.lines[0].costPerServe).toBeNull();
    expect(out.perServe).toBeNull();
    expect(out.complete).toBe(false);
  });

  it("leaves a unit the database does not know unpriced, never free", async () => {
    const t = fakeDb({ cocktail: house, rows: shelf });
    const out = await new RecipesService(t.db).previewCost(HOUSE, DRINK, { yieldServes: 1, lines: [{ ...gin50, unitCode: "pint" }] });
    expect(out.lines[0].costPerServe).toBeNull();
    expect(out.perServe).toBeNull();
  });

  it("does not count an untracked line, and sends it nowhere", async () => {
    const t = fakeDb({ cocktail: house, rows: shelf });
    const out = await new RecipesService(t.db).previewCost(HOUSE, DRINK, {
      yieldServes: 1,
      lines: [gin50, { role: "untracked", inventoryId: null, qtyEntered: 1, unitCode: "each" }],
    });
    expect(out.lines[1]).toMatchObject({ status: "untracked", costPerServe: null });
    expect(out).toMatchObject({ perServe: 2, of: 1, complete: true });
    expect(t.rpcCalls).toHaveLength(1);
  });

  it("writes nothing: no insert, update, upsert or delete, and no save_recipe_version", async () => {
    const t = fakeDb({ cocktail: house, rows: shelf });
    await new RecipesService(t.db).previewCost(HOUSE, DRINK, { yieldServes: 1, lines: [gin50] });
    expect(t.calls.filter((c) => /\.(insert|update|upsert|delete)\(/.test(c))).toEqual([]);
    expect(t.rpcCalls.map((c) => c.name)).not.toContain("save_recipe_version");
    expect(t.rpcCalls.every((c) => c.name === "recipe_qty_base")).toBe(true);
  });
});
