import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * Recipe draw, slice 4: a till line whose button names a drink recipe takes
 * the recipe's goods off the shelf, and its void gives them back. The database
 * is in-memory with real `eq`/`in` filtering; the writer is a mock answering
 * each status the real one can (migrations 20271020110000 / 20271020120000).
 */

type Row = Record<string, any>;

const R = "r-house";
const GIN = "inv-gin";
const VERMOUTH = "inv-vermouth";
const CAMPARI = "inv-campari";
const NEGRONI = "cocktail-negroni";
const VERSION = "ver-1";

function makeDb(over: {
  tables?: Record<string, Row[]>;
  rpc?: (name: string, args: Row) => { data: any; error: any };
  failRead?: string;
}) {
  const tables: Record<string, Row[]> = {
    pos_item_mappings: [
      {
        restaurant_id: R,
        source: "*",
        external_item_id: "btn-negroni",
        item_name: "Negroni",
        is_wine: false,
        master_wine_id: null,
        inventory_id: null,
        cocktail_id: NEGRONI,
        sale_unit: null,
        sale_volume_ml: null,
      },
    ],
    recipe_current: [{ restaurant_id: R, cocktail_id: NEGRONI, version_id: VERSION }],
    recipe_versions: [{ id: VERSION, yield_serves: 1 }],
    recipe_lines: [
      { version_id: VERSION, position: 1, role: "stocked", inventory_id: GIN, label: "Gin", qty_base: 300, base_unit: "ml10" },
      { version_id: VERSION, position: 2, role: "stocked", inventory_id: VERMOUTH, label: "Vermouth", qty_base: 300, base_unit: "ml10" },
      { version_id: VERSION, position: 3, role: "stocked", inventory_id: CAMPARI, label: "Campari", qty_base: 300, base_unit: "ml10" },
      { version_id: VERSION, position: 4, role: "untracked", inventory_id: null, label: "Orange peel", qty_base: 1000, base_unit: "each_milli" },
    ],
    restaurant_inventory: [GIN, VERMOUTH, CAMPARI].map((id) => ({
      id,
      restaurant_id: R,
      uom: "bottle",
      bottle_size_ml: 700,
      pour_size_ml: null,
      menu_price_current: null,
    })),
    pos_unresolved_lines: [],
    ...(over.tables ?? {}),
  };
  const inserted: Record<string, Row[]> = {};
  const rpcCalls: Array<{ name: string; args: Row }> = [];

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let single = false;
    const run = () => {
      if (over.failRead && table === over.failRead) {
        return { data: null, error: { message: "connection refused" } };
      }
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const q: any = {
      select: () => q,
      eq: (col: string, v: any) => (filters.push((r) => r[col] === v), q),
      in: (col: string, vs: any[]) => (filters.push((r) => vs.includes(r[col])), q),
      order: () => q,
      maybeSingle: async () => ((single = true), run()),
      insert: async (row: Row) => {
        (inserted[table] ??= []).push(row);
        return { error: null };
      },
      upsert: async () => ({ error: null }),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  const client: any = {
    from,
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      return over.rpc ? over.rpc(name, args) : { data: null, error: null };
    },
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    inserted,
    rpcCalls,
    recipeCalls: () => rpcCalls.filter((c) => /recipe_draw$/.test(c.name)),
  };
}

const sale = (over: Row = {}) => ({
  externalCheckId: "chk-1",
  openedAt: "2026-11-19T18:00:00Z",
  closedAt: "2026-11-19T19:00:00Z",
  items: [{ name: "Negroni", externalItemId: "btn-negroni", qty: 2, price: 14, lineId: "L1" }],
  ...over,
});

const booked = {
  data: {
    status: "booked",
    version_id: VERSION,
    draws: [GIN, VERMOUTH, CAMPARI].map((i) => ({ inventory_id: i, via: "pour", units: 0, carry_out: "0" })),
  },
  error: null,
};

describe("a mapped drink sale draws its recipe (recipe draw, slice 4)", () => {
  it("books a Negroni line through record_recipe_draw: three goods, none for the peel", async () => {
    const t = makeDb({ rpc: () => booked });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);

    const calls = t.recipeCalls();
    expect(calls.map((c) => c.name)).toEqual(["record_recipe_draw"]);
    const a = calls[0].args;
    expect(a.p_restaurant).toBe(R);
    expect(a.p_version_id).toBe(VERSION);
    expect(a.p_cocktail_id).toBe(NEGRONI);
    expect(a.p_sale_key).toEqual(expect.any(String));
    expect(a.p_draws.map((d: Row) => d.inventory_id).sort()).toEqual([CAMPARI, GIN, VERMOUTH].sort());
    // 2 serves x 300 tenths of a ml, in micro-units.
    for (const d of a.p_draws) expect(d.exact_micro).toBe(String(2n * 300n * 1_000_000n));
    expect(res.stock.booked).toBe(1);
    expect(res.stock.failed).toBe(0);
    expect(t.inserted.pos_unresolved_lines ?? []).toHaveLength(0);
  });

  it("a replayed sale is counted as already booked, not booked twice", async () => {
    const t = makeDb({ rpc: () => ({ data: { status: "replay", draws: [] }, error: null }) });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    expect(res.stock.booked).toBe(0);
    expect(res.stock.alreadyBooked).toBe(1);
  });

  it("a wait from the database queues the line with its reasons and books nothing", async () => {
    const t = makeDb({
      rpc: () => ({ data: { status: "wait", waits: [{ inventory_id: GIN, reason: "measure_mismatch" }] }, error: null }),
    });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    const q = t.inserted.pos_unresolved_lines;
    expect(q).toHaveLength(1);
    expect(q[0].reason).toBe("no_sale_volume");
    expect(q[0].raw.unresolved_detail).toContain("measure_mismatch");
    expect(res.stock.booked).toBe(0);
    expect(res.stock.queued.no_sale_volume).toBe(1);
  });

  it("a short shelf queues the line and says how short", async () => {
    const t = makeDb({
      rpc: () => ({ data: { status: "short", short: [{ inventory_id: GIN, via: "pour", need: 600, have: 100 }] }, error: null }),
    });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    const q = t.inserted.pos_unresolved_lines;
    expect(q).toHaveLength(1);
    expect(q[0].raw.unresolved_detail).toContain("need 600, have 100");
    expect(res.stock.booked).toBe(0);
  });

  it("a recipe line not linked to a shelf item waits in the plan: no write is even attempted", async () => {
    const t = makeDb({
      tables: {
        recipe_lines: [
          { version_id: VERSION, position: 1, role: "stocked", inventory_id: null, label: "Gin", qty_base: 300, base_unit: "ml10" },
        ],
      },
      rpc: () => booked,
    });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    expect(t.recipeCalls()).toHaveLength(0);
    const q = t.inserted.pos_unresolved_lines;
    expect(q[0].reason).toBe("unmapped");
    expect(q[0].raw.unresolved_detail).toContain("unlinked");
    expect(res.stock.queued.unmapped).toBe(1);
  });

  it("a shelf item that is not this house's waits: the shelf read is scoped to the house", async () => {
    const t = makeDb({
      tables: {
        restaurant_inventory: [
          { id: GIN, restaurant_id: "r-other", uom: "bottle", bottle_size_ml: 700 },
          { id: VERMOUTH, restaurant_id: R, uom: "bottle", bottle_size_ml: 700 },
          { id: CAMPARI, restaurant_id: R, uom: "bottle", bottle_size_ml: 700 },
        ],
      },
      rpc: () => booked,
    });
    await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    expect(t.recipeCalls()).toHaveLength(0);
    expect(t.inserted.pos_unresolved_lines[0].raw.unresolved_detail).toContain("not_this_house");
  });

  it("a recipe with no current version queues as unmapped and writes nothing", async () => {
    const t = makeDb({ tables: { recipe_current: [] }, rpc: () => booked });
    await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    expect(t.recipeCalls()).toHaveLength(0);
    expect(t.inserted.pos_unresolved_lines[0].reason).toBe("unmapped");
  });

  it("a recipe read that FAILS says so and books nothing (ADR 0020)", async () => {
    const t = makeDb({ failRead: "recipe_lines", rpc: () => booked });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    expect(t.recipeCalls()).toHaveLength(0);
    expect(t.inserted.pos_unresolved_lines[0].raw.unresolved_detail).toContain("could not read the recipe");
    expect(t.inserted.pos_unresolved_lines[0].raw.unresolved_detail).toContain("connection refused");
    expect(res.stock.booked).toBe(0);
  });

  it("a writer error is a failed line in the report, never a silent success", async () => {
    const t = makeDb({ rpc: () => ({ data: null, error: { message: "RDR00 boom" } }) });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale()]);
    expect(res.stock.failed).toBe(1);
    expect(res.stock.booked).toBe(0);
    expect(res.errors.join(" ")).toContain("RDR00 boom");
  });

  it("a fractional quantity cannot be drawn as serves: it waits, it does not round", async () => {
    const t = makeDb({ rpc: () => booked });
    await new PosHubService(t.db).ingest(R, "generic_webhook", [
      sale({ items: [{ name: "Negroni", externalItemId: "btn-negroni", qty: 0.5, price: 7, lineId: "L1" }] }),
    ]);
    expect(t.recipeCalls()).toHaveLength(0);
    expect(t.inserted.pos_unresolved_lines[0].raw.unresolved_detail).toContain("bad_quantity");
  });

  it("a void calls reverse_recipe_draw under the SAME sale key the sale used", async () => {
    const t = makeDb({
      rpc: (name) =>
        name === "reverse_recipe_draw"
          ? { data: { status: "returned", draws: [{ inventory_id: GIN, via: "pour", units: 0 }] }, error: null }
          : booked,
    });
    const svc = new PosHubService(t.db);
    await svc.ingest(R, "generic_webhook", [sale()]);
    const res = await svc.ingest(R, "generic_webhook", [sale({ voided: true })]);
    const [s, v] = t.recipeCalls();
    expect(s.name).toBe("record_recipe_draw");
    expect(v.name).toBe("reverse_recipe_draw");
    expect(v.args).toEqual({ p_restaurant: R, p_sale_key: s.args.p_sale_key, p_occurred_at: expect.any(String) });
    expect(res.stock.booked).toBe(1);
  });

  it("a void of a sale this house never booked moves nothing and is not an error", async () => {
    const t = makeDb({ rpc: () => ({ data: { status: "nothing_booked" }, error: null }) });
    const res = await new PosHubService(t.db).ingest(R, "generic_webhook", [sale({ voided: true })]);
    expect(t.recipeCalls().map((c) => c.name)).toEqual(["reverse_recipe_draw"]);
    expect(res.stock.failed).toBe(0);
    expect(res.stock.booked).toBe(0);
    expect(t.inserted.pos_unresolved_lines ?? []).toHaveLength(0);
  });

  it("a void whose stock cannot come back is queued with the reason", async () => {
    const t = makeDb({
      rpc: () => ({ data: { status: "wait", waits: [{ inventory_id: GIN, reason: "no_lot" }] }, error: null }),
    });
    await new PosHubService(t.db).ingest(R, "generic_webhook", [sale({ voided: true })]);
    expect(t.inserted.pos_unresolved_lines[0].raw.unresolved_detail).toContain("no_lot");
  });

  it("a button with no recipe link never calls the recipe writers", async () => {
    const t = makeDb({
      tables: {
        pos_item_mappings: [
          { restaurant_id: R, source: "*", external_item_id: "btn-cab", item_name: "Cab", is_wine: true, inventory_id: "inv-cab", cocktail_id: null, sale_unit: "bottle" },
        ],
        restaurant_inventory: [{ id: "inv-cab", restaurant_id: R, uom: "bottle", bottle_size_ml: 750, pour_size_ml: 150 }],
      },
      rpc: () => ({ data: "tx", error: null }),
    });
    await new PosHubService(t.db).ingest(R, "generic_webhook", [
      sale({ items: [{ name: "Cab", externalItemId: "btn-cab", qty: 1, price: 90, lineId: "L1" }] }),
    ]);
    expect(t.recipeCalls()).toHaveLength(0);
    expect(t.rpcCalls.map((c) => c.name)).toContain("apply_stock_movement");
  });

  it("an open check draws nothing (stock moves only when a check closes)", async () => {
    const t = makeDb({ rpc: () => booked });
    await new PosHubService(t.db).ingest(R, "generic_webhook", [sale({ closedAt: null })]);
    expect(t.recipeCalls()).toHaveLength(0);
  });
});
